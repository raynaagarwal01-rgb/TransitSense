// TransitSense · Vehicle counting and classification (Wokwi, ESP32)
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
const char* TOPIC = "transitsense/live/counter";

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
    String id = "transitsense-counter-" + String(esp_random(), HEX);
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

const int BIKE_BUTTON = 4;
const int CAR_BUTTON = 16;
const int HEAVY_BUTTON = 17;

const int BIKE_LED = 25;
const int CAR_LED = 26;
const int HEAVY_LED = 27;

unsigned long bikes = 0;
unsigned long cars = 0;
unsigned long heavy = 0;

bool lastBike = HIGH;
bool lastCar = HIGH;
bool lastHeavy = HIGH;

unsigned long lastBikeTime = 0;
unsigned long lastCarTime = 0;
unsigned long lastHeavyTime = 0;

const unsigned long DEBOUNCE_MS = 250;

// Tells the website a vehicle was detected, with the running counts.
void reportVehicle(const char* vehicle) {
  sendEvent(String("{\"state\":\"detected\",\"vehicle\":\"") + vehicle +
            "\",\"bikes\":" + bikes + ",\"cars\":" + cars +
            ",\"heavy\":" + heavy + ",\"total\":" + (bikes + cars + heavy) + "}");
}

void setup() {
  pinMode(BIKE_BUTTON, INPUT_PULLUP);
  pinMode(CAR_BUTTON, INPUT_PULLUP);
  pinMode(HEAVY_BUTTON, INPUT_PULLUP);

  pinMode(BIKE_LED, OUTPUT);
  pinMode(CAR_LED, OUTPUT);
  pinMode(HEAVY_LED, OUTPUT);

  Serial.begin(115200);

  Serial.println("================================");
  Serial.println(" VEHICLE COUNTING SYSTEM");
  Serial.println(" WITH TRAFFIC LEVEL DETECTION");
  Serial.println("================================");
  Serial.println("System ready!");
  Serial.println("Press a button to simulate a vehicle.");
  Serial.println();
  startWifi();
}

void loop() {
  keepOnline();
  unsigned long now = millis();

  bool bike = digitalRead(BIKE_BUTTON);
  bool car = digitalRead(CAR_BUTTON);
  bool truck = digitalRead(HEAVY_BUTTON);

  // Detect two-wheeler
  if (lastBike == HIGH && bike == LOW &&
      now - lastBikeTime >= DEBOUNCE_MS) {
    bikes++;
    lastBikeTime = now;

    digitalWrite(BIKE_LED, HIGH);
    Serial.println("Detected: TWO-WHEELER");
    reportVehicle("bike");
  } else if (bike == HIGH) {
    digitalWrite(BIKE_LED, LOW);
  }

  // Detect car
  if (lastCar == HIGH && car == LOW &&
      now - lastCarTime >= DEBOUNCE_MS) {
    cars++;
    lastCarTime = now;

    digitalWrite(CAR_LED, HIGH);
    Serial.println("Detected: CAR");
    reportVehicle("car");
  } else if (car == HIGH) {
    digitalWrite(CAR_LED, LOW);
  }

  // Detect heavy vehicle
  if (lastHeavy == HIGH && truck == LOW &&
      now - lastHeavyTime >= DEBOUNCE_MS) {
    heavy++;
    lastHeavyTime = now;

    digitalWrite(HEAVY_LED, HIGH);
    Serial.println("Detected: HEAVY VEHICLE");
    reportVehicle("heavy");
  } else if (truck == HIGH) {
    digitalWrite(HEAVY_LED, LOW);
  }

  lastBike = bike;
  lastCar = car;
  lastHeavy = truck;

  // Display summary every 2 seconds
  static unsigned long lastReport = 0;

  if (now - lastReport >= 2000) {
    lastReport = now;

    unsigned long total = bikes + cars + heavy;

    Serial.println();
    Serial.println("----- VEHICLE COUNT SUMMARY -----");

    Serial.print("Two-wheelers: ");
    Serial.println(bikes);

    Serial.print("Cars: ");
    Serial.println(cars);

    Serial.print("Heavy vehicles: ");
    Serial.println(heavy);

    Serial.print("Total vehicles: ");
    Serial.println(total);

    // Traffic classification
    Serial.print("Traffic Level: ");

    if (total < 5) {
      Serial.println("LIGHT TRAFFIC");
    } else if (total < 10) {
      Serial.println("MODERATE TRAFFIC");
    } else {
      Serial.println("HEAVY TRAFFIC");
    }

    Serial.println("---------------------------------");
    Serial.println();
  }

  delay(20);
}
