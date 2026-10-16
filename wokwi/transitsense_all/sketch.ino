// TransitSense · all four systems on one ESP32 (Wokwi)
// 1. Blind-junction warning   2. Emergency vehicle priority
// 3. Vehicle counting         4. Predictive smart parking
// Each system keeps its original logic. They run side by side without blocking each other,
// and every change is sent live to the TransitSense website over MQTT.
// Wokwi library: PubSubClient (listed in libraries.txt).
#include <WiFi.h>
#include <PubSubClient.h>

// ---- Live link to the TransitSense website ----
// Wokwi-GUEST gives the simulated ESP32 internet access. Events go to a public MQTT
// broker, and the website (dist/live.mjs) subscribes to the same topics over WebSockets.
const char* WIFI_SSID = "Wokwi-GUEST";
const char* MQTT_HOST = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char* TOPIC_PREFIX = "transitsense/live/";

WiFiClient net;
PubSubClient mqtt(net);

void sendEvent(const char* sim, const String& json) {
  String topic = String(TOPIC_PREFIX) + sim;
  if (mqtt.connected()) mqtt.publish(topic.c_str(), json.c_str());
  Serial.print("Website <- ");
  Serial.print(sim);
  Serial.print(" ");
  Serial.println(json);
}

// Commands from the website arrive on transitsense/live/cmd/<system>:
// {"cmd":"identify"} flashes that system's lights; {"cmd":"priority"} starts emergency priority.
const char* SYSTEMS[] = {"junction", "priority", "counter", "parking"};
unsigned long identifyUntil[4] = {0, 0, 0, 0};
bool remotePriority = false;

void onCommand(char* topic, byte* payload, unsigned int length) {
  String t(topic), body;
  for (unsigned int i = 0; i < length; i++) body += (char)payload[i];
  for (int i = 0; i < 4; i++) {
    if (!t.endsWith(String("/") + SYSTEMS[i])) continue;
    if (body.indexOf("\"identify\"") >= 0) {
      identifyUntil[i] = millis() + 3000;
      Serial.println(String("Website -> ") + SYSTEMS[i] + ": flash lights");
      sendEvent(SYSTEMS[i], "{\"state\":\"ack\",\"cmd\":\"identify\"}");
    }
    if (i == 1 && body.indexOf("\"priority\"") >= 0) {
      remotePriority = true;
      Serial.println("Website -> priority: emergency vehicle requested");
      sendEvent("priority", "{\"state\":\"ack\",\"cmd\":\"priority\"}");
    }
  }
}

bool identifying(int system) { return millis() < identifyUntil[system]; }

// Call every loop. Never blocks for long, so the sensors keep working offline.
void keepOnline() {
  static unsigned long lastTry = 0;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!mqtt.connected() && millis() - lastTry > 3000) {
    lastTry = millis();
    String id = "transitsense-all-" + String(esp_random(), HEX);
    if (mqtt.connect(id.c_str())) {
      Serial.println("Connected to the TransitSense website feed");
      mqtt.subscribe("transitsense/live/cmd/#");
      for (const char* sim : SYSTEMS) sendEvent(sim, "{\"state\":\"online\"}");
    }
  }
  mqtt.loop();

  // Heartbeat, so the website's dashboard can show each system as online.
  static unsigned long lastBeat = 0;
  if (mqtt.connected() && millis() - lastBeat > 10000) {
    lastBeat = millis();
    for (const char* sim : SYSTEMS) mqtt.publish((String(TOPIC_PREFIX) + sim).c_str(), "{\"state\":\"online\"}");
  }
}

// ---- Shared parts ----
const int BUZZER = 13;  // Shared by the junction warning and the emergency priority

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

// ---- 1. Blind-junction warning: two ultrasonic sensors, approach A then B ----
const int J_TRIG_A = 5, J_ECHO_A = 34;
const int J_TRIG_B = 19, J_ECHO_B = 35;
const int J_RED = 25, J_YELLOW = 26, J_GREEN = 27;
const float J_LIMIT_CM = 50.0;
const unsigned long J_WINDOW_MS = 5000;
const unsigned long J_HOLD_MS = 3000;

bool jSeenA = false, jWarning = false, jBuzzer = false;
unsigned long jTimeA = 0, jLastSeen = 0;
String jState = "";

void junctionLights(bool r, bool y, bool g, bool sound) {
  digitalWrite(J_RED, r);
  digitalWrite(J_YELLOW, y);
  digitalWrite(J_GREEN, g);
  jBuzzer = sound;
}

void junctionReport(const String& state, float a, float b) {
  if (state == jState) return;
  jState = state;
  Serial.println("[Junction] " + state + "  A = " + String(a, 0) + " cm, B = " + String(b, 0) + " cm");
  sendEvent("junction", "{\"state\":\"" + state + "\",\"a\":" + String(a, 0) + ",\"b\":" + String(b, 0) + "}");
}

void junctionStep() {
  static unsigned long lastRun = 0;
  if (millis() - lastRun < 160) return;
  lastRun = millis();

  float a = distanceCM(J_TRIG_A, J_ECHO_A);
  float b = distanceCM(J_TRIG_B, J_ECHO_B);
  unsigned long now = millis();

  // Unknown sensor data must not indicate clear.
  if (a < 0 || b < 0) {
    junctionLights(1, 0, 0, 1);
    junctionReport("fault", a, b);
    return;
  }

  bool nearA = a <= J_LIMIT_CM;
  bool nearB = b <= J_LIMIT_CM;

  if (nearA && !jSeenA) {
    jSeenA = true;
    jTimeA = now;
  }
  if (jSeenA && nearB && now - jTimeA <= J_WINDOW_MS) {
    jWarning = true;
    jLastSeen = now;
  }
  if (jSeenA && now - jTimeA > J_WINDOW_MS) {
    jSeenA = false;
  }
  if (jWarning) {
    if (nearA || nearB) jLastSeen = now;
    if (!nearA && !nearB && now - jLastSeen >= J_HOLD_MS) {
      jWarning = false;
      jSeenA = false;
    }
  }

  if (jWarning) {
    junctionLights(1, 0, 0, 1);
    junctionReport("warning", a, b);
  } else if (nearA || nearB || jSeenA) {
    junctionLights(0, 1, 0, 0);
    junctionReport("pending", a, b);
  } else {
    junctionLights(0, 0, 1, 0);
    junctionReport("clear", a, b);
  }
}

// ---- 2. Emergency vehicle priority: button turns its signal green ----
const int P_BUTTON = 4;
const int P_RED = 32, P_YELLOW = 33, P_GREEN = 14;
const unsigned long P_DURATION = 8000;

bool pActive = false;
unsigned long pStart = 0;

void priorityStep() {
  unsigned long now = millis();
  bool detected = digitalRead(P_BUTTON) == LOW || remotePriority;  // Pressed reads LOW with INPUT_PULLUP
  remotePriority = false;

  if (detected) {
    if (!pActive) {
      Serial.println("[Priority] Emergency detection triggered: GREEN");
      sendEvent("priority", "{\"state\":\"active\"}");
    }
    pActive = true;
    pStart = now;
  }
  if (pActive && !detected && now - pStart >= P_DURATION) {
    pActive = false;
    Serial.println("[Priority] Priority ended: NORMAL MODE");
    sendEvent("priority", "{\"state\":\"ended\"}");
  }

  digitalWrite(P_RED, !pActive);
  digitalWrite(P_YELLOW, LOW);
  digitalWrite(P_GREEN, pActive);
}

// ---- 3. Vehicle counting and classification: one button per class ----
struct VehicleClass {
  const char* name;
  const char* key;
  int button;
  int led;
  bool last;
  unsigned long lastTime;
  unsigned long count;
};
VehicleClass classes[] = {
  {"TWO-WHEELER", "bike", 16, 21, HIGH, 0, 0},
  {"CAR", "car", 17, 22, HIGH, 0, 0},
  {"HEAVY VEHICLE", "heavy", 18, 23, HIGH, 0, 0},
};
const unsigned long C_DEBOUNCE_MS = 250;

void counterStep() {
  unsigned long now = millis();
  for (VehicleClass& c : classes) {
    bool state = digitalRead(c.button);
    if (c.last == HIGH && state == LOW && now - c.lastTime >= C_DEBOUNCE_MS) {
      c.count++;
      c.lastTime = now;
      digitalWrite(c.led, HIGH);

      unsigned long bikes = classes[0].count, cars = classes[1].count, heavy = classes[2].count;
      unsigned long total = bikes + cars + heavy;
      const char* level = total < 5 ? "LIGHT" : total < 10 ? "MODERATE" : "HEAVY";
      Serial.println(String("[Counter] Detected: ") + c.name + " · Two-wheelers " + bikes + ", Cars " + cars +
                     ", Heavy " + heavy + ", Total " + total + " · " + level + " TRAFFIC");
      sendEvent("counter", String("{\"state\":\"detected\",\"vehicle\":\"") + c.key + "\",\"bikes\":" + bikes +
                ",\"cars\":" + cars + ",\"heavy\":" + heavy + ",\"total\":" + total + "}");
    } else if (state == HIGH) {
      digitalWrite(c.led, LOW);
    }
    c.last = state;
  }
}

// ---- 4. Predictive smart parking: bay sensor + driver arrival time knob ----
const int S_TRIG = 2, S_ECHO = 36;  // GPIO 36 is labelled VP on the board
const int S_ETA_PIN = 39;           // GPIO 39 is labelled VN; ADC 0 to 4095
const int S_RED = 12, S_GREEN = 15;
const float S_OCCUPIED_CM = 50.0;
const int S_RELEASE_MIN = 10;

String sStatus = "";
int sEta = -1;

void parkingStep() {
  static unsigned long lastRun = 0;
  if (millis() - lastRun < 500) return;
  lastRun = millis();

  float distance = distanceCM(S_TRIG, S_ECHO);
  int eta = map(analogRead(S_ETA_PIN), 0, 4095, 0, 20);  // Simulated arrival: 0 to 20 min
  String status;

  if (distance < 0) status = "error";                       // Do not assume the bay is free
  else if (distance > S_OCCUPIED_CM) status = "available";  // Free now
  else if (eta >= S_RELEASE_MIN) status = "predicted";      // Assumes the car leaves in 10 min
  else status = "occupied";                                 // Likely occupied on arrival

  bool green = status == "available" || status == "predicted";
  digitalWrite(S_GREEN, green);
  digitalWrite(S_RED, !green);

  if (status == sStatus && eta == sEta) return;
  sStatus = status;
  sEta = eta;
  Serial.println("[Parking] " + status + " · distance " + String(distance, 0) + " cm · arrival in " + eta + " min");
  sendEvent("parking", "{\"state\":\"" + status + "\",\"distance\":" + String(distance, 0) + ",\"eta\":" + eta + "}");
}

void setup() {
  Serial.begin(115200);

  for (int pin : {J_TRIG_A, J_TRIG_B, S_TRIG, J_RED, J_YELLOW, J_GREEN, P_RED, P_YELLOW, P_GREEN, S_RED, S_GREEN, BUZZER}) {
    pinMode(pin, OUTPUT);
  }
  for (int pin : {J_ECHO_A, J_ECHO_B, S_ECHO}) pinMode(pin, INPUT);
  pinMode(P_BUTTON, INPUT_PULLUP);
  for (VehicleClass& c : classes) {
    pinMode(c.button, INPUT_PULLUP);
    pinMode(c.led, OUTPUT);
  }
  junctionLights(1, 0, 0, 1);  // Start conservatively

  Serial.println("================================");
  Serial.println(" TRANSITSENSE · ALL FOUR SYSTEMS");
  Serial.println("================================");

  WiFi.begin(WIFI_SSID, "", 6);  // Channel 6 makes Wokwi-GUEST connect faster
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onCommand);
}

// Flashes a system's lights while the website's "Flash lights" command is active.
void showIdentify() {
  bool on = (millis() / 250) % 2;
  const int lights[4][3] = {{J_RED, J_YELLOW, J_GREEN}, {P_RED, P_YELLOW, P_GREEN}, {21, 22, 23}, {S_RED, S_GREEN, -1}};
  for (int i = 0; i < 4; i++) {
    if (!identifying(i)) continue;
    for (int pin : lights[i]) if (pin >= 0) digitalWrite(pin, on);
  }
}

void loop() {
  keepOnline();
  junctionStep();
  priorityStep();
  counterStep();
  parkingStep();
  showIdentify();

  // One buzzer: the emergency tone wins, then the junction warning, then a short chirp on "flash lights".
  bool chirp = false;
  for (int i = 0; i < 4; i++) chirp |= identifying(i) && identifyUntil[i] - millis() > 2700;
  static int tonePlaying = 0;
  int wanted = pActive ? 1800 : jBuzzer ? 2000 : chirp ? 2600 : 0;
  if (wanted != tonePlaying) {
    if (wanted) tone(BUZZER, wanted);
    else noTone(BUZZER);
    tonePlaying = wanted;
  }

  delay(10);
}
