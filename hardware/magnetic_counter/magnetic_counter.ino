// TransitSense · Magnetic vehicle counter and classifier
// Hardware: ESP32 DevKitC · QMC5883L 3-axis magnetometer (GY-271 module) in a sealed road stud
// Board: "ESP32 Dev Module" (Arduino-ESP32 core 3.x) · Library: PubSubClient (MQTT)
//
// A vehicle's steel body bends the Earth's magnetic field above the sensor.
// The sketch tracks the quiet-road baseline, detects when the field moves away
// from it, and measures the disturbance's peak and duration. Bigger, longer
// disturbances mean bigger vehicles. Each detection is published over MQTT.
// The thresholds are starting points: calibrate them at each site.

#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>

const char *WIFI_SSID = "your-wifi";
const char *WIFI_PASS = "your-password";
const char *MQTT_HOST = "192.168.1.10";
const char *MQTT_TOPIC = "transitsense/corridor/ts-01/vehicles";

const int SDA_PIN = 21, SCL_PIN = 22;
const uint8_t QMC_ADDR = 0x0D;
const float COUNTS_PER_MILLIGAUSS = 12.0;   // ±2 gauss range: 12000 counts per gauss

const float START_MG = 15;                  // disturbance that starts a detection
const float END_MG = 8;                     // disturbance that ends it (hysteresis)
const uint32_t END_HOLD_MS = 150;           // must stay quiet this long to end
const float BASELINE_RATE = 0.002;          // slow drift tracking while the road is empty

WiFiClient net;
PubSubClient mqtt(net);

float baseX, baseY, baseZ;
bool inVehicle = false;
uint32_t eventStart = 0, quietSince = 0, total = 0;
float eventPeak = 0;

void writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(QMC_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

// Data registers 0x00–0x05 hold X, Y, Z as little-endian signed 16-bit values.
// Status register 0x06 bit 0 (DRDY) is set when a new sample is ready.
bool readField(float &x, float &y, float &z) {
  Wire.beginTransmission(QMC_ADDR);
  Wire.write(0x06);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(QMC_ADDR, (uint8_t)1) != 1) return false;
  if (!(Wire.read() & 0x01)) return false;
  Wire.beginTransmission(QMC_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(QMC_ADDR, (uint8_t)6) != 6) return false;
  int16_t raw[3];
  for (int i = 0; i < 3; i++) {
    uint8_t low = Wire.read();
    uint8_t high = Wire.read();
    raw[i] = (int16_t)(low | (high << 8));
  }
  x = raw[0] / COUNTS_PER_MILLIGAUSS;
  y = raw[1] / COUNTS_PER_MILLIGAUSS;
  z = raw[2] / COUNTS_PER_MILLIGAUSS;
  return true;
}

const char *classify(float peakMg, float seconds) {
  if (peakMg < 40 && seconds < 0.35) return "two-wheeler";
  if (peakMg > 150 || seconds > 1.0) return "truck";
  return "car";
}

void publish(const char *type, float peakMg, float seconds) {
  char payload[160];
  snprintf(payload, sizeof(payload),
           "{\"sensor\":\"ts-01\",\"type\":\"%s\",\"peak_mg\":%.1f,\"duration_s\":%.2f,\"count\":%lu}",
           type, peakMg, seconds, (unsigned long)total);
  Serial.println(payload);
  if (mqtt.connected()) mqtt.publish(MQTT_TOPIC, payload);
}

void keepConnected() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;
  static uint32_t lastTry = 0;
  if (millis() - lastTry < 5000) return;
  lastTry = millis();
  mqtt.connect("transitsense-ts-01");
}

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);
  writeRegister(0x0B, 0x01);  // set/reset period, as recommended by the datasheet
  writeRegister(0x09, 0x09);  // continuous mode, 100 Hz, ±2 gauss, 512× oversampling

  float x, y, z, sx = 0, sy = 0, sz = 0;
  int samples = 0;
  uint32_t start = millis();
  while (samples < 200 && millis() - start < 5000) {  // 2 s calibration on an empty road
    if (readField(x, y, z)) { sx += x; sy += y; sz += z; samples++; }
  }
  if (samples == 0) {
    Serial.println("QMC5883L not responding; check wiring");
    while (true) delay(1000);
  }
  baseX = sx / samples; baseY = sy / samples; baseZ = sz / samples;

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  mqtt.setServer(MQTT_HOST, 1883);
}

void loop() {
  keepConnected();
  mqtt.loop();

  float x, y, z;
  if (!readField(x, y, z)) return;
  float dx = x - baseX, dy = y - baseY, dz = z - baseZ;
  float deviation = sqrtf(dx * dx + dy * dy + dz * dz);
  uint32_t now = millis();

  if (!inVehicle) {
    baseX += BASELINE_RATE * dx;
    baseY += BASELINE_RATE * dy;
    baseZ += BASELINE_RATE * dz;
    if (deviation > START_MG) {
      inVehicle = true;
      eventStart = now;
      eventPeak = deviation;
      quietSince = 0;
    }
  } else {
    eventPeak = max(eventPeak, deviation);
    if (deviation < END_MG) {
      if (!quietSince) quietSince = now;
      if (now - quietSince >= END_HOLD_MS) {
        inVehicle = false;
        float seconds = (quietSince - eventStart) / 1000.0;
        total++;
        publish(classify(eventPeak, seconds), eventPeak, seconds);
      }
    } else {
      quietSince = 0;
    }
  }
}
