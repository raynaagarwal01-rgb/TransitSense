// TransitSense · ESP32 priority + vehicle counter -> website over USB (115200 baud, one JSON line per event)
// Priority button (GPIO4) -> "siren": ambulance dispatched on the site.
// Bike / car / heavy buttons (GPIO5 / 18 / 19) -> "vehicle": that vehicle class drives through the counter demo.
// Close the Serial Monitor before clicking "Connect ESP32" on the site. Board: ESP32 Dev Module.
const int P_BUTTON = 4, P_RED = 32, P_YELLOW = 33, P_GREEN = 14, BUZZER = 15;
const unsigned long P_DURATION = 8000, DEBOUNCE_MS = 250;
bool pActive = false;
unsigned long pStart = 0;

struct VehicleClass { const char *name; int button, led; int peak_mg; const char *duration; bool lastState; unsigned long lastTime; };
VehicleClass classes[] = {
  {"two-wheeler", 5, 21, 60, "0.4", HIGH, 0},
  {"car", 18, 22, 180, "1.0", HIGH, 0},
  {"truck", 19, 23, 420, "1.8", HIGH, 0},
};

void sendEvent(const char *name) {
  Serial.print("{\"type\":\"event\",\"event\":\""); Serial.print(name); Serial.println("\"}");
}

void setup() {
  Serial.begin(115200);
  pinMode(P_BUTTON, INPUT_PULLUP);
  pinMode(P_RED, OUTPUT); pinMode(P_YELLOW, OUTPUT); pinMode(P_GREEN, OUTPUT); pinMode(BUZZER, OUTPUT);
  for (auto &c : classes) { pinMode(c.button, INPUT_PULLUP); pinMode(c.led, OUTPUT); }
  digitalWrite(P_RED, HIGH);  // priority signal red until an emergency
  delay(1500);                // let the website finish opening the port
  Serial.println("{\"type\":\"hello\",\"device\":\"esp32-priority-counter\",\"sensors\":[\"priority-button\",\"vehicle-buttons\"]}");
}

void priorityStep() {
  unsigned long now = millis();
  bool pressed = digitalRead(P_BUTTON) == LOW;
  if (pressed) {
    if (!pActive) sendEvent("siren");  // ambulance dispatched on the site
    pActive = true;
    pStart = now;
  }
  if (pActive && !pressed && now - pStart >= P_DURATION) pActive = false;
  digitalWrite(P_RED, !pActive);
  digitalWrite(P_GREEN, pActive);
  static bool tonePlaying = false;
  if (pActive && !tonePlaying) { tone(BUZZER, 1800); tonePlaying = true; }
  else if (!pActive && tonePlaying) { noTone(BUZZER); tonePlaying = false; }
}

void counterStep() {
  unsigned long now = millis();
  for (auto &c : classes) {
    bool state = digitalRead(c.button);
    if (c.lastState == HIGH && state == LOW && now - c.lastTime >= DEBOUNCE_MS) {
      c.lastTime = now;
      digitalWrite(c.led, HIGH);
      Serial.print("{\"type\":\"event\",\"event\":\"vehicle\",\"class\":\""); Serial.print(c.name);
      Serial.print("\",\"peak_mg\":"); Serial.print(c.peak_mg);
      Serial.print(",\"duration_s\":"); Serial.print(c.duration); Serial.println("}");
    } else if (state == HIGH) {
      digitalWrite(c.led, LOW);
    }
    c.lastState = state;
  }
}

void loop() {
  priorityStep();
  counterStep();
  delay(10);
}
