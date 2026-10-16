# Wokwi → website live link

These are the four Wokwi simulations, moved from an Arduino Uno to an ESP32 so they can reach
the internet. When something happens in a simulation, the TransitSense website reacts within
about a second:

| Simulation | Original Wokwi project | What the website does |
|---|---|---|
| [`junction_warning/`](junction_warning/) | [477878444686833665](https://wokwi.com/projects/477878444686833665) | Approach confirmed (A then B) → a car drives up to the blind corner and the cross posts turn red. Sensor fault → all posts red. |
| [`emergency_priority/`](emergency_priority/) | [477879314711626753](https://wokwi.com/projects/477879314711626753) | Emergency button → an ambulance is dispatched and the junction clears for it. |
| [`vehicle_counter/`](vehicle_counter/) | [477879876404632577](https://wokwi.com/projects/477879876404632577) | Two-wheeler / car / heavy button → that vehicle drives over the magnetometer and is counted. |
| [`smart_parking/`](smart_parking/) | [477880391347889153](https://wokwi.com/projects/477880391347889153) | Bay status and the arrival-time knob → the arrival time on the site follows the knob and the bay status shows in the feed. |

Every event also appears in the live feed on the site. **Follow** (top right) makes the site jump
to the matching demo when an event arrives; turn it off to stay where you are.

## All four on one ESP32

[`transitsense_all/`](transitsense_all/) puts all four systems in a single Wokwi project with one ESP32.
They run side by side without blocking each other and send the same events as the separate
projects, so the website works with either. It uses one shared buzzer (the emergency tone wins).

| System | Parts | ESP32 pins |
|---|---|---|
| 1 · Junction warning | Sensor A, Sensor B, red / yellow / green LEDs | TRIG 5, 19 · ECHO 34, 35 · LEDs 25, 26, 27 |
| 2 · Emergency priority | Red button, red / yellow / green LEDs | Button 4 · LEDs 32, 33, 14 |
| 3 · Vehicle counter | Two-wheeler / car / heavy buttons and LEDs | Buttons 16, 17, 18 · LEDs 21, 22, 23 |
| 4 · Smart parking | Bay sensor, arrival-time knob, red / green LEDs | TRIG 2 · ECHO VP (36) · knob VN (39) · LEDs 12, 15 |
| Shared | Buzzer | 13 |

## How it works

```
Wokwi ESP32 ──Wi-Fi (Wokwi-GUEST)──▶ MQTT broker.hivemq.com:1883 ──WebSocket (wss :8884)──▶ website
             publishes transitsense/live/<sim>                    subscribes transitsense/live/#
```

Each sketch publishes a small JSON message when its state changes, for example
`{"state":"detected","vehicle":"car","bikes":0,"cars":3,"heavy":1,"total":4}` on
`transitsense/live/counter`. The website connects with a small built-in MQTT client
([`dist/live.mjs`](../dist/live.mjs)), so it still needs no installation and works from GitHub Pages
or the single `transitsense.html` file.

## Put the sketches in Wokwi

For the combined project (or each of the four separate ones), in a new or copied Wokwi ESP32 project:

1. Open the Wokwi project and sign in (use **Save a copy** if it isn't yours).
2. Replace `sketch.ino` and `diagram.json` with the files from this folder.
3. Add a file named `libraries.txt` containing `PubSubClient` (Wokwi's "+" next to the file tabs, or Library Manager → PubSubClient).
4. Start the simulation. The serial monitor prints `Connected to the TransitSense website feed`,
   and the site's feed shows "Simulation connected".

The board is now an ESP32 DevKitC; the wiring and logic are otherwise the same as the Uno
version. Pin changes: LEDs on GPIO 25/26/27, buzzer on GPIO 13, buttons on GPIO 4/16/17,
ultrasonic sensors on GPIO 5/18 and 19/21, and the arrival-time knob on GPIO 34.

## Notes

- The broker is public: anyone who knows the topic can read or send events. The site only accepts
  the known simulations and fields, so stray messages are ignored. To use your own topic, change
  `TOPIC` in each sketch and open the site with `?topic=your/prefix`.
- `?broker=wss://…` points the site at a different broker; `?wokwi=off` hides the live link.
- The website must be open while the simulation runs; events are not stored.
