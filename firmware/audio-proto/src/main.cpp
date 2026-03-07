#include <Arduino.h>

#include "hardware/gpio.h"
#include "pico/stdlib.h"
#include <I2S.h>

#include <stdint.h>
#include <string.h>

#ifndef AUDIO_I2S_BCLK_PIN
#define AUDIO_I2S_BCLK_PIN 16
#endif

#ifndef AUDIO_DEBUG_PIN
#define AUDIO_DEBUG_PIN -1
#endif

#ifndef AUDIO_I2S_DOUT_PIN
#define AUDIO_I2S_DOUT_PIN 18
#endif

#ifndef AUDIO_SAMPLE_RATE_TARGET
#define AUDIO_SAMPLE_RATE_TARGET 44100
#endif

#ifndef AUDIO_FIXED_SCENE
#define AUDIO_FIXED_SCENE 9
#endif

#ifndef AUDIO_ENABLE_RUNTIME_LOGS
#define AUDIO_ENABLE_RUNTIME_LOGS 0
#endif

#ifndef AUDIO_SFX_DEMO_PRESET
#define AUDIO_SFX_DEMO_PRESET 0
#endif

#ifndef AUDIO_SCENE8_ENABLE_VOICE1
#define AUDIO_SCENE8_ENABLE_VOICE1 1
#endif

#ifndef AUDIO_SCENE8_ENABLE_VOICE2
#define AUDIO_SCENE8_ENABLE_VOICE2 1
#endif

#ifndef AUDIO_SCENE8_ENABLE_VOICE3
#define AUDIO_SCENE8_ENABLE_VOICE3 1
#endif

#ifndef AUDIO_SCENE8_ENABLE_VOICE4
#define AUDIO_SCENE8_ENABLE_VOICE4 1
#endif

namespace {

constexpr uint32_t kMaxVoices = 6;
constexpr uint32_t kSceneDurationMs = 2800;
constexpr uint32_t kStatsPeriodMs = 1000;
constexpr uint32_t kI2SFrameBytes = sizeof(int16_t) * 2u;
constexpr size_t kI2SBufferWords = 256;
constexpr uint32_t kWebSfxSampleRate = 44100;

enum Waveform : uint8_t {
  WAVE_OFF = 0,
  WAVE_PULSE = 1,
  WAVE_SAW = 2,
  WAVE_TRI = 3,
  WAVE_NOISE = 4,
};

enum EnvState : uint8_t {
  ENV_OFF = 0,
  ENV_ATTACK = 1,
  ENV_DECAY = 2,
  ENV_SUSTAIN = 3,
  ENV_RELEASE = 4,
};

enum FilterMode : uint8_t {
  FILTER_LP = 0,
  FILTER_BP = 1,
  FILTER_HP = 2,
};

struct Voice {
  uint8_t waveform = WAVE_OFF;
  uint32_t phase = 0;
  uint32_t phaseStep = 0;
  uint16_t pulseWidth = 32768;

  uint8_t envState = ENV_OFF;
  uint16_t envLevel = 0;
  uint16_t attack = 0;
  uint16_t decay = 0;
  uint16_t sustain = 65535;
  uint16_t release = 0;

  uint16_t lfsr = 0x7FFF;
  int16_t noiseOut = 0;
};

struct FilterState {
  uint16_t cutoff = 32768;
  uint16_t resonance = 0;
  uint8_t mode = FILTER_LP;
  uint8_t routing = 0;
  int32_t lp = 0;
  int32_t bp = 0;
};

struct ToneTimer {
  bool active = false;
  uint8_t voice = 0;
  uint32_t samplesLeft = 0;
};

struct SfxStep {
  uint16_t delaySamples;
  uint8_t waveform;
  uint16_t freqHz;
  uint8_t pulseWidth;
  uint8_t volume;
  uint8_t filterCutoff;
};

struct SfxPresetDef {
  const char* name = nullptr;
  const SfxStep* steps = nullptr;
  uint8_t stepCount = 0;
};

struct SfxEngine {
  bool active = false;
  uint8_t voice = 0;
  const SfxStep* preset = nullptr;
  uint8_t stepCount = 0;
  uint8_t stepIndex = 0;
  uint32_t sampleCounter = 0;
  uint32_t nextDelaySamples = 0;
};

struct Stats {
  volatile uint32_t sampleCount = 0;
  volatile uint32_t renderBusyUs = 0;
  volatile uint32_t renderMaxUs = 0;
  volatile uint32_t clipCount = 0;
  volatile uint32_t overrunCount = 0;
};

struct SceneContext {
  uint32_t startedAtMs = 0;
  uint32_t lastTriggerMs = 0;
  uint32_t nextTriggerMs = 0;
  uint8_t sfxDemoIndex = 0;
};

Voice gVoices[kMaxVoices];
FilterState gFilter;
ToneTimer gTone;
SfxEngine gSfx[kMaxVoices];
Stats gStats;
SceneContext gSceneCtx;

// LRCLK/WS is always BCLK+1 in this Arduino-Pico I2S implementation.
I2S gI2S(OUTPUT, AUDIO_I2S_BCLK_PIN, AUDIO_I2S_DOUT_PIN);
uint32_t gActualSampleRate = 0;
uint32_t gCurrentScene = 0;
bool gLedState = false;
bool gAutoCycle = AUDIO_FIXED_SCENE < 0;
uint8_t gMixDivisor = 3;
uint16_t gDitherLfsr = 0xACE1u;  // LFSR for triangular dither
int32_t gNoiseShapeErr = 0;      // first-order noise shaping error feedback

constexpr uint16_t sfxMsToSamples(uint32_t ms) {
  return static_cast<uint16_t>((static_cast<uint64_t>(ms) * kWebSfxSampleRate + 500u) / 1000u);
}

constexpr SfxStep kLaserPreset[] = {
    {0,                 WAVE_PULSE, 1000, 128, 255, 0},
    {sfxMsToSamples(5), WAVE_PULSE, 800,  128, 255, 0},
    {sfxMsToSamples(5), WAVE_PULSE, 600,  128, 200, 0},
    {sfxMsToSamples(5), WAVE_PULSE, 400,  128, 150, 0},
    {sfxMsToSamples(5), WAVE_PULSE, 200,  128, 80,  0},
    {sfxMsToSamples(3), WAVE_OFF,   0,      0,   0,  0},
};

constexpr SfxStep kExplodePreset[] = {
    {0,                   WAVE_NOISE, 200, 0, 255, 220},
    {sfxMsToSamples(30),  WAVE_NOISE, 150, 0, 200, 180},
    {sfxMsToSamples(60),  WAVE_NOISE, 100, 0, 140, 120},
    {sfxMsToSamples(80),  WAVE_NOISE, 80,  0, 80,   60},
    {sfxMsToSamples(100), WAVE_NOISE, 60,  0, 30,   30},
    {sfxMsToSamples(60),  WAVE_OFF,     0, 0, 0,     0},
};

constexpr SfxStep kPickupPreset[] = {
    {0,                 WAVE_TRI, 523,  0, 230, 0},
    {sfxMsToSamples(4), WAVE_TRI, 659,  0, 230, 0},
    {sfxMsToSamples(4), WAVE_TRI, 784,  0, 230, 0},
    {sfxMsToSamples(4), WAVE_TRI, 1047, 0, 255, 0},
    {sfxMsToSamples(8), WAVE_TRI, 1047, 0, 120, 0},
    {sfxMsToSamples(6), WAVE_OFF,    0, 0,   0, 0},
};

constexpr SfxStep kJumpPreset[] = {
    {0,                 WAVE_TRI, 200, 0, 220, 0},
    {sfxMsToSamples(5), WAVE_TRI, 300, 0, 230, 0},
    {sfxMsToSamples(5), WAVE_TRI, 450, 0, 240, 0},
    {sfxMsToSamples(5), WAVE_TRI, 600, 0, 200, 0},
    {sfxMsToSamples(8), WAVE_TRI, 600, 0, 80,  0},
    {sfxMsToSamples(5), WAVE_OFF,   0, 0, 0,   0},
};

constexpr SfxStep kHitPreset[] = {
    {0,                 WAVE_NOISE, 400, 0, 255, 0},
    {sfxMsToSamples(3), WAVE_NOISE, 400, 0, 120, 0},
    {sfxMsToSamples(3), WAVE_NOISE, 400, 0, 40,  0},
    {sfxMsToSamples(2), WAVE_OFF,     0, 0, 0,   0},
};

constexpr SfxStep kBouncePreset[] = {
    {0,                 WAVE_PULSE, 400, 128, 200, 0},
    {sfxMsToSamples(4), WAVE_PULSE, 250, 128, 220, 0},
    {sfxMsToSamples(4), WAVE_PULSE, 500, 128, 200, 0},
    {sfxMsToSamples(6), WAVE_PULSE, 500, 128, 80,  0},
    {sfxMsToSamples(4), WAVE_OFF,     0,   0,   0, 0},
};

constexpr SfxStep kPowerupPreset[] = {
    {0,                  WAVE_SAW, 100, 0, 200, 40},
    {sfxMsToSamples(40), WAVE_SAW, 150, 0, 210, 80},
    {sfxMsToSamples(40), WAVE_SAW, 220, 0, 220, 120},
    {sfxMsToSamples(40), WAVE_SAW, 330, 0, 235, 170},
    {sfxMsToSamples(40), WAVE_SAW, 500, 0, 255, 220},
    {sfxMsToSamples(60), WAVE_SAW, 500, 0, 80,    0},
    {sfxMsToSamples(30), WAVE_OFF,   0, 0, 0,     0},
};

constexpr SfxStep kDeathPreset[] = {
    {0,                  WAVE_NOISE, 300, 0,   255, 0},
    {sfxMsToSamples(30), WAVE_PULSE, 400, 100, 220, 0},
    {sfxMsToSamples(40), WAVE_PULSE, 300, 100, 180, 0},
    {sfxMsToSamples(50), WAVE_PULSE, 200, 100, 130, 0},
    {sfxMsToSamples(60), WAVE_PULSE, 100, 100, 60,  0},
    {sfxMsToSamples(80), WAVE_OFF,     0,   0,   0, 0},
};

constexpr SfxStep kCoinPreset[] = {
    {0,                  WAVE_PULSE, 1319, 128, 230, 0},
    {sfxMsToSamples(6),  WAVE_PULSE, 1976, 128, 255, 0},
    {sfxMsToSamples(10), WAVE_PULSE, 1976, 128, 100, 0},
    {sfxMsToSamples(6),  WAVE_OFF,      0,   0,   0, 0},
};

constexpr SfxStep kBeepPreset[] = {
    {0,                  WAVE_PULSE, 880, 128, 220, 0},
    {sfxMsToSamples(10), WAVE_PULSE, 880, 128, 100, 0},
    {sfxMsToSamples(5),  WAVE_OFF,     0,   0,   0, 0},
};

constexpr SfxStep kThudPreset[] = {
    {0,                  WAVE_NOISE, 3000, 0, 255, 60},
    {sfxMsToSamples(15), WAVE_NOISE, 2000, 0, 160, 40},
    {sfxMsToSamples(15), WAVE_NOISE, 1500, 0, 60,  25},
    {sfxMsToSamples(10), WAVE_OFF,      0, 0, 0,    0},
};

constexpr SfxStep kZapPreset[] = {
    {0,                 WAVE_SAW, 600, 0, 255, 240},
    {sfxMsToSamples(4), WAVE_SAW, 600, 0, 200, 160},
    {sfxMsToSamples(4), WAVE_SAW, 600, 0, 140, 80},
    {sfxMsToSamples(4), WAVE_SAW, 600, 0, 60,  30},
    {sfxMsToSamples(3), WAVE_OFF,   0, 0, 0,    0},
};

constexpr SfxStep kAlarmPreset[] = {
    {0,                 WAVE_PULSE, 800, 128, 220, 0},
    {sfxMsToSamples(8), WAVE_PULSE, 600, 128, 220, 0},
    {sfxMsToSamples(8), WAVE_PULSE, 800, 128, 220, 0},
    {sfxMsToSamples(8), WAVE_PULSE, 600, 128, 200, 0},
    {sfxMsToSamples(8), WAVE_PULSE, 800, 128, 150, 0},
    {sfxMsToSamples(8), WAVE_OFF,     0,   0,   0, 0},
};

constexpr SfxStep kClickPreset[] = {
    {0,                 WAVE_NOISE, 8000, 0, 255, 0},
    {sfxMsToSamples(4), WAVE_OFF,      0, 0,   0, 0},
};

constexpr SfxStep kWhooshPreset[] = {
    {0,                  WAVE_NOISE, 200, 0, 180, 20},
    {sfxMsToSamples(20), WAVE_NOISE, 200, 0, 200, 60},
    {sfxMsToSamples(20), WAVE_NOISE, 200, 0, 220, 120},
    {sfxMsToSamples(20), WAVE_NOISE, 200, 0, 240, 200},
    {sfxMsToSamples(20), WAVE_NOISE, 200, 0, 150, 240},
    {sfxMsToSamples(20), WAVE_OFF,     0, 0,   0,   0},
};

constexpr SfxStep kBlipPreset[] = {
    {0,                 WAVE_TRI, 800, 0, 220, 0},
    {sfxMsToSamples(5), WAVE_TRI, 600, 0, 200, 0},
    {sfxMsToSamples(5), WAVE_TRI, 400, 0, 140, 0},
    {sfxMsToSamples(4), WAVE_OFF,   0, 0,   0, 0},
};

constexpr SfxPresetDef kSfxPresets[] = {
    {"laser",   kLaserPreset,   static_cast<uint8_t>(sizeof(kLaserPreset) / sizeof(kLaserPreset[0]))},
    {"explode", kExplodePreset, static_cast<uint8_t>(sizeof(kExplodePreset) / sizeof(kExplodePreset[0]))},
    {"pickup",  kPickupPreset,  static_cast<uint8_t>(sizeof(kPickupPreset) / sizeof(kPickupPreset[0]))},
    {"jump",    kJumpPreset,    static_cast<uint8_t>(sizeof(kJumpPreset) / sizeof(kJumpPreset[0]))},
    {"hit",     kHitPreset,     static_cast<uint8_t>(sizeof(kHitPreset) / sizeof(kHitPreset[0]))},
    {"bounce",  kBouncePreset,  static_cast<uint8_t>(sizeof(kBouncePreset) / sizeof(kBouncePreset[0]))},
    {"powerup", kPowerupPreset, static_cast<uint8_t>(sizeof(kPowerupPreset) / sizeof(kPowerupPreset[0]))},
    {"death",   kDeathPreset,   static_cast<uint8_t>(sizeof(kDeathPreset) / sizeof(kDeathPreset[0]))},
    {"coin",    kCoinPreset,    static_cast<uint8_t>(sizeof(kCoinPreset) / sizeof(kCoinPreset[0]))},
    {"beep",    kBeepPreset,    static_cast<uint8_t>(sizeof(kBeepPreset) / sizeof(kBeepPreset[0]))},
    {"thud",    kThudPreset,    static_cast<uint8_t>(sizeof(kThudPreset) / sizeof(kThudPreset[0]))},
    {"zap",     kZapPreset,     static_cast<uint8_t>(sizeof(kZapPreset) / sizeof(kZapPreset[0]))},
    {"alarm",   kAlarmPreset,   static_cast<uint8_t>(sizeof(kAlarmPreset) / sizeof(kAlarmPreset[0]))},
    {"click",   kClickPreset,   static_cast<uint8_t>(sizeof(kClickPreset) / sizeof(kClickPreset[0]))},
    {"whoosh",  kWhooshPreset,  static_cast<uint8_t>(sizeof(kWhooshPreset) / sizeof(kWhooshPreset[0]))},
    {"blip",    kBlipPreset,    static_cast<uint8_t>(sizeof(kBlipPreset) / sizeof(kBlipPreset[0]))},
};

constexpr uint8_t kSfxPresetCount = static_cast<uint8_t>(sizeof(kSfxPresets) / sizeof(kSfxPresets[0]));
constexpr uint32_t kSfxShowcaseGapMs = 2000;

constexpr const char* kSceneNames[] = {
    "pulse-bass",
    "saw-chord",
    "filtered-pad",
    "arp-sequence",
    "sfx-laser",
    "sfx-explode",
    "noise-sweep",
    "chiptune",
    "jazz",
    "sfx-showcase",
};

// 256-entry full-cycle sine: sin(2π·i/256) × 32000.  Near full scale.
static const int16_t kSineTable[256] = {
       0,   785,  1570,  2354,  3137,  3917,  4695,  5471,
    6243,  7011,  7775,  8535,  9289, 10038, 10780, 11517,
   12246, 12968, 13682, 14388, 15085, 15773, 16451, 17120,
   17778, 18426, 19062, 19687, 20301, 20902, 21490, 22065,
   22627, 23176, 23710, 24231, 24736, 25227, 25703, 26163,
   26607, 27035, 27447, 27843, 28221, 28583, 28928, 29255,
   29564, 29856, 30129, 30385, 30622, 30841, 31041, 31222,
   31385, 31529, 31654, 31759, 31846, 31913, 31961, 31990,
   32000, 31990, 31961, 31913, 31846, 31759, 31654, 31529,
   31385, 31222, 31041, 30841, 30622, 30385, 30129, 29856,
   29564, 29255, 28928, 28583, 28221, 27843, 27447, 27035,
   26607, 26163, 25703, 25227, 24736, 24231, 23710, 23176,
   22627, 22065, 21490, 20902, 20301, 19687, 19062, 18426,
   17778, 17120, 16451, 15773, 15085, 14388, 13682, 12968,
   12246, 11517, 10780, 10038,  9289,  8535,  7775,  7011,
    6243,  5471,  4695,  3917,  3137,  2354,  1570,   785,
       0,  -785, -1570, -2354, -3137, -3917, -4695, -5471,
   -6243, -7011, -7775, -8535, -9289,-10038,-10780,-11517,
  -12246,-12968,-13682,-14388,-15085,-15773,-16451,-17120,
  -17778,-18426,-19062,-19687,-20301,-20902,-21490,-22065,
  -22627,-23176,-23710,-24231,-24736,-25227,-25703,-26163,
  -26607,-27035,-27447,-27843,-28221,-28583,-28928,-29255,
  -29564,-29856,-30129,-30385,-30622,-30841,-31041,-31222,
  -31385,-31529,-31654,-31759,-31846,-31913,-31961,-31990,
  -32000,-31990,-31961,-31913,-31846,-31759,-31654,-31529,
  -31385,-31222,-31041,-30841,-30622,-30385,-30129,-29856,
  -29564,-29255,-28928,-28583,-28221,-27843,-27447,-27035,
  -26607,-26163,-25703,-25227,-24736,-24231,-23710,-23176,
  -22627,-22065,-21490,-20902,-20301,-19687,-19062,-18426,
  -17778,-17120,-16451,-15773,-15085,-14388,-13682,-12968,
  -12246,-11517,-10780,-10038, -9289, -8535, -7775, -7011,
   -6243, -5471, -4695, -3917, -3137, -2354, -1570,  -785,
};

// Pure sine tone generator — bypasses the entire synth engine.
struct PureTone {
  bool active = false;
  uint32_t phase = 0;
  uint32_t phaseStep = 0;
};
PureTone gPureTone;

int16_t renderPureTone() {
  if (!gPureTone.active) return 0;
  gPureTone.phase += gPureTone.phaseStep;
  return kSineTable[gPureTone.phase >> 24];  // top 8 bits = table index
};

inline uint16_t clampU16(int32_t value, uint16_t lo, uint16_t hi) {
  if (value < static_cast<int32_t>(lo)) return lo;
  if (value > static_cast<int32_t>(hi)) return hi;
  return static_cast<uint16_t>(value);
}

uint32_t msToSamples(uint32_t ms) {
  return (static_cast<uint64_t>(ms) * gActualSampleRate + 999u) / 1000u;
}

uint32_t scaleSfxDelaySamples(uint16_t webDelaySamples) {
  if (webDelaySamples == 0) return 0;
  const uint32_t scaled = static_cast<uint32_t>(
      (static_cast<uint64_t>(webDelaySamples) * gActualSampleRate + (kWebSfxSampleRate / 2u)) /
      kWebSfxSampleRate);
  return scaled == 0 ? 1u : scaled;
}

uint16_t paramToRate(uint8_t param) {
  if (param == 0) return 65535;
  const uint32_t samples = (static_cast<uint64_t>(param) * gActualSampleRate * 2u + 127u) / 255u;
  if (samples <= 1u) return 65535;
  return static_cast<uint16_t>(65535u / samples);
}

uint16_t cutoffToCoeff(uint8_t cutoff) {
  return static_cast<uint16_t>(512u + ((static_cast<uint32_t>(cutoff) * 28672u) / 255u));
}

uint32_t hzToPhaseStep(uint32_t hz) {
  return static_cast<uint32_t>((static_cast<uint64_t>(hz) << 32) / gActualSampleRate);
}

uint8_t gMasterVolume = 200;

constexpr uint8_t kScene8EnabledVoiceCount =
    AUDIO_SCENE8_ENABLE_VOICE1 +
    AUDIO_SCENE8_ENABLE_VOICE2 +
    AUDIO_SCENE8_ENABLE_VOICE3 +
    AUDIO_SCENE8_ENABLE_VOICE4;

constexpr uint8_t kScene8MixDivisor =
    (kScene8EnabledVoiceCount == 0) ? 1 : kScene8EnabledVoiceCount;

void setMasterVolume(uint8_t volume) {
  gMasterVolume = volume;
}

void resetFilter() {
  gFilter.cutoff = cutoffToCoeff(255);
  gFilter.resonance = 0;
  gFilter.mode = FILTER_LP;
  gFilter.routing = 0;
  gFilter.lp = 0;
  gFilter.bp = 0;
}

void setFilter(uint8_t cutoff, uint8_t resonance, uint8_t mode, uint8_t routing) {
  gFilter.cutoff = cutoffToCoeff(cutoff);
  gFilter.resonance = static_cast<uint16_t>((static_cast<uint32_t>(resonance) * 30000u) / 255u);
  gFilter.mode = mode;
  gFilter.routing = routing;
}

void setEnvelope(uint8_t voice, uint8_t attack, uint8_t decay, uint8_t sustain, uint8_t release) {
  if (voice >= kMaxVoices) return;
  Voice& v = gVoices[voice];
  v.attack = paramToRate(attack);
  v.decay = paramToRate(decay);
  v.sustain = static_cast<uint16_t>(sustain * 257u);
  v.release = paramToRate(release);
}

void noteOff(uint8_t voice) {
  if (voice >= kMaxVoices) return;
  Voice& v = gVoices[voice];
  if (v.envState != ENV_OFF) v.envState = ENV_RELEASE;
}

void setVoice(uint8_t voice, uint8_t waveform, uint16_t freqHz, uint8_t pulseWidth) {
  if (voice >= kMaxVoices) return;
  Voice& v = gVoices[voice];
  const bool wasOff = v.waveform == WAVE_OFF;
  v.waveform = waveform;
  v.phaseStep = hzToPhaseStep(freqHz);
  v.pulseWidth = static_cast<uint16_t>(pulseWidth * 257u);
  if (waveform == WAVE_OFF) {
    if (v.envState != ENV_OFF) v.envState = ENV_RELEASE;
    return;
  }

  if (wasOff || v.envState == ENV_OFF || v.envState == ENV_RELEASE) {
    v.phase = 0;
    v.envState = ENV_ATTACK;
    v.envLevel = 0;
    if (waveform == WAVE_NOISE) {
      v.lfsr = 0x7FFF;
      v.noiseOut = 0;
    }
  }
}

void playTone(uint8_t voice, uint16_t freqHz, uint16_t durationMs) {
  if (voice >= kMaxVoices) return;
  setEnvelope(voice, 0, 50, 150, 40);
  setVoice(voice, WAVE_PULSE, freqHz, 128);
  gTone.active = true;
  gTone.voice = voice;
  gTone.samplesLeft = msToSamples(durationMs);
}

void applySfxStep(SfxEngine& eng, const SfxStep& step) {
  Voice& v = gVoices[eng.voice];
  const bool wasOff = v.waveform == WAVE_OFF;
  v.waveform = step.waveform;
  if (step.waveform == WAVE_OFF) {
    v.envState = ENV_OFF;
    v.envLevel = 0;
  } else {
    v.phaseStep = hzToPhaseStep(step.freqHz);
    v.pulseWidth = static_cast<uint16_t>(step.pulseWidth * 257u);
    v.envLevel = static_cast<uint16_t>(step.volume * 257u);
    v.sustain = v.envLevel;
    v.envState = ENV_SUSTAIN;
    if (wasOff) {
      v.phase = 0;
      if (step.waveform == WAVE_NOISE) {
        v.lfsr = 0x7FFF;
        v.noiseOut = 0;
      }
    }
  }
  if (step.filterCutoff > 0) {
    gFilter.cutoff = cutoffToCoeff(step.filterCutoff);
  }
}

uint32_t sfxPresetDurationMs(const SfxPresetDef& preset) {
  uint32_t totalSamples = 0;
  for (uint8_t i = 1; i < preset.stepCount; i++) {
    totalSamples += scaleSfxDelaySamples(preset.steps[i].delaySamples);
  }
  return static_cast<uint32_t>((static_cast<uint64_t>(totalSamples) * 1000u + gActualSampleRate - 1u) / gActualSampleRate);
}

uint32_t sfxShowcaseDurationMs() {
  uint32_t totalMs = 0;
  for (uint8_t i = 0; i < kSfxPresetCount; i++) {
    totalMs += sfxPresetDurationMs(kSfxPresets[i]) + kSfxShowcaseGapMs;
  }
  return totalMs;
}

void triggerSfx(const SfxStep* preset, uint8_t stepCount, uint8_t voice) {
  if (voice >= kMaxVoices || preset == nullptr || stepCount == 0) return;
  SfxEngine& eng = gSfx[voice];
  eng.active = true;
  eng.voice = voice;
  eng.preset = preset;
  eng.stepCount = stepCount;
  eng.stepIndex = 0;
  eng.sampleCounter = 0;
  eng.nextDelaySamples = (stepCount > 1) ? scaleSfxDelaySamples(preset[1].delaySamples) : 0;
  applySfxStep(eng, preset[0]);
}

void triggerSfxPreset(uint8_t effectId, uint8_t voice) {
  if (effectId >= kSfxPresetCount) return;
  const SfxPresetDef& preset = kSfxPresets[effectId];
  triggerSfx(preset.steps, preset.stepCount, voice);
}

void startSfxShowcasePreset(uint8_t effectId) {
  if (effectId >= kSfxPresetCount) effectId = 0;
  resetFilter();
  triggerSfxPreset(effectId, 0);
  gSceneCtx.sfxDemoIndex = effectId;
  gSceneCtx.nextTriggerMs = 0;
#if AUDIO_ENABLE_RUNTIME_LOGS
  const SfxPresetDef& preset = kSfxPresets[effectId];
  Serial.printf("sfx demo %u/%u: %s\n",
                static_cast<unsigned>(effectId + 1),
                static_cast<unsigned>(kSfxPresetCount),
                preset.name);
#endif
}

inline int16_t oscillate(const Voice& v) {
  switch (v.waveform) {
    case WAVE_PULSE: {
      const uint16_t phase = static_cast<uint16_t>(v.phase >> 16);
      return phase < v.pulseWidth ? 32767 : -32768;
    }
    case WAVE_SAW:
      return static_cast<int16_t>((v.phase >> 16) - 32768u);
    case WAVE_TRI: {
      const uint16_t p = static_cast<uint16_t>(v.phase >> 16);
      const int32_t tri = p < 32768u ? (static_cast<int32_t>(p) << 1) - 32768
                                     : 98303 - (static_cast<int32_t>(p) << 1);
      return static_cast<int16_t>(tri);
    }
    case WAVE_NOISE:
      return v.noiseOut;
    default:
      return 0;
  }
}

inline void advancePhase(Voice& v) {
  const uint32_t prev = v.phase;
  v.phase += v.phaseStep;
  if (v.phase < prev && v.waveform == WAVE_NOISE) {
    const uint16_t bit = v.lfsr & 1u;
    v.lfsr >>= 1u;
    if (bit) v.lfsr ^= 0xB400u;
    v.noiseOut = static_cast<int16_t>((static_cast<int32_t>(v.lfsr) - 16384) << 1);
  }
}

inline uint16_t advanceEnvelope(Voice& v) {
  switch (v.envState) {
    case ENV_ATTACK:
      if (v.attack == 65535) {
        v.envLevel = 65535;
        v.envState = ENV_DECAY;
      } else {
        const uint32_t next = v.envLevel + v.attack;
        if (next >= 65535u) {
          v.envLevel = 65535;
          v.envState = ENV_DECAY;
        } else {
          v.envLevel = static_cast<uint16_t>(next);
        }
      }
      break;
    case ENV_DECAY:
      if (v.decay == 65535 || v.envLevel <= v.sustain) {
        v.envLevel = v.sustain;
        v.envState = ENV_SUSTAIN;
      } else {
        v.envLevel = static_cast<uint16_t>(v.envLevel - (v.decay > v.envLevel ? v.envLevel : v.decay));
        if (v.envLevel <= v.sustain) {
          v.envLevel = v.sustain;
          v.envState = ENV_SUSTAIN;
        }
      }
      break;
    case ENV_SUSTAIN:
      break;
    case ENV_RELEASE:
      if (v.release == 65535 || v.envLevel <= v.release) {
        v.envLevel = 0;
        v.envState = ENV_OFF;
        v.waveform = WAVE_OFF;
      } else {
        v.envLevel = static_cast<uint16_t>(v.envLevel - v.release);
      }
      break;
    default:
      break;
  }
  return v.envLevel;
}

void updateToneAndSfx() {
  if (gTone.active) {
    if (gTone.samplesLeft > 0) {
      gTone.samplesLeft--;
    }
    if (gTone.samplesLeft == 0) {
      gTone.active = false;
      noteOff(gTone.voice);
    }
  }

  for (uint32_t i = 0; i < kMaxVoices; i++) {
    SfxEngine& eng = gSfx[i];
    if (!eng.active || eng.preset == nullptr) continue;
    const uint8_t nextIndex = eng.stepIndex + 1;
    if (nextIndex >= eng.stepCount) {
      eng.active = false;
      eng.nextDelaySamples = 0;
      continue;
    }
    eng.sampleCounter++;
    if (eng.sampleCounter >= eng.nextDelaySamples) {
      eng.sampleCounter = 0;
      eng.stepIndex = nextIndex;
      applySfxStep(eng, eng.preset[nextIndex]);
      if (eng.preset[nextIndex].waveform == WAVE_OFF) {
        eng.active = false;
        eng.nextDelaySamples = 0;
      } else {
        const uint8_t futureIndex = nextIndex + 1;
        eng.nextDelaySamples =
            (futureIndex < eng.stepCount) ? scaleSfxDelaySamples(eng.preset[futureIndex].delaySamples) : 0;
      }
    }
  }
}

int16_t renderSample() {
  updateToneAndSfx();

  int32_t filtered = 0;
  int32_t dry = 0;
  for (uint32_t i = 0; i < kMaxVoices; i++) {
    Voice& v = gVoices[i];
    if (v.waveform == WAVE_OFF && v.envState == ENV_OFF) continue;
    const int16_t osc = oscillate(v);
    const uint16_t env = advanceEnvelope(v);
    advancePhase(v);
    const int32_t sample = (static_cast<int32_t>(osc) * env) >> 16;
    if (gFilter.routing & (1u << i)) {
      filtered += sample;
    } else {
      dry += sample;
    }
  }

  int32_t mixed = dry;
  if (gFilter.routing != 0) {
    if (filtered == 0) {
      // No voice is feeding the filter — kill residual ringing
      gFilter.lp = 0;
      gFilter.bp = 0;
    } else {
      const int32_t damping = 32767 - gFilter.resonance;
      gFilter.lp += (static_cast<int64_t>(gFilter.cutoff) * gFilter.bp) >> 15;
      const int32_t hp = filtered - gFilter.lp - ((static_cast<int64_t>(damping) * gFilter.bp) >> 15);
      gFilter.bp += (static_cast<int64_t>(gFilter.cutoff) * hp) >> 15;

      int32_t filterOut = gFilter.lp;
      if (gFilter.mode == FILTER_BP) filterOut = gFilter.bp;
      if (gFilter.mode == FILTER_HP) filterOut = hp;
      mixed += filterOut;
    }
  }

  mixed = (mixed * gMasterVolume) >> 8;
  mixed /= gMixDivisor;  // headroom depends on how dense the active scene is

  if (mixed > 32767) {
    mixed = 32767;
    gStats.clipCount++;
  } else if (mixed < -32768) {
    mixed = -32768;
    gStats.clipCount++;
  }
  return static_cast<int16_t>(mixed);
}

void pumpAudioI2S() {
  const int writable = gI2S.availableForWrite();
  const int frames = writable / static_cast<int>(kI2SFrameBytes);
  for (int i = 0; i < frames; i++) {
#if AUDIO_DEBUG_PIN >= 0
    gpio_put(AUDIO_DEBUG_PIN, 1);
#endif
    const uint32_t startedUs = time_us_32();
    const int16_t sample = renderSample();
    gI2S.write16(sample, sample);
    const uint32_t elapsedUs = time_us_32() - startedUs;

    gStats.sampleCount++;
    gStats.renderBusyUs += elapsedUs;
    if (elapsedUs > gStats.renderMaxUs) gStats.renderMaxUs = elapsedUs;
    if ((static_cast<uint64_t>(elapsedUs) * gActualSampleRate) > 1000000ull) gStats.overrunCount++;

#if AUDIO_DEBUG_PIN >= 0
    gpio_put(AUDIO_DEBUG_PIN, 0);
#endif
  }
}

void stopAllVoices() {
  for (Voice& voice : gVoices) voice = Voice{};
  for (SfxEngine& eng : gSfx) eng = SfxEngine{};
  gTone = {};
  gPureTone = PureTone{};
  resetFilter();
  setMasterVolume(200);
  gMixDivisor = 3;
}

void triggerNote(uint8_t voice, uint8_t waveform, uint16_t freqHz, uint8_t pw) {
  Voice& v = gVoices[voice];
  const bool wasIdle = (v.waveform == WAVE_OFF || v.envState == ENV_OFF);
  v.phaseStep = hzToPhaseStep(freqHz);
  v.pulseWidth = static_cast<uint16_t>(pw * 257u);
  if (wasIdle || waveform == WAVE_NOISE) {
    // Starting from silence or drum hit — full reset
    v.phase = 0;
    v.envLevel = 0;
  }
  // Otherwise keep phase & envLevel continuous (no click)
  v.waveform = waveform;
  v.envState = ENV_ATTACK;
  if (waveform == WAVE_NOISE) {
    v.lfsr = 0x7FFF;
    v.noiseOut = 0;
  }
}

void retriggerChord(uint16_t rootHz) {
  static const uint16_t intervals[] = {1, 5, 6, 8, 10, 12};
  for (uint8_t i = 0; i < kMaxVoices; i++) {
    const uint16_t freq = static_cast<uint16_t>(rootHz + intervals[i] * 35u);
    setEnvelope(i, 0, 25, 160, 70);
    setVoice(i, (i & 1u) ? WAVE_SAW : WAVE_PULSE, freq, 96 + i * 16u);
  }
  setFilter(180, 80, FILTER_LP, 0b00111111);
}

uint32_t normalizeSceneIndex(uint32_t scene) {
  return scene % (sizeof(kSceneNames) / sizeof(kSceneNames[0]));
}

const char* sceneName(uint32_t scene) {
  return kSceneNames[normalizeSceneIndex(scene)];
}

void startPureTone(uint32_t freqHz) {
  gPureTone.active = true;
  gPureTone.phase = 0;
  gPureTone.phaseStep = static_cast<uint32_t>((static_cast<uint64_t>(freqHz) << 32) / gActualSampleRate);
}

void applyScene(uint32_t scene) {
  const uint32_t normalized = normalizeSceneIndex(scene);
  stopAllVoices();
  gSceneCtx.startedAtMs = millis();
  gSceneCtx.lastTriggerMs = 0;
  gSceneCtx.nextTriggerMs = 0;
  gSceneCtx.sfxDemoIndex = 0;

#if AUDIO_ENABLE_RUNTIME_LOGS
  Serial.printf("scene %lu: %s\n",
                static_cast<unsigned long>(normalized),
                sceneName(scene));
#endif

  switch (normalized) {
    case 0: // pulse-bass — single thick pulse bass note
      setEnvelope(0, 2, 40, 180, 60);
      setVoice(0, WAVE_PULSE, 55, 96);
      break;
    case 1: // saw-chord — 6-voice detuned saw chord
      retriggerChord(220);
      break;
    case 2: // filtered-pad — saw chord through resonant LP filter
      retriggerChord(330);
      setFilter(100, 180, FILTER_LP, 0b00111111);
      break;
    case 3: // arp-sequence — retriggered by updateScene
      setEnvelope(0, 0, 20, 0, 10);
      setVoice(0, WAVE_PULSE, 440, 128);
      break;
    case 4: // sfx-laser
      gMixDivisor = 1;
      triggerSfxPreset(0, 0);
      break;
    case 5: // sfx-explode
      gMixDivisor = 1;
      triggerSfxPreset(1, 0);
      break;
    case 6: // noise-sweep — noise through sweeping filter
      setEnvelope(0, 5, 0, 255, 0);
      setVoice(0, WAVE_NOISE, 440, 0);
      setFilter(40, 200, FILTER_BP, 0b00000001);
      break;
    case 7: // chiptune — 6-voice music demo
      setMasterVolume(100);
      // Voice 0: Bass (triangle, plucky)
      setEnvelope(0, 0, 200, 120, 80);
      // Voice 1: Melody (pulse)
      setEnvelope(1, 10, 120, 150, 60);
      // Voice 2: Arpeggio (pulse narrow, continuous)
      setEnvelope(2, 0, 0, 100, 40);
      setVoice(2, WAVE_PULSE, 262, 64);
      // Voices 3-4: Pad (saw, filtered)
      setEnvelope(3, 120, 0, 130, 80);
      setEnvelope(4, 120, 0, 130, 80);
      setVoice(3, WAVE_SAW, 131, 0);
      setVoice(4, WAVE_SAW, 196, 0);
      // Voice 5: Drums (noise)
      setEnvelope(5, 0, 80, 0, 40);
      // Filter on pad voices
      setFilter(130, 60, FILTER_LP, 0b00011000);
      break;
    case 8: // jazz — sax + walking bass + swing ride + kick
      setMasterVolume(192);
      gMixDivisor = kScene8MixDivisor;
#if AUDIO_SCENE8_ENABLE_VOICE1
      // Voice 1: Walking bass (saw, warm pluck)
      setEnvelope(0, 3, 150, 150, 24);
#endif
#if AUDIO_SCENE8_ENABLE_VOICE2
      // Voice 2: Sax lead (pulse ~63% duty, filtered)
      setEnvelope(1, 15, 100, 160, 50);
#endif
#if AUDIO_SCENE8_ENABLE_VOICE3
      // Voice 3: Ride cymbal (noise, short)
      setEnvelope(2, 0, 25, 0, 12);
#endif
#if AUDIO_SCENE8_ENABLE_VOICE4
      // Voice 4: Kick drum (low pulse, short decay)
      setEnvelope(3, 0, 80, 0, 14);
#endif
      // No filter
      resetFilter();
      break;
    case 9: // sfx-showcase — cycle through the full web SFX preset catalog
      setMasterVolume(104);
      gMixDivisor = 1;
      startSfxShowcasePreset(AUDIO_SFX_DEMO_PRESET);
      break;
  }
}

void updateScene() {
  const uint32_t now = millis();
  const uint32_t elapsed = now - gSceneCtx.startedAtMs;
  const uint32_t normalized = normalizeSceneIndex(gCurrentScene);

  // Scene-specific updates
  if (normalized == 3) {
    // arp-sequence — cycle through notes every 150ms
    static const uint16_t arpNotes[] = {440, 554, 659, 880, 659, 554};
    const uint32_t stepMs = 150;
    const uint32_t stepIdx = (elapsed / stepMs) % 6;
    if (now - gSceneCtx.lastTriggerMs >= stepMs) {
      gSceneCtx.lastTriggerMs = now;
      setVoice(0, WAVE_PULSE, arpNotes[stepIdx], 128);
    }
  } else if (normalized == 6) {
    // noise-sweep — sweep filter cutoff up and down
    const uint32_t cycleMs = 1400;
    const uint32_t pos = elapsed % cycleMs;
    const uint8_t cutoff = pos < cycleMs / 2
        ? static_cast<uint8_t>(40 + (pos * 200) / (cycleMs / 2))
        : static_cast<uint8_t>(240 - ((pos - cycleMs / 2) * 200) / (cycleMs / 2));
    setFilter(cutoff, 200, FILTER_BP, 0b00000001);
  } else if (normalized == 7) {
    // chiptune — 6-voice step sequencer, 64-step loop (A loud + B quiet)
    const uint32_t stepMs = 125; // ~120 BPM sixteenth notes
    if (now - gSceneCtx.lastTriggerMs < stepMs) return;
    gSceneCtx.lastTriggerMs = now;
    const uint32_t s = (elapsed / stepMs) % 64;
    const bool quiet = (s >= 32); // B section is quieter

    // Voice 0: Bass (triangle, quarter notes)
    static const uint16_t bass[16] = {
      // A: Cm  Cm   Ab   Bb   Cm   Cm   Fm   G
         65,  49,  52,  58,  65,  78,  87,  49,
      // B: Cm  Ab   Bb   G    Cm   Eb   F    G
         65,  52,  58,  49,  65,  78,  87,  98,
    };
    if (s % 4 == 0) triggerNote(0, WAVE_TRI, bass[s / 4], 0);
    else if (s % 4 == 2) noteOff(0);

    // Voice 1: Melody (pulse)
    static const uint16_t melody[64] = {
      // A section — energetic
      392,  0,311,  0,  262,311,392,  0,  415,  0,392,  0,  349,  0,311,  0,
      294,  0,311,  0,  349,  0,392,415,  392,  0,349,  0,  311,  0,294,  0,
      // B section — sparser, breathing room
      262,  0,  0,  0,  311,  0,262,  0,  196,  0,  0,  0,  233,  0,  0,  0,
      262,  0,294,  0,  311,  0,  0,  0,  262,  0,  0,  0,  196,  0,  0,  0,
    };
    if (melody[s]) triggerNote(1, WAVE_PULSE, melody[s], 128);
    else noteOff(1);

    // Voice 2: Arpeggio — runs in A, half-speed in B
    static const uint16_t arp[32] = {
      262,311,392,523, 262,311,392,523, 208,262,311,415, 208,262,311,415,
      233,294,349,466, 233,294,349,466, 196,247,294,392, 196,247,294,392,
    };
    if (quiet) {
      if (s % 2 == 0) gVoices[2].phaseStep = hzToPhaseStep(arp[(s - 32) / 2]);
    } else {
      gVoices[2].phaseStep = hzToPhaseStep(arp[s]);
    }

    // Voices 3-4: Pad chord (saw, filtered) — change every 8 steps
    static const uint16_t padRoot[8]  = {131,104,117, 98, 131,104,117, 98};
    static const uint16_t padFifth[8] = {196,156,175,147, 196,156,175,147};
    if (s % 8 == 0) {
      const uint32_t ci = s / 8;
      setVoice(3, WAVE_SAW, padRoot[ci], 0);
      setVoice(4, WAVE_SAW, padFifth[ci], 0);
    }

    // Voice 5: Drums — full kit in A, just kicks in B
    if (quiet) {
      if (s % 8 == 0) {
        setEnvelope(5, 0, 150, 0, 80);
        triggerNote(5, WAVE_NOISE, 60, 0);
      }
    } else {
      if (s % 8 == 0) {
        setEnvelope(5, 0, 150, 0, 80);
        triggerNote(5, WAVE_NOISE, 60, 0);   // kick
      } else if (s % 8 == 4) {
        setEnvelope(5, 0, 100, 0, 60);
        triggerNote(5, WAVE_NOISE, 300, 0);  // snare
      } else if (s % 2 == 0) {
        setEnvelope(5, 0, 40, 0, 20);
        triggerNote(5, WAVE_NOISE, 1000, 0); // hi-hat
      }
    }

    // Slow filter sweep on pad voices
    const uint32_t fCycle = 3200;
    const uint32_t fPos = elapsed % fCycle;
    const uint8_t fCut = fPos < fCycle / 2
        ? static_cast<uint8_t>(80 + (fPos * 140) / (fCycle / 2))
        : static_cast<uint8_t>(220 - ((fPos - fCycle / 2) * 140) / (fCycle / 2));
    setFilter(fCut, 60, FILTER_LP, 0b00011000);
  } else if (normalized == 8) {
    // jazz — triplet grid, 4-bar loop, swing feel
    const uint32_t stepMs = 150; // triplet subdivisions, ~133 BPM
    if (now - gSceneCtx.lastTriggerMs < stepMs) return;
    gSceneCtx.lastTriggerMs = now;
    const uint32_t s = (elapsed / stepMs) % 48; // 4 bars × 12 steps
    const uint32_t barStep = s % 12;

    // Voice 0: Walking bass (quarter notes = every 3 steps, octave up)
    static const uint16_t bass[16] = {
      131, 156, 196, 117,
      175, 208, 262, 156,
      131,  98, 165, 196,
       98, 124, 147, 175,
    };
#if AUDIO_SCENE8_ENABLE_VOICE1
    if (barStep % 3 == 0) {
      const uint32_t bassIdx = (s / 12) * 4 + barStep / 3;
      triggerNote(0, WAVE_SAW, bass[bassIdx], 0);
    }
#endif

    // Voice 1: Sax melody (bluesy C minor)
    static const uint16_t sax[48] = {
      392,  0,466,  523,  0,  0,  466,  0,392,  0,  0,  0,
      415,  0,523,  622,  0,  0,  523,  0,415,  0,  0,  0,
      392,  0,311,  392,  0,466,  523,  0,466,392,  0,  0,
      349,  0,294,    0,  0,  0,  247,  0,294,  0,  0,  0,
    };
#if AUDIO_SCENE8_ENABLE_VOICE2
    if (sax[s]) triggerNote(1, WAVE_PULSE, sax[s], 160);
    else noteOff(1);
#endif

    // Voice 2: Ride cymbal (swing pattern: quarter + triplet "ga")
#if AUDIO_SCENE8_ENABLE_VOICE3
    if (barStep == 0 || barStep == 3 || barStep == 6 || barStep == 9) {
      setEnvelope(2, 0, 15, 0, 8);
      triggerNote(2, WAVE_NOISE, 3000, 0);
    } else if (barStep == 2 || barStep == 5 || barStep == 8 || barStep == 11) {
      setEnvelope(2, 0, 8, 0, 5);
      triggerNote(2, WAVE_NOISE, 4000, 0);
    }
#endif

    // Voice 4: Kick drum — low thump with a short pitch drop
#if AUDIO_SCENE8_ENABLE_VOICE4
    if (barStep == 0 || barStep == 3 || barStep == 6 || barStep == 9) {
      const bool accented = (barStep == 0 || barStep == 6);
      setEnvelope(3, 0, accented ? 95 : 75, 0, accented ? 18 : 12);
      triggerNote(3, WAVE_PULSE, accented ? 125 : 105, 96);
    } else if (barStep == 1 || barStep == 4 || barStep == 7 || barStep == 10) {
      gVoices[3].phaseStep = hzToPhaseStep(62);
    } else if (barStep == 2 || barStep == 5 || barStep == 8 || barStep == 11) {
      noteOff(3);
    }
#endif
  } else if (normalized == 9) {
    if (gSfx[0].active) {
      gSceneCtx.nextTriggerMs = 0;
    } else if (gSceneCtx.nextTriggerMs == 0) {
      gSceneCtx.nextTriggerMs = now + kSfxShowcaseGapMs;
    } else if (now >= gSceneCtx.nextTriggerMs) {
      const uint8_t nextPreset = static_cast<uint8_t>((gSceneCtx.sfxDemoIndex + 1) % kSfxPresetCount);
      startSfxShowcasePreset(nextPreset);
    }
  }

  // Auto-cycle to next scene (chiptune gets 2 full loops, showcase gets a full preset pass)
  uint32_t sceneDur = kSceneDurationMs;
  if (normalized == 7) sceneDur = 8000;
  if (normalized == 9) sceneDur = sfxShowcaseDurationMs();
  if (gAutoCycle && elapsed >= sceneDur) {
    gCurrentScene++;
    applyScene(gCurrentScene);
  }
}

void printStats() {
#if !AUDIO_ENABLE_RUNTIME_LOGS
  return;
#endif
  static uint32_t lastPrintMs = 0;
  const uint32_t now = millis();
  if (now - lastPrintMs < kStatsPeriodMs) return;
  lastPrintMs = now;

  // Read and reset stats without disabling interrupts.
  // On ARM Cortex-M0+ 32-bit reads/writes are atomic — no lock needed.
  // Slight race on reset is acceptable for diagnostic stats.
  const uint32_t samples = gStats.sampleCount;
  const uint32_t busyUs = gStats.renderBusyUs;
  const uint32_t maxUs = gStats.renderMaxUs;
  const uint32_t clipCount = gStats.clipCount;
  const uint32_t overrunCount = gStats.overrunCount;
  gStats.sampleCount = 0;
  gStats.renderBusyUs = 0;
  gStats.renderMaxUs = 0;
  gStats.clipCount = 0;
  gStats.overrunCount = 0;

  const float util = (busyUs / 10000.0f);
  Serial.printf(
      "target=%lu actual=%lu out=i2s bclk=%d lrclk=%d dout=%d samples=%lu busy_us=%lu util=%.2f%% max_us=%lu overruns=%lu clips=%lu scene=%lu(%s) mode=%s\n",
      static_cast<unsigned long>(AUDIO_SAMPLE_RATE_TARGET),
      static_cast<unsigned long>(gActualSampleRate),
      AUDIO_I2S_BCLK_PIN,
      AUDIO_I2S_BCLK_PIN + 1,
      AUDIO_I2S_DOUT_PIN,
      static_cast<unsigned long>(samples),
      static_cast<unsigned long>(busyUs),
      util,
      static_cast<unsigned long>(maxUs),
      static_cast<unsigned long>(overrunCount),
      static_cast<unsigned long>(clipCount),
      static_cast<unsigned long>(normalizeSceneIndex(gCurrentScene)),
      sceneName(gCurrentScene),
      gAutoCycle ? "auto" : "locked");
}

void initAudioI2S() {
  gI2S.setBCLK(AUDIO_I2S_BCLK_PIN);
  gI2S.setDATA(AUDIO_I2S_DOUT_PIN);
  gI2S.setBitsPerSample(16);
  gI2S.setBuffers(6, kI2SBufferWords);
  gI2S.setSysClk(AUDIO_SAMPLE_RATE_TARGET);
  if (!gI2S.begin(AUDIO_SAMPLE_RATE_TARGET)) {
    Serial.println("failed to initialize i2s");
    while (1) {
      delay(10);
    }
  }
  gActualSampleRate = AUDIO_SAMPLE_RATE_TARGET;
}

void printCommandHelp() {
  Serial.println("commands: auto | scene <0-9> | 0..9 | status | help");
}

void handleSerialCommands() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  if (cmd.length() == 0) return;

  if (cmd.equalsIgnoreCase("help")) {
    printCommandHelp();
    return;
  }

  if (cmd.equalsIgnoreCase("auto")) {
    gAutoCycle = true;
    gSceneCtx.startedAtMs = millis();
    gSceneCtx.lastTriggerMs = 0;
    Serial.println("mode: auto");
    return;
  }

  if (cmd.equalsIgnoreCase("status")) {
    Serial.printf("scene=%lu(%s) mode=%s target=%lu actual=%lu out=i2s bclk=%d lrclk=%d dout=%d\n",
                  static_cast<unsigned long>(normalizeSceneIndex(gCurrentScene)),
                  sceneName(gCurrentScene),
                  gAutoCycle ? "auto" : "locked",
                  static_cast<unsigned long>(AUDIO_SAMPLE_RATE_TARGET),
                  static_cast<unsigned long>(gActualSampleRate),
                  AUDIO_I2S_BCLK_PIN,
                  AUDIO_I2S_BCLK_PIN + 1,
                  AUDIO_I2S_DOUT_PIN);
    return;
  }

  int scene = -1;
  if (cmd.length() == 1 && isDigit(cmd[0])) {
    scene = cmd.toInt();
  } else if (cmd.startsWith("scene ")) {
    scene = cmd.substring(6).toInt();
  }

  if (scene >= 0 && scene <= 9) {
    gAutoCycle = false;
    gCurrentScene = static_cast<uint32_t>(scene);
    applyScene(gCurrentScene);
    Serial.printf("mode: locked scene=%d(%s)\n", scene, sceneName(gCurrentScene));
    return;
  }

  Serial.printf("unknown command: %s\n", cmd.c_str());
  printCommandHelp();
}

}  // namespace

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("pico-gamer audio prototype");
  Serial.printf("i2s bclk=%d lrclk=%d dout=%d\n",
                AUDIO_I2S_BCLK_PIN,
                AUDIO_I2S_BCLK_PIN + 1,
                AUDIO_I2S_DOUT_PIN);

#if AUDIO_DEBUG_PIN >= 0
  gpio_init(AUDIO_DEBUG_PIN);
  gpio_set_dir(AUDIO_DEBUG_PIN, GPIO_OUT);
  gpio_put(AUDIO_DEBUG_PIN, 0);
#endif

  initAudioI2S();
  stopAllVoices();
  if (AUDIO_FIXED_SCENE >= 0) {
    gCurrentScene = static_cast<uint32_t>(AUDIO_FIXED_SCENE);
    gAutoCycle = false;
  }
  applyScene(gCurrentScene);

  Serial.printf("target sample rate=%lu actual=%lu out=i2s\n",
                static_cast<unsigned long>(AUDIO_SAMPLE_RATE_TARGET),
                static_cast<unsigned long>(gActualSampleRate));
  printCommandHelp();
}

void loop() {
  pumpAudioI2S();
  handleSerialCommands();
  updateScene();
  printStats();

  static uint32_t lastBlinkMs = 0;
  const uint32_t now = millis();
  if (now - lastBlinkMs >= 250) {
    lastBlinkMs = now;
    gLedState = !gLedState;
    digitalWrite(LED_BUILTIN, gLedState ? HIGH : LOW);
  }
}
