// Real-hardware popups: a rotating 3D model of each sensor module, how it works,
// parts and ESP32 wiring, and the Arduino code from the repository's hardware/ folder.
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import CODE from './sensor-code.mjs';

export const SENSORS = {
  lidar: {
    name: 'Benewake TFmini-S LiDAR',
    role: 'Junction warning · one sensor per approach',
    chips: ['Range 0.1–12 m', 'Up to 100 Hz', 'UART · 115200 baud', '5 V supply'],
    how: [
      'The TFmini-S fires short pulses of infrared light down its approach and times how long the reflection takes to come back (time of flight). It reports the distance to the nearest vehicle up to 100 times a second over a serial line.',
      'The post’s ESP32 compares successive distances. If the gap keeps shrinking faster than 0.8 m/s, a vehicle is approaching. A steady distance (a parked car) or a growing one (a car driving away) is ignored.',
      'The four posts talk to each other over ESP-NOW, Espressif’s low-latency peer-to-peer radio. While one approach is active, its post stays green and the other three turn red. If a sensor or a post goes silent, every lamp fails safe to steady red.',
    ],
    flow: ['TFmini-S measures distance', 'ESP32 works out closing speed', 'ESP-NOW shares it with the other posts', 'WS2812B ring shows red or green'],
    parts: [
      ['Benewake TFmini-S LiDAR', 'Distance to the vehicle on this approach'],
      ['ESP32 DevKitC (ESP32-WROOM-32)', 'Detects approaches, runs the ESP-NOW link'],
      ['WS2812B 16-LED ring', 'Red / green lamp on the warning post'],
      ['330 Ω resistor · 1000 µF capacitor', 'Protect the LED data line and supply'],
      ['5 V 2 A power supply', 'Powers the post'],
    ],
    wiring: [['TFmini-S 5V', '5V'], ['TFmini-S GND', 'GND'], ['TFmini-S TX', 'GPIO16 (RX2)'], ['TFmini-S RX', 'GPIO17 (TX2)'], ['WS2812B DIN', 'GPIO4 (through 330 Ω)'], ['WS2812B 5V · GND', '5V · GND']],
    code: ['junction_warning.ino'],
    toolchain: 'Arduino-ESP32 core 3.x · library: Adafruit NeoPixel',
    model: lidarModel,
  },
  mic: {
    name: 'INMP441 I²S MEMS microphone ×2',
    role: 'Ambulance priority · acoustic siren locator',
    chips: ['Digital I²S output', '24-bit', 'SNR 61 dB', '60 Hz–15 kHz', '3.3 V'],
    how: [
      'Two INMP441 microphones sit 50 cm apart on a pole beside the approach. They share one I²S bus: one is wired as the left channel and the other as the right, so the ESP32 receives perfectly synchronised samples from both.',
      'Every 64 ms the ESP32 runs an FFT to find the loudest pitch. A siren stays between about 500 and 1800 Hz and keeps sweeping up and down. Cross-correlating the two channels gives the tiny delay between the microphones, which shows where the sound is coming from.',
      'Only a siren from the right direction that is getting louder counts as an approaching ambulance. A reflection off a building is steadier, fainter and has no clear direction, so it is rejected. A confirmed approach switches an optocoupler that asks the signal controller to clear the junction and hold that approach green.',
    ],
    flow: ['2× INMP441 record stereo audio', 'FFT finds the siren’s pitch', 'Cross-correlation finds its direction', 'Optocoupler requests priority from the signals'],
    parts: [
      ['2× INMP441 I²S MEMS microphone', 'Synchronised left / right audio'],
      ['ESP32 DevKitC (ESP32-WROOM-32)', 'FFT, direction finding and the decision'],
      ['PC817 optocoupler · 330 Ω resistor', 'Isolated priority request to the signal controller'],
      ['Weatherproof box with acoustic mesh', 'Keeps rain off the microphones'],
    ],
    wiring: [['Both mics VDD', '3.3V'], ['Both mics GND', 'GND'], ['Both mics SCK', 'GPIO26'], ['Both mics WS', 'GPIO25'], ['Both mics SD', 'GPIO33'], ['Mic A L/R', 'GND (left channel)'], ['Mic B L/R', '3.3V (right channel)'], ['PC817 anode (through 330 Ω)', 'GPIO27']],
    code: ['siren_priority.ino'],
    toolchain: 'Arduino-ESP32 core 3.x · library: arduinoFFT 2.x',
    model: micModel,
  },
  magnetometer: {
    name: 'QMC5883L 3-axis magnetometer (GY-271)',
    role: 'Magnetic signature · vehicle counting and classification',
    chips: ['3-axis', '±2 / ±8 gauss', 'Up to 200 Hz', 'I²C · address 0x0D', '3.3 V'],
    how: [
      'The QMC5883L measures the Earth’s magnetic field in three directions. Sealed in a road stud in the middle of the lane, it sees the field bend whenever a vehicle’s steel body passes overhead.',
      'The ESP32 learns what the empty road looks like, then watches for the field to move away from that baseline. It records how strong the disturbance gets (peak) and how long it lasts (duration).',
      'Two-wheelers give small, short signatures, cars medium ones, and trucks large or long ones. Each vehicle is counted, classified and published over MQTT to the TransitSense server. A second stud a metre away can add speed and vehicle length.',
    ],
    flow: ['QMC5883L samples the field at 100 Hz', 'ESP32 subtracts the empty-road baseline', 'Peak and duration classify the vehicle', 'MQTT publishes the count'],
    parts: [
      ['QMC5883L magnetometer (GY-271 module)', 'Measures the magnetic field'],
      ['ESP32 DevKitC (ESP32-WROOM-32)', 'Detection, classification, Wi-Fi and MQTT'],
      ['Sealed road stud · cable duct', 'Protects the sensor in the lane'],
      ['Wi-Fi access point · MQTT broker (e.g. Mosquitto)', 'Receives the counts'],
    ],
    wiring: [['GY-271 VCC', '3.3V'], ['GY-271 GND', 'GND'], ['GY-271 SDA', 'GPIO21'], ['GY-271 SCL', 'GPIO22'], ['GY-271 DRDY', 'Not connected (the status register is polled)']],
    code: ['magnetic_counter.ino'],
    toolchain: 'Arduino-ESP32 core 3.x · library: PubSubClient',
    model: magnetometerModel,
  },
  camera: {
    name: 'AI-Thinker ESP32-CAM (OV2640)',
    role: 'Predictive parking · one camera per zone',
    chips: ['OV2640 · 2 MP', 'Wi-Fi 802.11 b/g/n', 'PSRAM frame buffer', '5 V supply'],
    how: [
      'Each zone has an ESP32-CAM on the ceiling, looking down on its ten bays. Every 10 seconds it takes a JPEG and sends it over Wi-Fi to the TransitSense server.',
      'The server checks each bay outline in the picture and marks it free or occupied. Comparing pictures over time shows when each car arrived and left, so the server learns how many cars arrive and leave per minute and which parked cars are likely to leave first.',
      'When you choose your arrival time, the bay predictor replays the expected departures and arrivals bay by bay. Earlier drivers take the nearest free bays; you are offered the best bay still free when you arrive, plus a backup, or told when the next bay should open.',
    ],
    flow: ['ESP32-CAM photographs the zone', 'Server marks each bay free or occupied', 'History gives arrival and departure rates', 'Bay predictor offers you a bay'],
    parts: [
      ['AI-Thinker ESP32-CAM (OV2640)', 'Photographs one zone of ten bays'],
      ['3.3 V FTDI USB-serial adapter', 'Uploads the sketch (the board has no USB port)'],
      ['5 V 2 A power supply', 'Powers the camera'],
      ['Server running bay_predictor.py', 'Occupancy, history and bay prediction'],
    ],
    wiring: [['ESP32-CAM 5V · GND', '5 V supply'], ['ESP32-CAM U0R', 'FTDI TX (uploading only)'], ['ESP32-CAM U0T', 'FTDI RX (uploading only)'], ['ESP32-CAM GPIO0', 'GND while uploading, then open'], ['Flash LED', 'GPIO4 (on the board)']],
    code: ['parking_camera.ino', 'bay_predictor.py'],
    toolchain: 'Arduino-ESP32 core 3.x (board: AI Thinker ESP32-CAM) · server: Python 3.10+',
    model: cameraModel,
  },
};

// ---------- 3D models (units: centimetres) ----------
const materials = new Map();
const M = (color, options = {}) => {
  const key = color + JSON.stringify(options);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({color, roughness: .6, metalness: .1, ...options}));
  return materials.get(key);
};
const GOLD = () => M('#d6b25e', {metalness: .9, roughness: .3});
const STEEL = () => M('#c9ced2', {metalness: .85, roughness: .32});
const GLASS = () => M('#10303f', {metalness: .6, roughness: .06, emissive: '#06141c'});
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, h, s = 28) => new THREE.CylinderGeometry(r, r, h, s);
function add(group, geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  group.add(mesh);
  return mesh;
}
// A row of 2.54 mm header pins pointing down, along x (or along z when alongZ).
function header(group, count, x, z, alongZ = false) {
  const step = .254, length = count * step;
  add(group, alongZ ? box(step, .25, length) : box(length, .25, step), M('#141414'), x, -.19, z);
  for (let i = 0; i < count; i++) {
    const offset = -length / 2 + step / 2 + i * step;
    add(group, box(.064, .62, .064), GOLD(), alongZ ? x : x + offset, -.46, alongZ ? z + offset : z);
  }
}
function smd(group, x, z, y = .1, color = '#b8925a') { add(group, box(.16, .08, .09), M(color), x, y, z) }

function lidarModel() {
  const g = new THREE.Group(), shell = M('#23282c', {roughness: .45});
  add(g, box(4.2, 1.5, 1.6), shell, 0, 0, 0);
  add(g, box(3.5, 1.15, .06), M('#14181b'), 0, 0, .81);
  for (const x of [-.95, .95]) {
    add(g, cyl(.5, .1), GLASS(), x, 0, .84, Math.PI / 2);
    add(g, new THREE.TorusGeometry(.52, .05, 10, 36), STEEL(), x, 0, .87);
  }
  for (const side of [-1, 1]) {
    add(g, box(.55, .22, 1.2), shell, side * 2.37, -.64, 0);
    add(g, cyl(.13, .24), M('#0b0d0f'), side * 2.42, -.64, 0);
  }
  add(g, box(2, .02, .7), M('#3a4248'), 0, .76, -.1);
  add(g, box(.95, .45, .35), M('#e9e5d8'), 0, -.25, -.95);
  ['#d23b2f', '#1b1b1b', '#ececec', '#2f9e57'].forEach((color, i) => add(g, cyl(.06, 2.1, 10), M(color), -.3 + i * .2, -.25, -2.05, Math.PI / 2));
  return g;
}
function micModel() {
  const g = new THREE.Group();
  add(g, cyl(.75, .12, 48), M('#3b2f86'), 0, 0, 0);
  add(g, box(.47, .1, .38), STEEL(), 0, .11, -.12);
  add(g, cyl(.05, .02, 16), M('#0c0c0c'), 0, .17, -.12);
  smd(g, .38, .1);
  smd(g, -.38, .1);
  smd(g, .1, .22, .1, '#2a2a2a');
  header(g, 6, 0, .42);
  return g;
}
function magnetometerModel() {
  const g = new THREE.Group();
  add(g, box(1.4, .12, 1.9), M('#1f5ca8'), 0, 0, 0);
  add(g, box(.3, .09, .3), M('#161616'), 0, .1, -.2);
  add(g, box(.29, .1, .16), M('#161616'), -.38, .1, .3);
  smd(g, .35, .25);
  smd(g, .35, .05);
  smd(g, -.35, -.25);
  add(g, new THREE.TorusGeometry(.13, .04, 10, 28), GOLD(), .45, .065, -.62, Math.PI / 2);
  add(g, cyl(.09, .14), M('#0a1a2e'), .45, 0, -.62);
  header(g, 5, 0, .8);
  return g;
}
function cameraModel() {
  const g = new THREE.Group();
  add(g, box(2.7, .12, 4), M('#1c2024'), 0, 0, 0);
  add(g, box(1.75, .26, 1.8), STEEL(), 0, .19, -.75);
  add(g, box(1.6, .02, .2), GOLD(), 0, .07, -1.83);
  add(g, box(.85, .3, .85), M('#151515'), 0, .21, 1);
  add(g, cyl(.33, .5), M('#202020'), 0, .58, 1);
  add(g, cyl(.24, .03), GLASS(), 0, .84, 1);
  add(g, box(.32, .12, .32), M('#f4f1e6', {emissive: '#5a5440'}), .85, .12, 1.55);
  add(g, box(1.45, .16, 1.5), STEEL(), 0, -.14, .8);
  header(g, 8, 1.2, 0, true);
  header(g, 8, -1.2, 0, true);
  smd(g, -.9, 1.7);
  smd(g, -.6, 1.7, .1, '#2a2a2a');
  return g;
}

// ---------- Code display ----------
const escape = text => text.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]);
// Light syntax colouring: strings, comments and preprocessor lines.
function highlight(source, python) {
  let docstring = false;
  return source.split('\n').map(line => {
    if (python && (docstring || line.trim().startsWith('"""'))) {
      const quotes = (line.match(/"""/g) || []).length;
      if (quotes % 2) docstring = !docstring;
      return '<span class="tok-str">' + escape(line) + '</span>';
    }
    if (!python && /^\s*#/.test(line)) return '<span class="tok-pre">' + escape(line) + '</span>';
    let out = '', i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
        out += '<span class="tok-str">' + escape(line.slice(i, j + 1)) + '</span>';
        i = j + 1;
      } else if ((!python && line.startsWith('//', i)) || (python && c === '#')) {
        out += '<span class="tok-com">' + escape(line.slice(i)) + '</span>';
        break;
      } else {
        out += escape(c);
        i++;
      }
    }
    return out;
  }).join('\n');
}

// ---------- Dialog ----------
let dialog, viewer = null, current = null, tab = 'how', file = null;
const $ = selector => dialog.querySelector(selector);

function ensureViewer() {
  if (viewer) return viewer;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({antialias: true, alpha: true}); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, .05, 200);
  scene.add(new THREE.HemisphereLight('#e8f4f6', '#26343a', 2.4));
  const key = new THREE.DirectionalLight('#fff1dc', 2.8);
  key.position.set(3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#8fd0e6', 1.4);
  rim.position.set(-5, 2, -4);
  scene.add(rim);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, {enableDamping: true, enablePan: false, autoRotate: true, autoRotateSpeed: 1.8});
  viewer = {renderer, scene, camera, controls, model: null, running: false};
  return viewer;
}

function showModel(sensor) {
  const v = ensureViewer(), holder = $('#hw-model');
  if (!v) { holder.classList.add('no-webgl'); return; }
  if (v.renderer.domElement.parentNode !== holder) holder.prepend(v.renderer.domElement);
  if (v.model) v.scene.remove(v.model);
  v.model = sensor.model();
  v.scene.add(v.model);
  const sphere = new THREE.Box3().setFromObject(v.model).getBoundingSphere(new THREE.Sphere());
  v.model.position.sub(sphere.center);
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(v.camera.fov / 2)) * 1.08;
  v.camera.position.set(distance * .55, distance * .5, distance * .67);
  v.controls.minDistance = distance * .5;
  v.controls.maxDistance = distance * 2;
  v.controls.target.set(0, 0, 0);
  v.controls.update();
  if (!v.running) { v.running = true; requestAnimationFrame(render); }
}

function render() {
  if (!dialog.open) { viewer.running = false; return; }
  requestAnimationFrame(render);
  const holder = viewer.renderer.domElement.parentNode, size = viewer.renderer.getSize(new THREE.Vector2());
  const w = holder.clientWidth, h = holder.clientHeight;
  if (size.x !== w || size.y !== h) {
    viewer.renderer.setSize(w, h, false);
    viewer.camera.aspect = w / Math.max(1, h);
    viewer.camera.updateProjectionMatrix();
  }
  viewer.controls.update();
  viewer.renderer.render(viewer.scene, viewer.camera);
}

function renderTab() {
  const s = SENSORS[current];
  dialog.querySelectorAll('[data-hw-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.hwTab === tab));
  const panel = $('#hw-panel');
  if (tab === 'how') {
    panel.innerHTML = s.how.map(p => '<p>' + p + '</p>').join('') +
      '<ol class="hw-flow">' + s.flow.map(step => '<li>' + step + '</li>').join('') + '</ol>';
  } else if (tab === 'wiring') {
    panel.innerHTML = '<h3>Parts</h3><table class="hw-table"><tbody>' + s.parts.map(([part, role]) => '<tr><th>' + part + '</th><td>' + role + '</td></tr>').join('') + '</tbody></table>' +
      '<h3>Wiring to the ESP32</h3><table class="hw-table hw-wiring"><thead><tr><th>Module pin</th><th>Connect to</th></tr></thead><tbody>' + s.wiring.map(([pin, to]) => '<tr><td>' + pin + '</td><td>' + to + '</td></tr>').join('') + '</tbody></table>';
  } else {
    if (!s.code.includes(file)) file = s.code[0];
    const python = file.endsWith('.py');
    panel.innerHTML = (s.code.length > 1 ? '<div class="hw-files" role="group" aria-label="Code files">' + s.code.map(f => '<button data-file="' + f + '" aria-pressed="' + (f === file) + '">' + f + '</button>').join('') + '</div>' : '') +
      '<div class="hw-code-bar"><span>' + file + '</span><span class="hw-code-actions"><button id="hw-copy">Copy</button><button id="hw-download">Download</button></span></div>' +
      '<pre class="hw-code"><code>' + highlight(CODE[file], python) + '</code></pre>' +
      '<p class="hw-toolchain">' + s.toolchain + '</p>';
    panel.querySelectorAll('[data-file]').forEach(b => b.addEventListener('click', () => { file = b.dataset.file; renderTab(); }));
    $('#hw-copy').addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(CODE[file]); e.target.textContent = 'Copied'; }
      catch { e.target.textContent = 'Select and copy'; }
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1600);
    });
    $('#hw-download').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([CODE[file]], {type: 'text/plain'})), a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
}

export function openHardware(key, startTab = 'how') {
  if (!SENSORS[key]) return;
  current = key;
  tab = startTab;
  file = null;
  const s = SENSORS[key];
  $('#hw-role').textContent = s.role;
  $('#hw-title').textContent = s.name;
  $('#hw-chips').innerHTML = s.chips.map(c => '<li>' + c + '</li>').join('');
  renderTab();
  if (!dialog.open) dialog.showModal();
  showModel(s);
}

export function initHardware(element) {
  dialog = element;
  dialog.querySelectorAll('[data-hw-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.hwTab; renderTab(); }));
  $('.close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
}
