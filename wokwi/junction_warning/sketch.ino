// TransitSense · Blind-junction warning (Wokwi, ESP32)
// Original Arduino Uno logic, moved to an ESP32 so it can send live events to the website.
// Wokwi library: PubSubClient (listed in libraries.txt).
#include <WiFi.h>
#include <PubSubClient.h>

// ---- Live link to the TransitSense website ----
// Wokwi-GUEST gives the simulated ESP32 internet access. Events go to a public MQTT
// broker, and the website (dist/live.mjs) subscribes to the same topic over WebSockets.
const char* WIFI_SSID = "Wokwi-GUEST";
const char* MQTT_HOST = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char* TOPIC = "transitsense/live/junction";

WiFiClient net;
PubSubClient mqtt(net);

void startWifi() {
  WiFi.begin(WIFI_SSID, "", 6);  // Channel 6 makes Wokwi-GUEST connect faster.
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
}

// Call every loop. Never blocks for long, so the sensor logic keeps running offline.
void keepOnline() {
  static unsigned long lastTry = 0;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!mqtt.connected() && millis() - lastTry > 3000) {
    lastTry = millis();
    String id = "transitsense-junction-" + String(esp_random(), HEX);
    if (mqtt.connect(id.c_str())) {
      Serial.println("Connected to the TransitSense website feed");
      mqtt.publish(TOPIC, "{\"state\":\"online\"}");
    }
  }
  mqtt.loop();

  // Heartbeat, so the website's dashboard can show this simulation as online.
  static unsigned long lastBeat = 0;
  if (mqtt.connected() && millis() - lastBeat > 10000) {
    lastBeat = millis();
    mqtt.publish(TOPIC, "{\"state\":\"online\"}");
  }
}

void sendEvent(const String& json) {
  if (mqtt.connected()) mqtt.publish(TOPIC, json.c_str());
  Serial.print("Website <- ");
  Serial.println(json);
}
// ---- End of live link ----

const int TRIG_A = 5, ECHO_A = 18;
const int TRIG_B = 19, ECHO_B = 21;

const int RED = 25, YELLOW = 26, GREEN = 27, BUZZER = 13;
const float LIMIT_CM = 50.0;
const unsigned long WINDOW_MS = 5000;
const unsigned long HOLD_MS = 3000;

bool seenA = false;
bool warning = false;
unsigned long timeA = 0, lastSeen = 0;
String lastState = "";

float distanceCM(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(3);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);

  unsigned long duration = pulseIn(echo, HIGH, 25000UL);
  if (duration == 0) return -1;
  return duration / 58.0;
}

void lights(bool r, bool y, bool g, bool sound) {
  digitalWrite(RED, r);
  digitalWrite(YELLOW, y);
  digitalWrite(GREEN, g);
  if (sound) tone(BUZZER, 2000);
  else noTone(BUZZER);
}

// Sends the junction state to the website only when it changes.
void report(const String& state, float a, float b) {
  if (state == lastState) return;
  lastState = state;
  sendEvent("{\"state\":\"" + state + "\",\"a\":" + String(a, 0) + ",\"b\":" + String(b, 0) + "}");
}

void setup() {
  pinMode(TRIG_A, OUTPUT);
  pinMode(ECHO_A, INPUT);
  pinMode(TRIG_B, OUTPUT);
  pinMode(ECHO_B, INPUT);
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  Serial.begin(115200);
  lights(1, 0, 0, 1); // Start conservatively
  startWifi();
}

void loop() {
  keepOnline();
  float a = distanceCM(TRIG_A, ECHO_A);
  delay(60);
  float b = distanceCM(TRIG_B, ECHO_B);
  unsigned long now = millis();

  Serial.print("A = ");
  Serial.print(a);
  Serial.print(" cm, B = ");
  Serial.print(b);
  Serial.println(" cm");

  // Unknown sensor data must not indicate clear.
  if (a < 0 || b < 0) {
    lights(1, 0, 0, 1);
    Serial.println("UNKNOWN SENSOR READING: WARNING");
    report("fault", a, b);
    delay(100);
    return;
  }

  bool nearA = a <= LIMIT_CM;
  bool nearB = b <= LIMIT_CM;

  if (nearA && !seenA) {
    seenA = true;
    timeA = now;
  }

  if (seenA && nearB && now - timeA <= WINDOW_MS) {
    warning = true;
    lastSeen = now;
  }

  if (seenA && now - timeA > WINDOW_MS) {
    seenA = false;
  }

  if (warning) {
    if (nearA || nearB) lastSeen = now;
    if (!nearA && !nearB && now - lastSeen >= HOLD_MS) {
      warning = false;
      seenA = false;
    }
  }

  if (warning) {
    lights(1, 0, 0, 1);
    Serial.println("APPROACH CONFIRMED: WARNING");
    report("warning", a, b);
  } else if (nearA || nearB || seenA) {
    lights(0, 1, 0, 0);
    Serial.println("PENDING: DIRECTION NOT CONFIRMED");
    report("pending", a, b);
  } else {
    lights(0, 0, 1, 0);
    Serial.println("CLEAR");
    report("clear", a, b);
  }

  delay(100);
}
