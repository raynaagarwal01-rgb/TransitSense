// TransitSense · Arduino Uno junction warning -> website over USB (115200 baud, one JSON line per event)
// Pins: Sensor A TRIG5/ECHO6, Sensor B TRIG7/ECHO8, Red D9, Yellow D10, Green D11.
// Close the Serial Monitor before clicking "Connect ESP32" on the site.
const int TRIG_A = 5, ECHO_A = 6, TRIG_B = 7, ECHO_B = 8;
const int LED_RED = 9, LED_YELLOW = 10, LED_GREEN = 11;
const float DIST_LIMIT_CM = 50.0;
const unsigned long WINDOW_MS = 5000, HOLD_MS = 3000;

bool seenA = false, warningActive = false;
unsigned long timeA = 0, lastSeen = 0;

float getDistance(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW); delayMicroseconds(4);
  digitalWrite(trigPin, HIGH); delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  unsigned long duration = pulseIn(echoPin, HIGH, 30000UL);
  return duration == 0 ? -1 : duration / 58.2;
}

void setLights(bool red, bool yellow, bool green) {
  digitalWrite(LED_RED, red); digitalWrite(LED_YELLOW, yellow); digitalWrite(LED_GREEN, green);
}

void event(const __FlashStringHelper *name) {
  Serial.print(F("{\"type\":\"event\",\"event\":\"")); Serial.print(name); Serial.println(F("\"}"));
}

void setup() {
  Serial.begin(115200);  // the website opens the port at 115200
  pinMode(TRIG_A, OUTPUT); pinMode(ECHO_A, INPUT);
  pinMode(TRIG_B, OUTPUT); pinMode(ECHO_B, INPUT);
  pinMode(LED_RED, OUTPUT); pinMode(LED_YELLOW, OUTPUT); pinMode(LED_GREEN, OUTPUT);
  setLights(HIGH, LOW, LOW); delay(400);
  setLights(LOW, HIGH, LOW); delay(400);
  setLights(LOW, LOW, HIGH);
  Serial.println(F("{\"type\":\"hello\",\"device\":\"arduino-uno-junction\",\"sensors\":[\"ultrasonic-A\",\"ultrasonic-B\"]}"));
}

void loop() {
  float distA = getDistance(TRIG_A, ECHO_A);
  float distB = getDistance(TRIG_B, ECHO_B);
  unsigned long now = millis();
  bool nearA = (distA > 0 && distA <= DIST_LIMIT_CM);
  bool nearB = (distB > 0 && distB <= DIST_LIMIT_CM);

  if (nearA && !seenA) { seenA = true; timeA = now; event(F("approach")); }  // one car on the site

  if (seenA && nearB && (now - timeA <= WINDOW_MS)) {
    lastSeen = now;
    if (!warningActive) { warningActive = true; event(F("hazard")); }       // two close cars + red on the site
  }

  if (seenA && (now - timeA > WINDOW_MS)) seenA = false;

  if (warningActive) {
    if (nearA || nearB) lastSeen = now;
    if (!nearA && !nearB && (now - lastSeen >= HOLD_MS)) { warningActive = false; seenA = false; event(F("depart")); }
  }

  if (warningActive) setLights(HIGH, LOW, LOW);
  else if (nearA || nearB || seenA) setLights(LOW, HIGH, LOW);
  else setLights(LOW, LOW, HIGH);
  delay(80);
}
