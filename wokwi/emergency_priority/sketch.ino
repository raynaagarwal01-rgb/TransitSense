// TransitSense · Emergency vehicle priority (Wokwi, ESP32)
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
const char* TOPIC = "transitsense/live/priority";

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
    String id = "transitsense-priority-" + String(esp_random(), HEX);
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

const int EMERGENCY_BUTTON = 4;

const int RED_LED = 25;
const int YELLOW_LED = 26;
const int GREEN_LED = 27;
const int BUZZER = 13;

const unsigned long PRIORITY_DURATION = 8000;

bool priorityActive = false;
unsigned long priorityStart = 0;

void setup() {
  pinMode(EMERGENCY_BUTTON, INPUT_PULLUP);

  pinMode(RED_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(GREEN_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  Serial.begin(115200);

  // Start in normal mode.
  digitalWrite(RED_LED, HIGH);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(GREEN_LED, LOW);
  noTone(BUZZER);

  Serial.println("Emergency Priority System Ready");
  Serial.println("Normal mode: RED");
  startWifi();
}

void loop() {
  keepOnline();
  unsigned long now = millis();

  // A pressed button reads LOW with INPUT_PULLUP.
  bool emergencyDetected =
      digitalRead(EMERGENCY_BUTTON) == LOW;

  // Start or refresh the priority interval.
  if (emergencyDetected) {
    if (!priorityActive) {
      Serial.println("Emergency detection triggered");
      sendEvent("{\"state\":\"active\"}");
    }

    priorityActive = true;
    priorityStart = now;
  }

  // End priority after the button is released
  // and the priority interval has elapsed.
  if (priorityActive &&
      !emergencyDetected &&
      now - priorityStart >= PRIORITY_DURATION) {
    priorityActive = false;
    Serial.println("Priority ended: NORMAL MODE");
    sendEvent("{\"state\":\"ended\"}");
  }

  if (priorityActive) {
    digitalWrite(RED_LED, LOW);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED, HIGH);

    tone(BUZZER, 1800);

    Serial.println("EMERGENCY PRIORITY ACTIVE");
  } else {
    digitalWrite(RED_LED, HIGH);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED, LOW);

    noTone(BUZZER);
  }

  delay(100);
}
