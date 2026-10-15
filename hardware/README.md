# TransitSense hardware

Real ESP32 / Arduino versions of the four sensors in the simulation. The website's
"Hardware & code" popups show these exact files (`node build.mjs` copies them into
`dist/sensor-code.mjs`).

| Demo | Sensor | Controller | Sketch |
|---|---|---|---|
| Junction warning | Benewake TFmini-S LiDAR (one per approach) + WS2812B LED ring | ESP32 DevKitC | [`junction_warning/`](junction_warning/junction_warning.ino) |
| Ambulance priority | 2× INMP441 I²S MEMS microphone + PC817 optocoupler | ESP32 DevKitC | [`siren_priority/`](siren_priority/siren_priority.ino) |
| Magnetic signature | QMC5883L magnetometer (GY-271 module) | ESP32 DevKitC | [`magnetic_counter/`](magnetic_counter/magnetic_counter.ino) |
| Predictive parking | AI-Thinker ESP32-CAM (OV2640), one per zone | ESP32-CAM | [`parking_camera/`](parking_camera/parking_camera.ino) |
| Predictive parking (server) | — | Any computer with Python 3.10+ | [`parking_server/bay_predictor.py`](parking_server/bay_predictor.py) |

## Wiring

**Junction warning post** — TFmini-S `5V`→5V, `GND`→GND, `TX`→GPIO16, `RX`→GPIO17 ·
WS2812B `DIN`→GPIO4 through 330 Ω, `5V`/`GND`→5V/GND. Set `APPROACH_ID` (0–3) differently on each of the four posts.

**Siren locator** — both INMP441s: `VDD`→3.3V, `GND`→GND, `SCK`→GPIO26, `WS`→GPIO25, `SD`→GPIO33.
Mic A `L/R`→GND (left), Mic B `L/R`→3.3V (right). Mount them 50 cm apart (or change `MIC_SPACING_M`).
GPIO27 → 330 Ω → PC817 LED; the PC817 output goes to the signal controller's priority input.

**Magnetic counter** — GY-271 `VCC`→3.3V, `GND`→GND, `SDA`→GPIO21, `SCL`→GPIO22.
Set your Wi-Fi and MQTT broker at the top of the sketch.

**Parking camera** — 5 V 2 A supply. To upload, connect a 3.3 V FTDI adapter (`TX`→U0R, `RX`→U0T),
hold GPIO0 to GND while resetting, then release it. Set your Wi-Fi and the zone's server URL.

## Building

1. Install the Arduino IDE (or `arduino-cli`) and the **esp32 by Espressif** board package, version 3.x.
2. Install the libraries each sketch lists at the top: Adafruit NeoPixel, arduinoFFT 2.x, PubSubClient.
3. Pick the board ("ESP32 Dev Module", or "AI Thinker ESP32-CAM" for the camera) and upload.

All four sketches compile without warnings on esp32 core 3.3.12:

```sh
arduino-cli compile -b esp32:esp32:esp32 hardware/junction_warning
arduino-cli compile -b esp32:esp32:esp32cam hardware/parking_camera
```

Run the bay predictor example with `python3 hardware/parking_server/bay_predictor.py`.

## Status

The sketches compile, but they have not been tested on physical hardware. Thresholds (closing
speed, siren band, magnetic peaks) are starting points to calibrate on site. Not validated for
real-road or emergency-control use.
