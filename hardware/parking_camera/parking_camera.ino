// TransitSense · Parking zone camera (one per zone)
// Hardware: AI-Thinker ESP32-CAM (OV2640) · 5 V 2 A supply
// Board: "AI Thinker ESP32-CAM" (Arduino-ESP32 core 3.x) · no extra libraries
//
// Every 10 s the camera takes a JPEG of its zone and POSTs it to the
// TransitSense server. The server marks each bay free or occupied (a small
// image classifier per bay outline), logs arrivals and departures, and runs the
// bay predictor (see ../parking_server/bay_predictor.py). The reply carries the
// zone's free-bay count, which this sketch shows on the flash LED:
// one blink per free bay, or a long glow when the zone is full.

#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"

const char *WIFI_SSID = "your-wifi";
const char *WIFI_PASS = "your-password";
const char *SERVER_URL = "http://192.168.1.10:8000/api/zones/B/frame";  // one URL per zone (A, B, C)
const uint32_t INTERVAL_MS = 10000;
const int FLASH_LED = 4;

// AI-Thinker ESP32-CAM pin map
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

uint32_t lastShot = 0;

bool startCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_SVGA;  // 800×600 is enough to read 10 bay outlines
  config.jpeg_quality = 12;
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;
  return esp_camera_init(&config) == ESP_OK;
}

void blinkFreeBays(int freeBays) {
  if (freeBays <= 0) {
    digitalWrite(FLASH_LED, HIGH);
    delay(600);
    digitalWrite(FLASH_LED, LOW);
    return;
  }
  for (int i = 0; i < freeBays && i < 10; i++) {
    digitalWrite(FLASH_LED, HIGH);
    delay(40);
    digitalWrite(FLASH_LED, LOW);
    delay(160);
  }
}

void sendFrame() {
  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) {
    Serial.println("Capture failed");
    return;
  }
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "image/jpeg");
  int status = http.POST(frame->buf, frame->len);
  esp_camera_fb_return(frame);

  if (status == 200) {
    String reply = http.getString();  // e.g. {"zone":"B","free":3,"occupied":7}
    int at = reply.indexOf("\"free\":");
    int freeBays = at >= 0 ? reply.substring(at + 7).toInt() : -1;
    Serial.printf("Zone update sent, %d bays free\n", freeBays);
    if (freeBays >= 0) blinkFreeBays(freeBays);
  } else {
    Serial.printf("Upload failed: HTTP %d\n", status);
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED, OUTPUT);
  if (!startCamera()) {
    Serial.println("Camera init failed; check the ribbon cable");
    while (true) delay(1000);
  }
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
  Serial.println("Wi-Fi connected: " + WiFi.localIP().toString());
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(1000);
    return;
  }
  if (millis() - lastShot >= INTERVAL_MS) {
    lastShot = millis();
    sendFrame();
  }
}
