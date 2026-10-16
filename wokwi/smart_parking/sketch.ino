// TransitSense · Predictive smart parking (Wokwi, ESP32)
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
const char* TOPIC = "transitsense/live/parking";

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
    String id = "transitsense-parking-" + String(esp_random(), HEX);
    if (mqtt.connect(id.c_str())) {
      Serial.println("Connected to the TransitSense website feed");
      mqtt.publish(TOPIC, "{\"state\":\"online\"}");
    }
  }
  mqtt.loop();
}

void sendEvent(const String& json) {
  if (mqtt.connected()) mqtt.publish(TOPIC, json.c_str());
  Serial.print("Website <- ");
  Serial.println(json);
}
// ---- End of live link ----

const int TRIG = 5;
const int ECHO = 18;
const int ETA_PIN = 34;  // ESP32 ADC input (0 to 4095)

const int RED_LED = 25;
const int GREEN_LED = 26;

const float OCCUPIED_CM = 50.0;
const int ASSUMED_RELEASE_MIN = 10;

String lastStatus = "";
int lastEta = -1;

float readDistance() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(3);

  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  unsigned long duration = pulseIn(ECHO, HIGH, 25000UL);

  if (duration == 0) {
    return -1;
  }

  return duration / 58.0;
}

// Sends the bay status to the website when the status or the arrival time changes.
void report(const String& status, float distance, int etaMinutes) {
  if (status == lastStatus && etaMinutes == lastEta) return;
  lastStatus = status;
  lastEta = etaMinutes;
  sendEvent("{\"state\":\"" + status + "\",\"distance\":" + String(distance, 0) +
            ",\"eta\":" + etaMinutes + "}");
}

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  pinMode(RED_LED, OUTPUT);
  pinMode(GREEN_LED, OUTPUT);

  Serial.begin(115200);

  Serial.println("================================");
  Serial.println(" PREDICTIVE SMART PARKING");
  Serial.println("================================");
  Serial.println("System ready!");
  startWifi();
}

void loop() {
  keepOnline();
  float distance = readDistance();

  // Simulated driver arrival time: 0 to 20 minutes
  int etaMinutes = map(analogRead(ETA_PIN), 0, 4095, 0, 20);

  Serial.println();
  Serial.println("----- PARKING STATUS -----");

  if (distance < 0) {
    digitalWrite(RED_LED, HIGH);
    digitalWrite(GREEN_LED, LOW);

    Serial.println("Status: SENSOR ERROR / UNKNOWN");
    Serial.println("Do not assume the space is free.");
    report("error", distance, etaMinutes);
  } else {
    bool occupied = distance <= OCCUPIED_CM;

    Serial.print("Measured distance: ");
    Serial.print(distance);
    Serial.println(" cm");

    if (!occupied) {
      digitalWrite(GREEN_LED, HIGH);
      digitalWrite(RED_LED, LOW);

      Serial.println("Status: AVAILABLE NOW");
      report("available", distance, etaMinutes);
    } else if (etaMinutes >= ASSUMED_RELEASE_MIN) {
      digitalWrite(GREEN_LED, HIGH);
      digitalWrite(RED_LED, LOW);

      Serial.println("Status: PREDICTED AVAILABLE BY ARRIVAL");
      Serial.println("Assumption: vehicle leaves in 10 minutes.");
      report("predicted", distance, etaMinutes);
    } else {
      digitalWrite(GREEN_LED, LOW);
      digitalWrite(RED_LED, HIGH);

      Serial.println("Status: LIKELY OCCUPIED AT ARRIVAL");
      report("occupied", distance, etaMinutes);
    }
  }

  Serial.print("Driver arrival ETA: ");
  Serial.print(etaMinutes);
  Serial.println(" minutes");

  Serial.println("--------------------------");

  // Check the link often, so the website gets changes within about a second.
  for (int i = 0; i < 10; i++) {
    keepOnline();
    delay(100);
  }
}
