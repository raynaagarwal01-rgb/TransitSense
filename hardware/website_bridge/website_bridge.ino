// TransitSense · Website bridge (USB serial)
// Connects an ESP32 to the TransitSense website through the browser's Web Serial API
// (Chrome or Edge on a computer): open the site, click "ESP32" in the header, pick the port.
// Board: "ESP32 Dev Module" (Arduino-ESP32 core 3.x) · Library: ArduinoJson 7
//
// Works on a bare ESP32 board:
//   BOOT button, short press -> runs the current demo's main action on the website
//   BOOT button, long press  -> dispatches the ambulance
//   Blue on-board LED         -> lights when the simulation needs attention: red warning (on),
//                                sensor fault or junction clearing (fast blink), ambulance green
//                                (on), garage full (blink), and a flash for every vehicle counted
// Optional sensors and outputs: set the switches below to 1 and wire them as in hardware/README.md.
//
// Protocol: one JSON object per line at 115200 baud.
//   ESP32 -> site: {"type":"hello"...} {"type":"event","event":"button"|"siren"|"approach"|"depart"|"vehicle"...}
//                  {"type":"fault","sensor":"lidar","active":true} {"type":"reading",...} {"type":"heartbeat"...}
//   site -> ESP32: {"cmd":"hello"} {"cmd":"flash","color":[r,g,b],"ms":200}
//                  {"cmd":"led","mode":"off|on|blink|fast","color":[r,g,b],"board":"off|on|blink|fast"}
//                  (mode/color drive the LED ring; board drives the single-colour on-board LED)

#define USE_NEOPIXEL 0   // WS2812B ring/strip on GPIO4 shows the LED colour
#define USE_TFMINI 0     // Benewake TFmini-S on GPIO16/17: approaching / departing vehicles
#define USE_QMC5883L 0   // QMC5883L (GY-271) on GPIO21/22: vehicle counting and class

#include <ArduinoJson.h>
#if USE_NEOPIXEL
#include <Adafruit_NeoPixel.h>
#endif
#if USE_QMC5883L
#include <Wire.h>
#endif

const int BOOT_BUTTON = 0, STATUS_LED = 2, PIXEL_PIN = 4, PIXEL_COUNT = 8;
const uint32_t LONG_PRESS_MS = 800, HEARTBEAT_MS = 2000, READING_MS = 250;

enum LedMode { LED_OFF, LED_ON, LED_BLINK, LED_FAST };
LedMode ledMode = LED_OFF, boardMode = LED_OFF;
uint8_t ledColor[3] = {0, 0, 0}, flashColor[3] = {255, 255, 255};
uint32_t flashUntil = 0, lastHeartbeat = 0, lastReading = 0;
#if USE_NEOPIXEL
Adafruit_NeoPixel pixels(PIXEL_COUNT, PIXEL_PIN, NEO_GRB + NEO_KHZ800);
#endif

// ---------- messages to the website ----------
void send(JsonDocument &doc) {
  serializeJson(doc, Serial);
  Serial.println();
}

void sendHello() {
  JsonDocument doc;
  doc["type"] = "hello";
  doc["device"] = "transitsense-bridge";
  doc["version"] = 1;
  JsonArray sensors = doc["sensors"].to<JsonArray>();
  sensors.add("button");
#if USE_TFMINI
  sensors.add("lidar");
#endif
#if USE_QMC5883L
  sensors.add("magnetometer");
#endif
  send(doc);
}

void sendEvent(const char *name) {
  JsonDocument doc;
  doc["type"] = "event";
  doc["event"] = name;
  send(doc);
}

// ---------- messages from the website ----------
void readColor(JsonVariantConst value, uint8_t *color) {
  JsonArrayConst rgb = value.as<JsonArrayConst>();
  if (rgb.size() == 3)
    for (int i = 0; i < 3; i++) color[i] = rgb[i].as<uint8_t>();
}

LedMode parseMode(const char *mode) {
  return !strcmp(mode, "on") ? LED_ON : !strcmp(mode, "blink") ? LED_BLINK : !strcmp(mode, "fast") ? LED_FAST : LED_OFF;
}

void handleCommand(const char *line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return;
  const char *cmd = doc["cmd"] | "";
  if (!strcmp(cmd, "hello")) {
    sendHello();
  } else if (!strcmp(cmd, "led")) {
    ledMode = parseMode(doc["mode"] | "off");
    boardMode = parseMode(doc["board"] | (doc["mode"] | "off"));
    readColor(doc["color"], ledColor);
  } else if (!strcmp(cmd, "flash")) {
    readColor(doc["color"], flashColor);
    flashUntil = millis() + (doc["ms"] | 200);
  }
}

void readHost() {
  static char line[256];
  static size_t length = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (length) {
        line[length] = 0;
        handleCommand(line);
        length = 0;
      }
    } else if (length < sizeof(line) - 1) {
      line[length++] = c;
    }
  }
}

// ---------- outputs ----------
bool isLit(LedMode mode, uint32_t now) {
  return mode == LED_ON || (mode == LED_BLINK && (now / 400) % 2 == 0) || (mode == LED_FAST && (now / 120) % 2 == 0);
}

void showLed() {
  static int lastState = -1;
  uint32_t now = millis();
  bool flashing = now < flashUntil;
  const uint8_t *color = flashing ? flashColor : ledColor;
  bool lit = flashing || isLit(ledMode, now), boardLit = flashing || isLit(boardMode, now);
  int state = (lit ? (color[0] << 16 | color[1] << 8 | color[2]) : 0) * 2 + boardLit;
  if (state == lastState) return;
  lastState = state;
  digitalWrite(STATUS_LED, boardLit ? HIGH : LOW);
#if USE_NEOPIXEL
  pixels.fill(lit ? pixels.Color(color[0], color[1], color[2]) : 0);
  pixels.show();
#endif
}

// ---------- BOOT button ----------
void readButton() {
  static bool wasDown = false, longSent = false;
  static uint32_t downAt = 0;
  bool down = digitalRead(BOOT_BUTTON) == LOW;
  uint32_t now = millis();
  if (down && !wasDown) { downAt = now; longSent = false; }
  if (down && !longSent && now - downAt >= LONG_PRESS_MS) { longSent = true; sendEvent("siren"); }
  if (!down && wasDown && !longSent && now - downAt >= 30) sendEvent("button");
  wasDown = down;
}

// ---------- optional: TFmini-S LiDAR ----------
#if USE_TFMINI
const int LIDAR_RX = 16, LIDAR_TX = 17;
const float MOVING_MS = 0.8;   // closing (+) or opening (-) speed that counts as moving
uint32_t lastLidarFrame = 0, lastDistanceTime = 0;
uint16_t lastDistance = 0, currentDistance = 0;
float smoothedSpeed = 0;
int motion = 0;                // 1 approaching, -1 departing, 0 steady
bool lidarFault = false;

bool readLidar(uint16_t &distanceCm, uint16_t &strength) {
  while (Serial2.available() >= 9) {
    if (Serial2.read() != 0x59 || Serial2.peek() != 0x59) continue;
    uint8_t frame[9] = {0x59};
    Serial2.readBytes(frame + 1, 8);
    uint8_t sum = 0;
    for (int i = 0; i < 8; i++) sum += frame[i];
    if (sum != frame[8]) continue;
    distanceCm = frame[2] | (frame[3] << 8);
    strength = frame[4] | (frame[5] << 8);
    return true;
  }
  return false;
}

void updateLidar() {
  uint16_t distance, strength;
  uint32_t now = millis();
  if (readLidar(distance, strength)) {
    lastLidarFrame = now;
    bool valid = strength >= 100 && strength != 65535 && distance > 0 && distance < 1100;
    if (valid && lastDistanceTime) {
      float dt = (now - lastDistanceTime) / 1000.0;
      if (dt > 0) smoothedSpeed = 0.8 * smoothedSpeed + 0.2 * ((lastDistance - (float)distance) / 100.0 / dt);
    }
    if (valid) { lastDistance = distance; lastDistanceTime = now; currentDistance = distance; }
    else { lastDistanceTime = 0; smoothedSpeed = 0; currentDistance = 0; }
    int next = smoothedSpeed > MOVING_MS ? 1 : smoothedSpeed < -MOVING_MS ? -1 : 0;
    if (next != motion && next != 0) sendEvent(next > 0 ? "approach" : "depart");
    motion = next;
  }
  bool fault = now - lastLidarFrame > 500;
  if (fault != lidarFault) {
    lidarFault = fault;
    JsonDocument doc;
    doc["type"] = "fault";
    doc["sensor"] = "lidar";
    doc["active"] = fault;
    send(doc);
  }
}
#endif

// ---------- optional: QMC5883L magnetometer ----------
#if USE_QMC5883L
const uint8_t QMC_ADDR = 0x0D;
float baseX = 0, baseY = 0, baseZ = 0, deviation = 0, eventPeak = 0;
bool magReady = false, inVehicle = false;
uint32_t eventStart = 0, quietSince = 0;

void writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(QMC_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

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
  x = raw[0] / 12.0;  // milligauss at ±2 gauss
  y = raw[1] / 12.0;
  z = raw[2] / 12.0;
  return true;
}

void updateMagnetometer() {
  float x, y, z;
  if (!readField(x, y, z)) return;
  if (!magReady) { baseX = x; baseY = y; baseZ = z; magReady = true; return; }
  float dx = x - baseX, dy = y - baseY, dz = z - baseZ;
  deviation = sqrtf(dx * dx + dy * dy + dz * dz);
  uint32_t now = millis();
  if (!inVehicle) {
    baseX += 0.002 * dx; baseY += 0.002 * dy; baseZ += 0.002 * dz;
    if (deviation > 15) { inVehicle = true; eventStart = now; eventPeak = deviation; quietSince = 0; }
  } else {
    eventPeak = max(eventPeak, deviation);
    if (deviation < 8) {
      if (!quietSince) quietSince = now;
      if (now - quietSince >= 150) {
        inVehicle = false;
        float seconds = (quietSince - eventStart) / 1000.0;
        JsonDocument doc;
        doc["type"] = "event";
        doc["event"] = "vehicle";
        doc["class"] = eventPeak < 40 && seconds < 0.35 ? "two-wheeler" : (eventPeak > 150 || seconds > 1.0) ? "truck" : "car";
        doc["peak_mg"] = round(eventPeak * 10) / 10.0;
        doc["duration_s"] = round(seconds * 100) / 100.0;
        send(doc);
      }
    } else {
      quietSince = 0;
    }
  }
}
#endif

void setup() {
  Serial.begin(115200);
  pinMode(BOOT_BUTTON, INPUT_PULLUP);
  pinMode(STATUS_LED, OUTPUT);
#if USE_NEOPIXEL
  pixels.begin();
  pixels.setBrightness(120);
#endif
#if USE_TFMINI
  Serial2.begin(115200, SERIAL_8N1, LIDAR_RX, LIDAR_TX);
#endif
#if USE_QMC5883L
  Wire.begin(21, 22);
  writeRegister(0x0B, 0x01);
  writeRegister(0x09, 0x09);  // continuous, 100 Hz, ±2 gauss
#endif
  delay(300);
  sendHello();
}

void loop() {
  readHost();
  readButton();
#if USE_TFMINI
  updateLidar();
#endif
#if USE_QMC5883L
  updateMagnetometer();
#endif
  uint32_t now = millis();
  if (now - lastReading >= READING_MS) {
    lastReading = now;
#if USE_TFMINI
    if (currentDistance) {
      JsonDocument doc;
      doc["type"] = "reading";
      doc["sensor"] = "lidar";
      doc["distance_cm"] = currentDistance;
      send(doc);
    }
#endif
#if USE_QMC5883L
    if (magReady) {
      JsonDocument doc;
      doc["type"] = "reading";
      doc["sensor"] = "magnetometer";
      doc["deviation_mg"] = round(deviation * 10) / 10.0;
      send(doc);
    }
#endif
  }
  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = now;
    JsonDocument doc;
    doc["type"] = "heartbeat";
    doc["uptime_s"] = now / 1000;
    send(doc);
  }
  showLed();
  delay(2);
}
