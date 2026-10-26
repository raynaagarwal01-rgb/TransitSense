// TransitSense · ESP32 priority + vehicle counter + smart parking -> website over USB (115200 baud, one JSON line per event)
// Priority button (GPIO4)         -> "siren": ambulance dispatched on the site.
// Bike / car / heavy (GPIO5/18/19) -> "vehicle": that class drives through the counter demo.
// Parking sensor (TRIG2/ECHO36) + arrival-time knob (GPIO39) -> "parking": site shows your arrival time and the predicted bay.
// Close the Serial Monitor before clicking "Connect ESP32" on the site. Board: ESP32 Dev Module.

// ---- Emergency priority ----
const int P_BUTTON = 4, P_RED = 32, P_YELLOW = 33, P_GREEN = 14, BUZZER = 15;
const unsigned long P_DURATION = 8000, DEBOUNCE_MS = 80;
bool pActive = false;
unsigned long pStart = 0;

// ---- Vehicle counter ----
struct VehicleClass { const char *name; int button, led; int peak_mg; const char *duration; bool lastState; unsigned long lastTime; };
VehicleClass classes[] = {
  {"two-wheeler", 5, 21, 60, "0.4", HIGH, 0},
  {"car", 18, 22, 180, "1.0", HIGH, 0},
  {"truck", 19, 23, 420, "1.8", HIGH, 0},
};

// ---- Smart parking ----
const int S_TRIG = 2, S_ECHO = 36, S_ETA_PIN = 39, S_RED = 26, S_GREEN = 25;
const float S_OCCUPIED_CM = 50.0;
const int S_RELEASE_MIN = 10;
const char *lastParkingState = "";
int lastParkingEta = -1;

// Ultrasonic reader with short timeouts so it can never hang the loop
float readParkingDistance() {
  digitalWrite(S_TRIG, LOW); delayMicroseconds(4);
  digitalWrite(S_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(S_TRIG, LOW);
  unsigned long startWait = micros();
  while (digitalRead(S_ECHO) == LOW) if (micros() - startWait > 8000) return -1;
  unsigned long startPulse = micros();
  while (digitalRead(S_ECHO) == HIGH) if (micros() - startPulse > 15000) return -1;
  return (micros() - startPulse) / 58.2;
}

void sendEvent(const char *name) {
  Serial.print("{\"type\":\"event\",\"event\":\""); Serial.print(name); Serial.println("\"}");
}

void setup() {
  Serial.begin(115200);
  pinMode(P_BUTTON, INPUT_PULLUP);
  pinMode(P_RED, OUTPUT); pinMode(P_YELLOW, OUTPUT); pinMode(P_GREEN, OUTPUT); pinMode(BUZZER, OUTPUT);
  for (auto &c : classes) { pinMode(c.button, INPUT_PULLUP); pinMode(c.led, OUTPUT); }
  pinMode(S_TRIG, OUTPUT); pinMode(S_ECHO, INPUT); pinMode(S_RED, OUTPUT); pinMode(S_GREEN, OUTPUT);
  digitalWrite(P_RED, HIGH);    // priority signal red until an emergency
  digitalWrite(S_GREEN, HIGH);  // parking green (available) by default
  delay(1500);                // let the website finish opening the port
  Serial.println("{\"type\":\"hello\",\"device\":\"esp32-priority-counter-parking\",\"sensors\":[\"priority-button\",\"vehicle-buttons\",\"parking-sensor\"]}");
}

void priorityStep() {
  unsigned long now = millis();
  bool pressed = digitalRead(P_BUTTON) == LOW;
  static bool wasPressed = false;
  static unsigned long lastPress = 0;
  if (pressed && !wasPressed && now - lastPress >= DEBOUNCE_MS) {
    lastPress = now;
    sendEvent("siren");  // every new press dispatches an ambulance on the site
  }
  wasPressed = pressed;
  if (pressed) { pActive = true; pStart = now; }
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

void parkingStep() {
  static unsigned long lastSample = 0;
  unsigned long now = millis();
  if (now - lastSample < 600) return;  // never blocks the buttons
  lastSample = now;
  float distance = readParkingDistance();
  int eta = map(analogRead(S_ETA_PIN), 0, 4095, 0, 20);

  const char *state = (distance < 0 || distance > S_OCCUPIED_CM) ? "available" : eta >= S_RELEASE_MIN ? "predicted-free" : "occupied";
  bool free = strcmp(state, "occupied") != 0;
  digitalWrite(S_GREEN, free);
  digitalWrite(S_RED, !free);

  if (strcmp(state, lastParkingState) != 0 || eta != lastParkingEta) {  // only when something changed
    lastParkingState = state; lastParkingEta = eta;
    Serial.print("{\"type\":\"event\",\"event\":\"parking\",\"state\":\""); Serial.print(state);
    Serial.print("\",\"distance\":"); Serial.print(distance, 1);
    Serial.print(",\"eta\":"); Serial.print(eta); Serial.println("}");
  }
}

void loop() {
  counterStep();
  priorityStep();
  parkingStep();
}
