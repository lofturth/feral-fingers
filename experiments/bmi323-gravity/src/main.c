#include <stdint.h>
#include <stdio.h>

#include "driver/i2c_master.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define BMI323_ADDR 0x69
#define I2C_TIMEOUT_MS 50

static esp_err_t read_words(i2c_master_dev_handle_t dev, uint8_t reg,
                            uint16_t *words, size_t count)
{
    uint8_t data[2 + 2 * count]; /* BMI323 inserts two dummy bytes on I2C reads. */
    esp_err_t err = i2c_master_transmit_receive(dev, &reg, 1, data,
                                                 sizeof(data), I2C_TIMEOUT_MS);
    if (err != ESP_OK) return err;
    for (size_t i = 0; i < count; ++i) {
        words[i] = (uint16_t)data[2 + 2 * i] |
                   ((uint16_t)data[3 + 2 * i] << 8);
    }
    return ESP_OK;
}

static esp_err_t write_word(i2c_master_dev_handle_t dev, uint8_t reg, uint16_t value)
{
    const uint8_t data[] = {reg, (uint8_t)value, (uint8_t)(value >> 8)};
    return i2c_master_transmit(dev, data, sizeof(data), I2C_TIMEOUT_MS);
}

void app_main(void)
{
    const i2c_master_bus_config_t bus_cfg = {
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .i2c_port = I2C_NUM_0,
        .sda_io_num = GPIO_NUM_6,
        .scl_io_num = GPIO_NUM_7,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = BMI323_ADDR,
        .scl_speed_hz = 100000,
    };
    i2c_master_bus_handle_t bus;
    i2c_master_dev_handle_t dev;
    if (i2c_new_master_bus(&bus_cfg, &bus) != ESP_OK ||
        i2c_master_bus_add_device(bus, &dev_cfg, &dev) != ESP_OK) {
        printf("# BMI323 I2C setup failed\n");
        return;
    }

    uint16_t id, error_reg;
    if (read_words(dev, 0x00, &id, 1) != ESP_OK || (id & 0xff) != 0x43 ||
        read_words(dev, 0x01, &error_reg, 1) != ESP_OK || (error_reg & 1)) {
        printf("# BMI323 identification or startup check failed\n");
        return;
    }

    /* ACC_CONF: high performance, +/-2g, 100Hz. GYR_CONF: high performance,
       +/-500 deg/s, 100Hz. See Bosch BMI323 register map, 0x20 and 0x21. */
    if (write_word(dev, 0x20, 0x7008) != ESP_OK ||
        write_word(dev, 0x21, 0x7028) != ESP_OK) {
        printf("# BMI323 configuration failed\n");
        return;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    printf("# BMI323 ready: SDA=6 SCL=7 ID=0x%02X; accel +/-2g, gyro +/-500 dps, ODR 100Hz\n", id & 0xff);

    TickType_t wake = xTaskGetTickCount();
    unsigned sample = 0, failures = 0;
    while (1) {
        uint16_t raw[6];
        if (read_words(dev, 0x03, raw, 6) == ESP_OK) {
            {
                const int64_t timestamp_us = esp_timer_get_time();
                const float ax = (int16_t)raw[0] / 16384.0f;
                const float ay = (int16_t)raw[1] / 16384.0f;
                const float az = (int16_t)raw[2] / 16384.0f;
                const float gx = (int16_t)raw[3] / 65.536f;
                const float gy = (int16_t)raw[4] / 65.536f;
                const float gz = (int16_t)raw[5] / 65.536f;
                printf("M,%u,%lld,%.4f,%.4f,%.4f,%.3f,%.3f,%.3f\n",
                       ++sample, (long long)timestamp_us, ax, ay, az, gx, gy, gz);
            }
        } else if (++failures % 100 == 1) {
            printf("# BMI323 read failed\n");
        }
        vTaskDelayUntil(&wake, pdMS_TO_TICKS(10));
    }
}
