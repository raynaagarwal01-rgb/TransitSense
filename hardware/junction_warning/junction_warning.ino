// TransitSense · Junction warning post (one node per approach)
// Hardware: ESP32 DevKitC · Benewake TFmini-S LiDAR · WS2812B 16-LED ring
// Board: "ESP32 Dev Module" (Arduino-ESP32 core 3.x) · Library: Adafruit NeoPixel
//
// Each post measures the distance to the vehicle on its own approach.
// A vehicle that keeps getting closer is "approaching"; parked (steady)
// and departing (moving away) vehicles are ignored. The four posts share
// their state over ESP-NOW: while one approach is active, its post stays
// green and the other three show red. If a peer or the LiDAR goes silent,
// the post fails safe to steady red.

#include <WiFi.h>
#include <esp_now.h>
#include <Adafruit_NeoPixel.h>

const uint8_t APPROACH_ID = 0;          // 0 = North, 1 = West, 2 = South, 3 = East (set per post)

const int LIDAR_RX = 16;                // ESP32 RX2  <- TFmini-S TX
const int LIDAR_TX = 17;                // ESP32 TX2  -> TFmini-S RX
const int LED_PIN = 4;                  // WS2812B DIN (through a 330 Ω resistor)
const int LED_COUNT = 16;

const uint16_t WARN_RANGE_CM = 1100;    // only watch the last 11 m before the junction
const uint16_t MIN_STRENGTH = 100;      // reject weak or saturated LiDAR returns
const float APPROACH_SPEED_MS = 0.8;    // closing speed that counts as approaching
const uint32_t HOLD_MS = 2500;          // keep the warning this long after the last approach reading
const uint32_t PEER_TIMEOUT_MS = 1500;  // a silent peer means fail-safe red
const uint32_t LIDAR_TIMEOUT_MS = 500;  // a silent LiDAR means fail-safe red
const uint32_t HEARTBEAT_MS = 200;

struct PostMessage {
  uint8_t id;
  bool approaching;
  uint32_t sequence;
};

Adafruit_NeoPixel ring(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

volatile bool peerApproaching[4] = {false, false, false, false};
volatile uint32_t peerLastSeen[4] = {0, 0, 0, 0};

float smoothedSpeed = 0;
uint16_t lastDistance = 0;
uint32_t lastLidarFrame = 0, lastDistanceTime = 0, approachUntil = 0, lastHeartbeat = 0, sequence = 0;

void onReceive(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len != sizeof(PostMessage)) return;
  PostMessage msg;
  memcpy(&msg, data, sizeof(msg));
  if (msg.id > 3 || msg.id == APPROACH_ID) return;
  peerApproaching[msg.id] = msg.approaching;
  peerLastSeen[msg.id] = millis();
}

// One TFmini-S frame is 9 bytes: 0x59 0x59 distL distH strengthL strengthH tempL tempH checksum.
// The checksum is the low byte of the sum of the first eight bytes. Distance is in centimetres.
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

void updateApproach() {
  uint16_t distance, strength;
  if (!readLidar(distance, strength)) return;
  uint32_t now = millis();
  lastLidarFrame = now;
  bool valid = strength >= MIN_STRENGTH && strength != 65535 && distance > 0 && distance < WARN_RANGE_CM;
  if (valid && lastDistanceTime) {
    float dt = (now - lastDistanceTime) / 1000.0;
    if (dt > 0) {
      float speed = (lastDistance - (float)distance) / 100.0 / dt;  // positive = getting closer
      smoothedSpeed = 0.8 * smoothedSpeed + 0.2 * speed;
    }
  } else if (!valid) {
    smoothedSpeed = 0;
  }
  if (valid) {
    lastDistance = distance;
    lastDistanceTime = now;
    if (smoothedSpeed > APPROACH_SPEED_MS) approachUntil = now + HOLD_MS;
  } else {
    lastDistanceTime = 0;
  }
}

void showColor(uint8_t r, uint8_t g, uint8_t b) {
  ring.fill(ring.Color(r, g, b));
  ring.show();
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(115200, SERIAL_8N1, LIDAR_RX, LIDAR_TX);
  ring.begin();
  ring.setBrightness(180);
  showColor(255, 0, 0);  // red until the network is up

  WiFi.mode(WIFI_STA);
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed; staying red");
    while (true) delay(1000);
  }
  esp_now_register_recv_cb(onReceive);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
}

void loop() {
  updateApproach();
  uint32_t now = millis();
  bool selfApproaching = now < approachUntil;

  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = now;
    PostMessage msg = {APPROACH_ID, selfApproaching, sequence++};
    esp_now_send(BROADCAST, (const uint8_t *)&msg, sizeof(msg));
  }

  bool failSafe = now - lastLidarFrame > LIDAR_TIMEOUT_MS;
  bool otherApproaching = false;
  for (uint8_t i = 0; i < 4; i++) {
    if (i == APPROACH_ID) continue;
    if (now - peerLastSeen[i] > PEER_TIMEOUT_MS) failSafe = true;
    if (peerApproaching[i]) otherApproaching = true;
  }

  if (failSafe) showColor(255, 0, 0);                                // steady red: fail-safe
  else if (otherApproaching && !selfApproaching) showColor(255, 0, 0);  // cross traffic coming
  else showColor(0, 255, 60);                                         // clear, or this approach has priority
  delay(10);
}
