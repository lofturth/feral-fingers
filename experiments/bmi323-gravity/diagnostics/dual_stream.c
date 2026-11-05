#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#include "driver/i2c_master.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#ifdef DUAL_WIFI
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "lwip/sockets.h"
#include "nvs_flash.h"
#include "wifi_config.local.h"
#endif

#define I2C_TIMEOUT_MS 50
#ifndef DUAL_HZ
#define DUAL_HZ 100
#endif
#if DUAL_HZ == 100
#define ODR_CODE 8
#elif DUAL_HZ == 200
#define ODR_CODE 9
#elif DUAL_HZ == 400
#define ODR_CODE 10
#elif DUAL_HZ == 800
#define ODR_CODE 11
#else
#error Unsupported BMI323 benchmark rate
#endif
#define PERIOD_US (1000000 / DUAL_HZ)

typedef struct {
    uint32_t seq, missed, dropped;
    int64_t scheduled, start, read_start[2], read_end[2];
    int16_t raw[2][6];
    int ok[2];
    uint8_t fresh[2];
} record_t;

static QueueHandle_t output_queue;
static TaskHandle_t acquisition_task;
#ifdef DUAL_WIFI
static volatile bool wifi_connected;
static volatile uint32_t network_drops;

/* All integer fields are little-endian; the packet is 84 bytes. */
typedef struct __attribute__((packed)) {
    char magic[4];
    uint32_t seq;
    uint64_t start_us, a_begin_us, a_end_us, b_begin_us, b_end_us;
    uint32_t missed, dropped;
    int16_t raw[2][6];
    uint8_t ok[2], fresh[2];
} udp_packet_t;

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_connected = false;
        printf("# Wi-Fi disconnected, reason %u; retrying\n",
               ((wifi_event_sta_disconnected_t *)data)->reason);
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        wifi_connected = true;
        printf("# Wi-Fi connected; sending UDP to %s:%d\n", UDP_RECEIVER_IP, UDP_RECEIVER_PORT);
    }
}

static esp_err_t start_wifi(void)
{
    if (!WIFI_SSID[0] || !UDP_RECEIVER_IP[0]) return ESP_ERR_INVALID_ARG;
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    if (err != ESP_OK) return err;
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    const wifi_country_t country = {.cc = "IN", .schan = 1, .nchan = 13,
                                   .max_tx_power = 20, .policy = WIFI_COUNTRY_POLICY_MANUAL};
    ESP_ERROR_CHECK(esp_wifi_set_country(&country));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL));
    wifi_config_t config = {0};
    snprintf((char *)config.sta.ssid, sizeof(config.sta.ssid), "%s", WIFI_SSID);
    snprintf((char *)config.sta.password, sizeof(config.sta.password), "%s", WIFI_PASSWORD);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    return esp_wifi_connect();
}

static void network_task(void *arg)
{
    int fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    struct sockaddr_in target = {.sin_family = AF_INET, .sin_port = htons(UDP_RECEIVER_PORT)};
    if (fd < 0 || inet_pton(AF_INET, UDP_RECEIVER_IP, &target.sin_addr) != 1) {
        printf("# UDP socket or receiver IP invalid\n");
        vTaskDelete(NULL);
        return;
    }
    record_t r;
    while (xQueueReceive(output_queue, &r, portMAX_DELAY) == pdTRUE) {
        if (!wifi_connected) { ++network_drops; continue; }
        udp_packet_t packet = {.magic = {'F', 'F', 'U', '1'}, .seq = r.seq,
            .start_us = r.start, .a_begin_us = r.read_start[0], .a_end_us = r.read_end[0],
            .b_begin_us = r.read_start[1], .b_end_us = r.read_end[1],
            .missed = r.missed, .dropped = network_drops,
            .ok = {r.ok[0], r.ok[1]}, .fresh = {r.fresh[0], r.fresh[1]}};
        for (int i = 0; i < 2; ++i)
            for (int j = 0; j < 6; ++j) packet.raw[i][j] = r.raw[i][j];
        if (sendto(fd, &packet, sizeof(packet), MSG_DONTWAIT,
                   (struct sockaddr *)&target, sizeof(target)) != sizeof(packet)) ++network_drops;
    }
}
#endif

static void cycle_tick(void *arg)
{
    xTaskNotifyGive(acquisition_task);
}

static esp_err_t read_words(i2c_master_dev_handle_t dev, uint8_t reg,
                            uint16_t *words, size_t count)
{
    uint8_t data[2 + 2 * count]; /* BMI323 inserts two dummy bytes. */
    esp_err_t err = i2c_master_transmit_receive(dev, &reg, 1, data,
                                                 sizeof(data), I2C_TIMEOUT_MS);
    if (err != ESP_OK) return err;
    for (size_t i = 0; i < count; ++i)
        words[i] = (uint16_t)data[2 + 2 * i] |
                   ((uint16_t)data[3 + 2 * i] << 8);
    return ESP_OK;
}

static esp_err_t write_word(i2c_master_dev_handle_t dev, uint8_t reg, uint16_t value)
{
    const uint8_t data[] = {reg, (uint8_t)value, (uint8_t)(value >> 8)};
    return i2c_master_transmit(dev, data, sizeof(data), I2C_TIMEOUT_MS);
}

static bool configure_sensor(i2c_master_dev_handle_t dev)
{
    uint16_t id, error_reg;
    return read_words(dev, 0x00, &id, 1) == ESP_OK && (id & 0xff) == 0x43 &&
           read_words(dev, 0x01, &error_reg, 1) == ESP_OK && !(error_reg & 1) &&
           write_word(dev, 0x20, 0x7000 | ODR_CODE) == ESP_OK &&
           write_word(dev, 0x21, 0x7020 | ODR_CODE) == ESP_OK;
}

#ifndef DUAL_WIFI
static void serial_task(void *arg)
{
    record_t r;
    printf("# dual BMI323 raw stream; addresses 0x68,0x69; accel +/-2g, gyro +/-500dps, ODR %dHz\n", DUAL_HZ);
    printf("# raw accel / 16384 = g; raw gyro / 65.536 = degrees/s; invalid reads have zero raw values\n");
    printf("# timestamps are host I2C transaction times in microseconds, not IMU sample times\n");
    printf("# D,seq,scheduled_us,start_us,missed_slots,dropped_records,a_addr,a_ok,a_begin_us,a_end_us,a_ax,a_ay,a_az,a_gx,a_gy,a_gz,b_addr,b_ok,b_begin_us,b_end_us,b_ax,b_ay,b_az,b_gx,b_gy,b_gz,a_fresh,b_fresh\n");
    while (xQueueReceive(output_queue, &r, portMAX_DELAY) == pdTRUE) {
        printf("D,%lu,%lld,%lld,%lu,%lu,0x68,%d,%lld,%lld,%d,%d,%d,%d,%d,%d,0x69,%d,%lld,%lld,%d,%d,%d,%d,%d,%d,%u,%u\n",
               (unsigned long)r.seq, (long long)r.scheduled, (long long)r.start,
               (unsigned long)r.missed, (unsigned long)r.dropped,
               r.ok[0], (long long)r.read_start[0], (long long)r.read_end[0],
               r.raw[0][0], r.raw[0][1], r.raw[0][2], r.raw[0][3], r.raw[0][4], r.raw[0][5],
               r.ok[1], (long long)r.read_start[1], (long long)r.read_end[1],
               r.raw[1][0], r.raw[1][1], r.raw[1][2], r.raw[1][3], r.raw[1][4], r.raw[1][5],
               r.fresh[0], r.fresh[1]);
    }
}
#endif

void app_main(void)
{
    const i2c_master_bus_config_t bus_cfg = {
        .clk_source = I2C_CLK_SRC_DEFAULT, .i2c_port = I2C_NUM_0,
        .sda_io_num = GPIO_NUM_6, .scl_io_num = GPIO_NUM_7,
        .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t bus;
    if (i2c_new_master_bus(&bus_cfg, &bus) != ESP_OK) {
        printf("# I2C bus setup failed\n"); return;
    }

    i2c_master_dev_handle_t dev[2];
    for (int i = 0; i < 2; ++i) {
        const i2c_device_config_t cfg = {
            .dev_addr_length = I2C_ADDR_BIT_LEN_7,
            .device_address = 0x68 + i, .scl_speed_hz = 400000,
        };
        if (i2c_master_bus_add_device(bus, &cfg, &dev[i]) != ESP_OK) {
            printf("# device 0x%02X setup failed\n", 0x68 + i); return;
        }
        bool ready = false;
#ifdef DUAL_WIFI
        for (int attempt = 0; attempt < 10 && !ready; ++attempt) {
            ready = configure_sensor(dev[i]);
            if (!ready) vTaskDelay(pdMS_TO_TICKS(100));
        }
#else
        ready = configure_sensor(dev[i]);
#endif
        if (!ready) {
            printf("# device 0x%02X identification or configuration failed\n", 0x68 + i); return;
        }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
#ifdef DUAL_WIFI
    if (start_wifi() != ESP_OK) { printf("# Wi-Fi setup failed\n"); return; }
    output_queue = xQueueCreate(16, sizeof(record_t));
    if (!output_queue || xTaskCreate(network_task, "udp", 4096, NULL, 0, NULL) != pdPASS) {
        printf("# UDP queue setup failed\n"); return;
    }
#else
    output_queue = xQueueCreate(128, sizeof(record_t));
    if (!output_queue || xTaskCreate(serial_task, "serial", 4096, NULL, 0, NULL) != pdPASS) {
        printf("# serial queue setup failed\n"); return;
    }
#endif

    acquisition_task = xTaskGetCurrentTaskHandle();
    const esp_timer_create_args_t timer_cfg = {.callback = cycle_tick, .name = "dual_cycle"};
    esp_timer_handle_t timer;
    if (esp_timer_create(&timer_cfg, &timer) != ESP_OK ||
        esp_timer_start_periodic(timer, PERIOD_US) != ESP_OK) {
        printf("# cycle timer setup failed\n"); return;
    }
    uint32_t seq = 0, missed = 0, dropped = 0;
    int64_t scheduled = esp_timer_get_time() + PERIOD_US;
    while (1) {
        uint32_t ticks = ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        missed += ticks - 1;
        scheduled += (int64_t)(ticks - 1) * PERIOD_US;
        int64_t now = esp_timer_get_time();
        record_t r = {.seq = ++seq, .missed = missed, .dropped = dropped,
                      .scheduled = scheduled, .start = now};
        for (int i = 0; i < 2; ++i) {
            uint16_t words[7];
            r.read_start[i] = esp_timer_get_time();
            esp_err_t err = read_words(dev[i], 0x02, words, 7);
            r.read_end[i] = esp_timer_get_time();
            r.ok[i] = err == ESP_OK;
            if (r.ok[i]) {
                r.fresh[i] = (words[0] >> 6) & 3; /* bit 0 gyro, bit 1 accel */
                for (int j = 0; j < 6; ++j) r.raw[i][j] = (int16_t)words[j + 1];
            }
        }
        if (xQueueSend(output_queue, &r, 0) != pdTRUE) {
#ifdef DUAL_WIFI
            record_t stale;
            xQueueReceive(output_queue, &stale, 0);
            if (xQueueSend(output_queue, &r, 0) != pdTRUE) ++network_drops;
            ++network_drops;
#else
            ++dropped;
#endif
        }
        scheduled += PERIOD_US;
    }
}
