// TransitSense · Ambulance priority (acoustic siren locator)
// Hardware: ESP32 DevKitC · 2× INMP441 I2S MEMS microphones · PC817 optocoupler to the signal controller
// Board: "ESP32 Dev Module" (Arduino-ESP32 core 3.x) · Library: arduinoFFT 2.x
//
// Both microphones share one I2S bus: Mic A has L/R tied to GND (left slot),
// Mic B has L/R tied to 3.3 V (right slot), so every stereo frame holds one
// synchronised sample from each. For each 64 ms block the sketch:
//   1. finds the loudest frequency (FFT). Sirens sweep between ~500 and 1800 Hz;
//   2. measures the time difference between the microphones (cross-correlation)
//      to get the direction the sound comes from;
//   3. checks that the sound is getting louder (a real approach). A reflection off
//      a building is steady or fading and usually has a weak correlation peak.
// When all three agree, the PREEMPT output asks the signal controller to clear
// the junction and hold the ambulance's approach green.

#include <ESP_I2S.h>
#include <arduinoFFT.h>

const int I2S_SCK = 26, I2S_WS = 25, I2S_SD = 33;  // shared by both INMP441s
const int PREEMPT_PIN = 27;                         // drives the optocoupler LED (HIGH = request priority)
const int STATUS_LED = 2;

const uint32_t SAMPLE_RATE = 16000;
const uint16_t N = 1024;                 // samples per block (64 ms)
const float MIC_SPACING_M = 0.50;        // distance between the two microphones
const float SOUND_SPEED = 343.0;
const int MAX_LAG = 24;                  // ≥ spacing / (speed / rate) = 23.3 samples

const float SIREN_MIN_HZ = 500, SIREN_MAX_HZ = 1800;
const float MIN_SWEEP_HZ = 150;          // a siren's pitch must move by at least this much
const float MIN_RISE_DB = 1.5;           // level increase across the history window
const float MAX_BEARING_DEG = 35;        // accept sirens within ±35° of the approach axis
const uint32_t RELEASE_MS = 3000;        // keep priority this long after the siren stops

const int HISTORY = 24;                  // ~1.5 s of blocks

I2SClass i2s;
int32_t raw[N * 2];
float left[N], right[N];
double vReal[N], vImag[N];
ArduinoFFT<double> fft(vReal, vImag, N, SAMPLE_RATE);

float peakHistory[HISTORY], levelHistory[HISTORY];
int historyCount = 0;
uint32_t lastConfirmed = 0;

void pushHistory(float *history, float value) {
  memmove(history, history + 1, (HISTORY - 1) * sizeof(float));
  history[HISTORY - 1] = value;
}

float average(const float *values, int from, int to) {
  float sum = 0;
  for (int i = from; i < to; i++) sum += values[i];
  return sum / (to - from);
}

// Returns the lag (in samples) where the two channels line up best, and how
// clearly it stands out compared with the average correlation.
int bestLag(float &sharpness) {
  float best = -1e30, total = 0;
  int lagAtBest = 0;
  for (int lag = -MAX_LAG; lag <= MAX_LAG; lag++) {
    float sum = 0;
    for (int i = MAX_LAG; i < N - MAX_LAG; i++) sum += left[i] * right[i + lag];
    total += fabsf(sum);
    if (sum > best) { best = sum; lagAtBest = lag; }
  }
  float mean = total / (2 * MAX_LAG + 1);
  sharpness = mean > 0 ? best / mean : 0;
  return lagAtBest;
}

void setup() {
  Serial.begin(115200);
  pinMode(PREEMPT_PIN, OUTPUT);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(PREEMPT_PIN, LOW);
  i2s.setPins(I2S_SCK, I2S_WS, -1, I2S_SD);
  if (!i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO)) {
    Serial.println("I2S init failed");
    while (true) delay(1000);
  }
}

void loop() {
  size_t bytes = i2s.readBytes((char *)raw, sizeof(raw));
  if (bytes < sizeof(raw)) return;

  // INMP441 sends 24-bit samples left-aligned in 32-bit slots.
  float meanL = 0, meanR = 0;
  for (int i = 0; i < N; i++) {
    left[i] = (raw[2 * i] >> 8) / 8388608.0;
    right[i] = (raw[2 * i + 1] >> 8) / 8388608.0;
    meanL += left[i];
    meanR += right[i];
  }
  meanL /= N;
  meanR /= N;
  float energy = 0;
  for (int i = 0; i < N; i++) {
    left[i] -= meanL;
    right[i] -= meanR;
    energy += left[i] * left[i] + right[i] * right[i];
    vReal[i] = left[i] + right[i];
    vImag[i] = 0;
  }
  float levelDb = 10 * log10f(energy / (2 * N) + 1e-12);

  fft.windowing(FFTWindow::Hamming, FFTDirection::Forward);
  fft.compute(FFTDirection::Forward);
  fft.complexToMagnitude();
  float peakHz = fft.majorPeak();

  pushHistory(peakHistory, peakHz);
  pushHistory(levelHistory, levelDb);
  if (historyCount < HISTORY) historyCount++;

  float sharpness;
  int lag = bestLag(sharpness);
  float ratio = constrain(lag * SOUND_SPEED / SAMPLE_RATE / MIC_SPACING_M, -1.0, 1.0);
  float bearingDeg = degrees(asinf(ratio));  // 0° = straight down the approach, sign = side

  bool inBand = true;
  float lowest = 1e9, highest = 0;
  for (int i = HISTORY - 8; i < HISTORY; i++) {
    inBand &= peakHistory[i] >= SIREN_MIN_HZ && peakHistory[i] <= SIREN_MAX_HZ;
    lowest = min(lowest, peakHistory[i]);
    highest = max(highest, peakHistory[i]);
  }
  bool sweeping = highest - lowest >= MIN_SWEEP_HZ;
  bool rising = average(levelHistory, HISTORY - 8, HISTORY) - average(levelHistory, 0, 8) >= MIN_RISE_DB;
  bool clearDirection = sharpness > 3.0 && fabsf(bearingDeg) <= MAX_BEARING_DEG;

  bool siren = historyCount == HISTORY && inBand && sweeping;
  if (siren && rising && clearDirection) lastConfirmed = millis();
  bool priority = lastConfirmed && millis() - lastConfirmed < RELEASE_MS;

  digitalWrite(PREEMPT_PIN, priority ? HIGH : LOW);
  digitalWrite(STATUS_LED, priority ? HIGH : LOW);

  Serial.printf("peak=%.0fHz level=%.1fdB bearing=%.0f° sharp=%.1f siren=%d rising=%d -> %s\n",
                peakHz, levelDb, bearingDeg, sharpness, siren, rising,
                priority ? "PRIORITY" : (siren ? "rejected (reflection or receding)" : "normal"));
}
