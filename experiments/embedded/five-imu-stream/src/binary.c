#ifdef BINARY_200
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

typedef struct __attribute__((packed)) {
    uint8_t id, status, error, reserved;
    uint16_t offset_us;
    int16_t accel[3], gyro[3];
} sensor_t;
typedef struct __attribute__((packed)) {
    uint8_t magic[4], version, count;
    uint16_t length;
    uint32_t sequence;
    uint64_t start_us, deadline_us, acquisition_end_us, previous_write_end_us;
    sensor_t sensor[5];
    uint16_t crc;
} packet_t;
_Static_assert(sizeof(packet_t)==136, "packet size");
static uint16_t crc16(const uint8_t *p, size_t n) {
    uint16_t crc=0xffff;
    while (n--) {
        crc ^= (uint16_t)*p++ << 8;
        for (int i=0;i<8;i++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    return crc;
}
static void heartbeat(void *arg) {
    (void)arg;
    gpio_set_direction(GPIO_NUM_13, GPIO_MODE_OUTPUT);
    for (;;) {
        gpio_set_level(GPIO_NUM_13,1); vTaskDelay(pdMS_TO_TICKS(500));
        gpio_set_level(GPIO_NUM_13,0); vTaskDelay(pdMS_TO_TICKS(500));
    }
}
static int16_t le16(const uint8_t *p) { return (int16_t)((uint16_t)p[0] | (uint16_t)p[1]<<8); }
void app_main(void) {
    esp_log_level_set("*", ESP_LOG_NONE);
    xTaskCreate(heartbeat,"heartbeat",2048,NULL,1,NULL);
    ESP_ERROR_CHECK(gpio_set_direction(GPIO_NUM_7, GPIO_MODE_OUTPUT));
    ESP_ERROR_CHECK(gpio_set_level(GPIO_NUM_7, 1));
    vTaskDelay(pdMS_TO_TICKS(100));
    i2c_master_bus_handle_t bus;
    i2c_master_bus_config_t bc={.i2c_port=I2C_NUM_0,.sda_io_num=GPIO_NUM_3,.scl_io_num=GPIO_NUM_4,
        .clk_source=I2C_CLK_SRC_DEFAULT,.flags.enable_internal_pullup=true};
    ESP_ERROR_CHECK(i2c_new_master_bus(&bc,&bus));
    i2c_device_config_t dc={.dev_addr_length=I2C_ADDR_BIT_LEN_7,.device_address=0x70,.scl_speed_hz=400000};
    i2c_master_dev_handle_t mux, imu;
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus,&dc,&mux));
    dc.device_address=0x6b;
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus,&dc,&imu));
    for (int i=0;i<5;i++) {
        uint8_t mask=1u<<(i+3),reg=0x0f,id=0;
        ESP_ERROR_CHECK(i2c_master_transmit(mux,&mask,1,100));
        ESP_ERROR_CHECK(i2c_master_transmit_receive(imu,&reg,1,&id,1,100));
        if (id!=0x6b) return;
        const uint8_t conf[][2]={{0x12,0x44},{0x10,0x50},{0x11,0x50}};
        for (int k=0;k<3;k++) ESP_ERROR_CHECK(i2c_master_transmit(imu,conf[k],2,100));
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    usb_serial_jtag_vfs_set_tx_line_endings(ESP_LINE_ENDINGS_LF);
    setvbuf(stdout,NULL,_IONBF,0);
    uint32_t seq=0;
    uint64_t previous_write_end=0;
    int64_t next=esp_timer_get_time();
    for (;;) {
        packet_t p={.magic={'F','F','I','M'},.version=1,.count=5,.length=sizeof(packet_t),.sequence=seq};
        p.start_us=esp_timer_get_time();
        p.deadline_us=next+5000;
        p.previous_write_end_us=previous_write_end;
        for (int i=0;i<5;i++) {
            sensor_t *s=&p.sensor[i];
            s->id=i;
            uint8_t mask=1u<<(i+3),reg=0x1e,raw[16];
            esp_err_t err=i2c_master_transmit(mux,&mask,1,100);
            if (err!=ESP_OK) s->error=1;
            else {
                err=i2c_master_transmit_receive(imu,&reg,1,raw,sizeof(raw),100);
                if (err!=ESP_OK) s->error=2;
            }
            int64_t offset=esp_timer_get_time()-p.start_us;
            s->offset_us=offset>65535 ? 65535 : (uint16_t)offset;
            if (!s->error) {
                s->status=raw[0];
                for (int a=0;a<3;a++) { s->gyro[a]=le16(raw+4+2*a); s->accel[a]=le16(raw+10+2*a); }
            }
        }
        p.acquisition_end_us=esp_timer_get_time();
        p.crc=crc16((const uint8_t *)&p,sizeof(p)-2);
        fwrite(&p,1,sizeof(p),stdout);
        previous_write_end=esp_timer_get_time();
        seq++;
        next+=5000;
        int64_t remaining=next-esp_timer_get_time();
        if (remaining>1000) vTaskDelay(pdMS_TO_TICKS((remaining-500)/1000));
        while (esp_timer_get_time()<next) taskYIELD();
        if (esp_timer_get_time()-next>5000) next=esp_timer_get_time();
    }
}
#endif
