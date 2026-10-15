# TransitSense — 3D Smart City Simulation

![TransitSense preview](transitsense-preview.jpg)

An interactive Three.js concept showcase of smart-traffic features at a residential crossing and a busy urban junction.

**Live site:** https://raynaagarwal01-rgb.github.io/TransitSense/

- **Junction warning:** approach posts turn red for cross traffic, with a sensor-fault fail-safe.
- **Ambulance priority:** signals clear the junction and hold green for an ambulance, with a live siren sound (Doppler shift and stereo panning).
- **Magnetic signature:** vehicle classes detected by an embedded magnetometer, with example waveforms.
- **Predictive parking:** pick your arrival time and TransitSense predicts *whether* a bay will be free and *which one*, then guides your car to it (or turns it away when the garage is predicted full). A rush-hour mode shows the full-garage case.

Every sensor label marked **i** opens the real hardware: a rotating 3D model of the module, how it works, parts and ESP32 wiring, and the Arduino code.

## Hardware

The [`hardware/`](hardware/) folder holds ESP32 / Arduino sketches for each sensor
(TFmini-S LiDAR, 2× INMP441 microphones, QMC5883L magnetometer, ESP32-CAM) and the Python bay
predictor that runs on the server. They compile on ESP32 core 3.x but have not been tested on physical hardware yet. See [hardware/README.md](hardware/README.md) for parts and wiring.

## Run

- **Quick:** open `transitsense.html` (single self-contained file) in a current browser.
- **From source:** `python3 -m http.server 4173 --directory dist`, then open http://localhost:4173.

## Editing

Edit the files in `dist/` (and the sketches in `hardware/`), then rebuild the single-file site:

```sh
node build.mjs        # updates dist/sensor-code.mjs and transitsense.html
node check.mjs
node traffic-check.mjs
```

No package installation is required. See [START-HERE.txt](START-HERE.txt) for controls and scope notes.
This is a concept demo and is not validated for real-road or emergency-control use.
