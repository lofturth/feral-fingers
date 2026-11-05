#include <stdint.h>
#include <stdio.h>

#include "driver/i2c_master.h"

extern "C" void app_main(void)
{
    i2c_master_bus_config_t bus_cfg = {};
    bus_cfg.clk_source = I2C_CLK_SRC_DEFAULT;
    bus_cfg.i2c_port = I2C_NUM_0;
    bus_cfg.sda_io_num = GPIO_NUM_6;
    bus_cfg.scl_io_num = GPIO_NUM_7;
    bus_cfg.glitch_ignore_cnt = 7;
    bus_cfg.flags.enable_internal_pullup = true;
    i2c_master_bus_handle_t bus;
    printf("\nBMI323 I2C Address Diagnostic\nSDA: GPIO6\nSCL: GPIO7\n\n");
    if (i2c_new_master_bus(&bus_cfg, &bus) != ESP_OK) {
        printf("I2C bus setup failed\n");
        return;
    }

    unsigned found = 0;
    for (uint8_t address = 0x68; address <= 0x69; ++address) {
        printf("Checking 0x%02X...\n", address);
        esp_err_t err = i2c_master_probe(bus, address, 50);
        if (err != ESP_OK) {
            printf("  %s\n\n", err == ESP_ERR_NOT_FOUND ? "No response" : "Probe failed");
            continue;
        }
        printf("  ACK received\n");

        i2c_device_config_t dev_cfg = {};
        dev_cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        dev_cfg.device_address = address;
        dev_cfg.scl_speed_hz = 100000;
        i2c_master_dev_handle_t dev;
        if (i2c_master_bus_add_device(bus, &dev_cfg, &dev) != ESP_OK) {
            printf("  Could not configure CHIP_ID read\n\n");
            continue;
        }
        const uint8_t reg = 0x00;
        uint8_t data[4]; // Two dummy bytes precede the BMI323 register word.
        err = i2c_master_transmit_receive(dev, &reg, 1, data, sizeof(data), 50);
        if (err == ESP_OK) {
            printf("  CHIP_ID: 0x%02X\n", data[2]);
            if (data[2] == 0x43) {
                printf("  BMI323 confirmed\n");
                found |= 1u << (address - 0x68);
            } else {
                printf("  Unexpected CHIP_ID\n");
            }
        } else {
            printf("  CHIP_ID read failed\n");
        }
        i2c_master_bus_rm_device(dev);
        printf("\n");
    }
    if (found == 0) printf("Result: No BMI323 confirmed at 0x68 or 0x69\n");
    else if (found == 3) printf("Result: BMI323 confirmed at both 0x68 and 0x69\n");
    else printf("Result: BMI323 confirmed at 0x%02X\n", found == 1 ? 0x68 : 0x69);
}
