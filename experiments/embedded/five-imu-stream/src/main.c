#ifndef BINARY_200
#include <stdio.h>
#include <stdint.h>
#include <inttypes.h>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_timer.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define TIMEOUT_MS 100
#ifdef STREAM_200
#define PERIOD_US 5000
#define ODR_CONFIG 0x50
#else
#define PERIOD_US 10000
#define ODR_CONFIG 0x40
#endif
static i2c_master_dev_handle_t mux, imu;
static void heartbeat(void *arg) {
    (void)arg;
    gpio_set_direction(GPIO_NUM_13, GPIO_MODE_OUTPUT);
    for (;;) {
        gpio_set_level(GPIO_NUM_13, 1); vTaskDelay(pdMS_TO_TICKS(500));
        gpio_set_level(GPIO_NUM_13, 0); vTaskDelay(pdMS_TO_TICKS(500));
    }
}
static esp_err_t select_channel(int ch) {
    uint8_t mask = 1U << ch;
    return i2c_master_transmit(mux, &mask, 1, TIMEOUT_MS);
}
static esp_err_t write_reg(uint8_t reg, uint8_t value) {
    uint8_t data[] = {reg, value};
    return i2c_master_transmit(imu, data, sizeof(data), TIMEOUT_MS);
}
static int16_t le16(const uint8_t *p) { return (int16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8)); }

void app_main(void) {
    xTaskCreate(heartbeat, "heartbeat", 2048, NULL, 1, NULL);
    ESP_ERROR_CHECK(gpio_set_direction(GPIO_NUM_7, GPIO_MODE_OUTPUT));
    ESP_ERROR_CHECK(gpio_set_level(GPIO_NUM_7, 1));
    vTaskDelay(pdMS_TO_TICKS(100));
    i2c_master_bus_handle_t bus;
    i2c_master_bus_config_t bc = {.i2c_port=I2C_NUM_0, .sda_io_num=GPIO_NUM_3, .scl_io_num=GPIO_NUM_4,
        .clk_source=I2C_CLK_SRC_DEFAULT, .flags.enable_internal_pullup=true};
    ESP_ERROR_CHECK(i2c_new_master_bus(&bc, &bus));
    i2c_device_config_t dc = {.dev_addr_length=I2C_ADDR_BIT_LEN_7, .device_address=0x70, .scl_speed_hz=400000};
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &dc, &mux));
    dc.device_address=0x6b;
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &dc, &imu));
    for (int ch=3; ch<=7; ch++) {
        ESP_ERROR_CHECK(select_channel(ch));
        uint8_t reg=0x0f, id=0;
        ESP_ERROR_CHECK(i2c_master_transmit_receive(imu, &reg, 1, &id, 1, TIMEOUT_MS));
        if (id != 0x6b) { printf("# channel %d unexpected WHO_AM_I 0x%02X\n", ch, id); return; }
        ESP_ERROR_CHECK(write_reg(0x12, 0x44)); // BDU and address increment
        ESP_ERROR_CHECK(write_reg(0x10, ODR_CONFIG)); // +/-2 g
        ESP_ERROR_CHECK(write_reg(0x11, ODR_CONFIG)); // +/-250 dps
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    printf("# sample,sweep,us,channel,status,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps\n");
    uint32_t sweep=0;
    int64_t next=esp_timer_get_time();
    for (;;) {
#ifdef STREAM_200
        int64_t sweep_start=esp_timer_get_time();
#endif
#ifdef PROFILE_200
        int64_t select_us=0, read_us=0, format_us=0, output_us=0;
#endif
        for (int ch=3; ch<=7; ch++) {
#ifdef PROFILE_200
            int64_t t0=esp_timer_get_time();
#endif
            esp_err_t err=select_channel(ch);
#ifdef PROFILE_200
            int64_t t1=esp_timer_get_time();
            select_us+=t1-t0;
#endif
            uint8_t reg=0x1e, raw[16];
            if (err==ESP_OK) err=i2c_master_transmit_receive(imu, &reg, 1, raw, sizeof(raw), TIMEOUT_MS);
            int64_t now=esp_timer_get_time();
#ifdef PROFILE_200
            read_us+=now-t1;
#endif
            if (err!=ESP_OK) { printf("error,%" PRIu32 ",%" PRId64 ",%d,%s\n", sweep, now, ch, esp_err_to_name(err)); continue; }
            // status, reserved, temperature, gyro XYZ, accel XYZ
#ifdef PROFILE_200
            char line[160];
            int64_t fmt_start=esp_timer_get_time();
            int n=snprintf(line, sizeof(line), "sample,%" PRIu32 ",%" PRId64 ",%d,%u,%.6f,%.6f,%.6f,%.4f,%.4f,%.4f\n",
                sweep, now, ch, raw[0], le16(raw+10)*0.000061, le16(raw+12)*0.000061, le16(raw+14)*0.000061,
                le16(raw+4)*0.00875, le16(raw+6)*0.00875, le16(raw+8)*0.00875);
            int64_t fmt_end=esp_timer_get_time();
            format_us+=fmt_end-fmt_start;
            if (n>0 && n<(int)sizeof(line)) fwrite(line, 1, n, stdout);
            output_us+=esp_timer_get_time()-fmt_end;
#else
            printf("sample,%" PRIu32 ",%" PRId64 ",%d,%u,%.6f,%.6f,%.6f,%.4f,%.4f,%.4f\n",
                sweep, now, ch, raw[0], le16(raw+10)*0.000061, le16(raw+12)*0.000061, le16(raw+14)*0.000061,
                le16(raw+4)*0.00875, le16(raw+6)*0.00875, le16(raw+8)*0.00875);
#endif
        }
#ifdef STREAM_200
        int64_t sweep_end=esp_timer_get_time();
#ifdef PROFILE_200
        printf("profile,%" PRIu32 ",%" PRId64 ",%" PRId64 ",%" PRId64 ",%" PRId64 ",%" PRId64 ",%" PRId64 ",%" PRId64 "\n", sweep, sweep_start, sweep_end, next+PERIOD_US, select_us, read_us, format_us, output_us);
#else
        printf("timing,%" PRIu32 ",%" PRId64 ",%" PRId64 ",%" PRId64 "\n", sweep, sweep_start, sweep_end, next + PERIOD_US);
#endif
#endif
        sweep++;
        next+=PERIOD_US;
        int64_t remaining=next-esp_timer_get_time();
        if (remaining>1000) vTaskDelay(pdMS_TO_TICKS((remaining-500)/1000));
        while (esp_timer_get_time()<next) taskYIELD();
        if (esp_timer_get_time()-next>PERIOD_US) next=esp_timer_get_time();
    }
}

#endif
