#include "audio_engine.h"

#include <Arduino.h>
#include <I2S.h>
#include <math.h>

#include "memory.h"
#include "syscalls.h"

#ifndef AUDIO_I2S_BCLK_PIN
#define AUDIO_I2S_BCLK_PIN 16
#endif

#ifndef AUDIO_I2S_DOUT_PIN
#define AUDIO_I2S_DOUT_PIN 18
#endif

#ifndef AUDIO_SAMPLE_RATE_TARGET
#define AUDIO_SAMPLE_RATE_TARGET 22050
#endif

#ifndef AUDIO_I2S_USE_SYSCLK
#define AUDIO_I2S_USE_SYSCLK 0
#endif

namespace vm_audio {
namespace {

constexpr uint32_t kMaxVoices = 6;
constexpr uint32_t kMaxEffectSteps = 32;
constexpr uint32_t kMaxSongTracks = kMaxVoices;
constexpr size_t kI2SBufferWords = 256;
constexpr uint32_t kWebSfxSampleRate = 44100;
constexpr uint8_t kSongRestPitch = 0xFF;

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
  FILTER_NOTCH = 3,
  FILTER_COMB = 4,
};

constexpr uint16_t kCombMaxDelay = 1024;

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
  uint8_t cutoffParam = 255;
  uint8_t resonanceParam = 0;
  int32_t lp = 0;
  int32_t bp = 0;
  uint16_t combDelay = 1;
  uint16_t combIndex = 0;
  int16_t combBuffer[kCombMaxDelay] = {};
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

struct EffectStep {
  uint32_t delaySamples = 0;
  uint8_t waveform = WAVE_OFF;
  int16_t freqValue = 0;
  uint8_t pulseWidth = 0xFF;
  uint8_t volume = 0xFF;
  uint8_t filterCutoff = 0;
};

struct SfxEngine {
  bool active = false;
  uint8_t voice = 0;
  EffectStep steps[kMaxEffectSteps];
  uint8_t stepCount = 0;
  uint8_t stepIndex = 0;
  uint32_t sampleCounter = 0;
  uint32_t nextDelaySamples = 0;
  bool relativePitch = false;
  uint16_t basePitchHz = 0;
  uint32_t vibratoPhase = 0;
  uint32_t vibratoPhaseStep = 0;
  int16_t vibratoDepthCents = 0;
};

struct SongTrackState {
  bool active = false;
  uint8_t voice = 0;
  uint16_t effectAddr = 0;
  uint16_t vibratoRate64 = 0;
  int16_t vibratoDepthCents = 0;
  uint16_t eventsAddr = 0;
  uint8_t eventCount = 0;
  uint8_t eventIndex = 0;
  uint32_t samplesLeft = 0;
};

struct SongState {
  bool active = false;
  bool loop = false;
  uint8_t trackCount = 0;
  uint32_t stepSamples = 1;
  const uint8_t* memory = nullptr;
  SongTrackState tracks[kMaxSongTracks];
};

Voice gVoices[kMaxVoices];
FilterState gVoiceFilters[kMaxVoices];
uint8_t gVoiceDrive[kMaxVoices] = {};
FilterState gMasterFilter;
ToneTimer gTone;
SfxEngine gSfx[kMaxVoices];
SongState gSong;
uint8_t gMasterVolume = 200;
uint32_t gActualSampleRate = 0;
bool gAudioReady = false;

I2S gI2S(OUTPUT, AUDIO_I2S_BCLK_PIN, AUDIO_I2S_DOUT_PIN);

constexpr uint16_t sfxMsToSamples(uint32_t ms) {
  return static_cast<uint16_t>((static_cast<uint64_t>(ms) * kWebSfxSampleRate + 500u) / 1000u);
}

constexpr SfxStep kLaserPreset[] = {
    {0,                 WAVE_PULSE, 1000, 128, 255, 0},
    {sfxMsToSamples(5), WAVE_PULSE, 800,  128, 255, 0},
    {sfxMsToSamples(5), WAVE_PULSE, 600,  128, 200, 0},
    {sfxMsToSamples(5), WAVE_PULSE, 400,  128, 150, 0},
    {sfxMsToSamples(5), WAVE_PULSE, 200,  128, 80,  0},
    {sfxMsToSamples(3), WAVE_OFF,   0,      0,   0, 0},
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
    {sfxMsToSamples(5), WAVE_OFF,   0, 0,   0, 0},
};

constexpr SfxStep kHitPreset[] = {
    {0,                 WAVE_NOISE, 400, 0, 255, 0},
    {sfxMsToSamples(3), WAVE_NOISE, 400, 0, 120, 0},
    {sfxMsToSamples(3), WAVE_NOISE, 400, 0, 40,  0},
    {sfxMsToSamples(2), WAVE_OFF,     0, 0,   0, 0},
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
    {sfxMsToSamples(80), WAVE_OFF,     0,   0,  0,  0},
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

constexpr const SfxStep* kSfxPresets[] = {
    kLaserPreset,   kExplodePreset, kPickupPreset,  kJumpPreset,
    kHitPreset,     kBouncePreset,  kPowerupPreset, kDeathPreset,
    kCoinPreset,    kBeepPreset,    kThudPreset,    kZapPreset,
    kAlarmPreset,   kClickPreset,   kWhooshPreset,  kBlipPreset,
};

constexpr uint8_t kSfxPresetStepCounts[] = {
    static_cast<uint8_t>(sizeof(kLaserPreset) / sizeof(kLaserPreset[0])),
    static_cast<uint8_t>(sizeof(kExplodePreset) / sizeof(kExplodePreset[0])),
    static_cast<uint8_t>(sizeof(kPickupPreset) / sizeof(kPickupPreset[0])),
    static_cast<uint8_t>(sizeof(kJumpPreset) / sizeof(kJumpPreset[0])),
    static_cast<uint8_t>(sizeof(kHitPreset) / sizeof(kHitPreset[0])),
    static_cast<uint8_t>(sizeof(kBouncePreset) / sizeof(kBouncePreset[0])),
    static_cast<uint8_t>(sizeof(kPowerupPreset) / sizeof(kPowerupPreset[0])),
    static_cast<uint8_t>(sizeof(kDeathPreset) / sizeof(kDeathPreset[0])),
    static_cast<uint8_t>(sizeof(kCoinPreset) / sizeof(kCoinPreset[0])),
    static_cast<uint8_t>(sizeof(kBeepPreset) / sizeof(kBeepPreset[0])),
    static_cast<uint8_t>(sizeof(kThudPreset) / sizeof(kThudPreset[0])),
    static_cast<uint8_t>(sizeof(kZapPreset) / sizeof(kZapPreset[0])),
    static_cast<uint8_t>(sizeof(kAlarmPreset) / sizeof(kAlarmPreset[0])),
    static_cast<uint8_t>(sizeof(kClickPreset) / sizeof(kClickPreset[0])),
    static_cast<uint8_t>(sizeof(kWhooshPreset) / sizeof(kWhooshPreset[0])),
    static_cast<uint8_t>(sizeof(kBlipPreset) / sizeof(kBlipPreset[0])),
};

constexpr uint8_t kSfxPresetCount = static_cast<uint8_t>(sizeof(kSfxPresets) / sizeof(kSfxPresets[0]));

uint8_t readU8(const uint8_t* memory, uint16_t addr) {
  return memory ? memory[addr & 0xFFFFu] : 0;
}

uint16_t readU16(const uint8_t* memory, uint16_t addr) {
  const uint8_t lo = readU8(memory, addr);
  const uint8_t hi = readU8(memory, static_cast<uint16_t>(addr + 1u));
  return static_cast<uint16_t>(lo | (static_cast<uint16_t>(hi) << 8));
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

uint16_t midiToHz(uint16_t pitch) {
  const float hz = 440.0f * powf(2.0f, (static_cast<int32_t>(pitch) - 69) / 12.0f);
  if (hz < 1.0f) return 1;
  if (hz > 65535.0f) return 65535;
  return static_cast<uint16_t>(lroundf(hz));
}

uint16_t pitchToHz(uint16_t pitch) {
  return pitch <= 127 ? midiToHz(pitch) : pitch;
}

uint16_t applyCents(uint16_t baseHz, int16_t cents) {
  const float hz = static_cast<float>(baseHz) * powf(2.0f, static_cast<float>(cents) / 1200.0f);
  if (hz < 1.0f) return 1;
  if (hz > 65535.0f) return 65535;
  return static_cast<uint16_t>(lroundf(hz));
}

uint32_t vibratoRateToPhaseStep(uint16_t rate64) {
  return static_cast<uint32_t>((static_cast<uint64_t>(rate64) << 26) / gActualSampleRate);
}

int32_t triangleLfoQ15(uint32_t phase) {
  const uint32_t p = phase >> 16;
  if (p < 16384u) return static_cast<int32_t>(p << 1);
  if (p < 49152u) return 65534 - static_cast<int32_t>(p << 1);
  return static_cast<int32_t>(p << 1) - 131070;
}

void resetFilter() {
  for (FilterState& f : gVoiceFilters) {
    f = FilterState{};
    f.cutoff = cutoffToCoeff(255);
    f.resonance = 0;
    f.mode = FILTER_LP;
  }
  gMasterFilter = FilterState{};
  gMasterFilter.cutoff = cutoffToCoeff(255);
  gMasterFilter.resonance = 0;
  gMasterFilter.mode = FILTER_LP;
}

void setMasterVolume(uint8_t volume) {
  gMasterVolume = volume;
}

void setFilterParams(FilterState& f, uint8_t cutoff, uint8_t resonance, uint8_t mode) {
  f.cutoffParam = cutoff;
  f.resonanceParam = resonance;
  f.cutoff = cutoffToCoeff(cutoff);
  f.resonance = static_cast<uint16_t>((static_cast<uint32_t>(resonance) * 30000u) / 255u);
  f.mode = mode;
  f.combDelay = 1u + ((static_cast<uint32_t>(255u - cutoff) * (kCombMaxDelay - 1u)) / 255u);
}

void setFilter(uint8_t cutoff, uint8_t resonance, uint8_t mode) {
  setFilterParams(gMasterFilter, cutoff, resonance, mode);
}

void setVoiceFilter(uint8_t voice, uint8_t cutoff, uint8_t resonance, uint8_t mode) {
  if (voice >= kMaxVoices) return;
  setFilterParams(gVoiceFilters[voice], cutoff, resonance, mode);
}

int32_t applyFilter(FilterState& f, int32_t sampleIn) {
  if (f.mode == FILTER_COMB) {
    const uint16_t readIndex = static_cast<uint16_t>((f.combIndex + kCombMaxDelay - f.combDelay) % kCombMaxDelay);
    const int32_t delayed = f.combBuffer[readIndex];
    const int32_t output = (sampleIn + delayed) >> 1;
    int32_t write = sampleIn + ((static_cast<int64_t>(delayed) * f.resonance) >> 15);
    if (write > 32767) write = 32767;
    if (write < -32768) write = -32768;
    f.combBuffer[f.combIndex] = static_cast<int16_t>(write);
    f.combIndex = static_cast<uint16_t>((f.combIndex + 1u) % kCombMaxDelay);
    return output;
  }
  const int32_t damping = 32767 - f.resonance;
  f.lp += (static_cast<int64_t>(f.cutoff) * f.bp) >> 15;
  const int32_t hp = sampleIn - f.lp - ((static_cast<int64_t>(damping) * f.bp) >> 15);
  f.bp += (static_cast<int64_t>(f.cutoff) * hp) >> 15;
  if (f.mode == FILTER_BP) return f.bp;
  if (f.mode == FILTER_HP) return hp;
  if (f.mode == FILTER_NOTCH) return f.lp + hp;
  return f.lp;
}

int32_t applyDrive(int32_t sampleIn, uint8_t amount) {
  if (amount == 0) return sampleIn;
  const int32_t gain = 256 + static_cast<int32_t>(amount) * 3;
  int32_t x = (sampleIn * gain) >> 8;
  const int32_t ax = x < 0 ? -x : x;
  const int32_t denom = 32768 + ((ax * 3) >> 2);
  x = static_cast<int32_t>((static_cast<int64_t>(x) * 32768) / denom);
  return x;
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

void setVoice(uint8_t voice, uint8_t waveform, uint16_t freqHz, uint8_t pulseWidth, bool retrigger) {
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

  if (retrigger || wasOff || v.envState == ENV_OFF || v.envState == ENV_RELEASE) {
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
  setVoice(voice, WAVE_PULSE, freqHz, 128, true);
  gTone.active = true;
  gTone.voice = voice;
  gTone.samplesLeft = msToSamples(durationMs);
}

void stopVoiceAutomation(uint8_t voice) {
  if (voice >= kMaxVoices) return;
  SfxEngine& eng = gSfx[voice];
  eng.active = false;
  eng.stepCount = 0;
  eng.stepIndex = 0;
  eng.sampleCounter = 0;
  eng.nextDelaySamples = 0;
  eng.relativePitch = false;
  eng.basePitchHz = 0;
  eng.vibratoPhase = 0;
  eng.vibratoPhaseStep = 0;
  eng.vibratoDepthCents = 0;
  if (gTone.active && gTone.voice == voice) {
    gTone.active = false;
    gTone.samplesLeft = 0;
  }
}

void startEffectEngine(SfxEngine& eng) {
  eng.active = eng.stepCount > 0;
  eng.stepIndex = 0;
  eng.sampleCounter = 0;
  eng.nextDelaySamples = (eng.stepCount > 1) ? eng.steps[1].delaySamples : 0;
  eng.vibratoPhase = 0;
}

bool loadEffectFromMemory(SfxEngine& eng, const uint8_t* memory, uint16_t addr, bool relativePitch, uint16_t pitch) {
  if (memory == nullptr) return false;
  const uint8_t count = readU8(memory, addr);
  if (count == 0) return false;
  eng.stepCount = count > kMaxEffectSteps ? kMaxEffectSteps : count;
  eng.relativePitch = relativePitch;
  eng.basePitchHz = relativePitch ? pitchToHz(pitch) : 0;
  for (uint8_t i = 0; i < eng.stepCount; i++) {
    const uint16_t base = static_cast<uint16_t>(addr + 1u + static_cast<uint16_t>(i) * 8u);
    eng.steps[i].delaySamples = msToSamples(readU16(memory, base));
    eng.steps[i].waveform = readU8(memory, base + 2u);
    eng.steps[i].freqValue = static_cast<int16_t>(readU16(memory, base + 3u));
    eng.steps[i].pulseWidth = readU8(memory, base + 5u);
    eng.steps[i].volume = readU8(memory, base + 6u);
    eng.steps[i].filterCutoff = readU8(memory, base + 7u);
  }
  return true;
}

void applySfxStep(SfxEngine& eng, const EffectStep& step) {
  Voice& v = gVoices[eng.voice];
  const bool wasOff = v.waveform == WAVE_OFF;
  v.waveform = step.waveform;
  if (step.waveform == WAVE_OFF) {
    v.envState = ENV_OFF;
    v.envLevel = 0;
  } else {
    const uint16_t freqHz = eng.relativePitch ? applyCents(eng.basePitchHz, step.freqValue)
                                              : static_cast<uint16_t>(step.freqValue);
    v.phaseStep = hzToPhaseStep(freqHz);
    if (step.pulseWidth != 0xFF) {
      v.pulseWidth = static_cast<uint16_t>(step.pulseWidth * 257u);
    }
    if (step.volume != 0xFF) {
      v.envLevel = static_cast<uint16_t>(step.volume * 257u);
      v.sustain = v.envLevel;
    }
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
    FilterState& f = gVoiceFilters[eng.voice];
    setFilterParams(f, step.filterCutoff, f.resonanceParam, f.mode);
  }
}

void stopSong() {
  if (!gSong.active) return;
  for (uint8_t i = 0; i < gSong.trackCount; i++) {
    SongTrackState& track = gSong.tracks[i];
    stopVoiceAutomation(track.voice);
    noteOff(track.voice);
    track = SongTrackState{};
  }
  gSong = SongState{};
}

void triggerSongEvent(SongTrackState& track) {
  if (!gSong.memory || track.eventCount == 0) return;
  const uint16_t eventBase = static_cast<uint16_t>(track.eventsAddr + 1u + static_cast<uint16_t>(track.eventIndex) * 2u);
  const uint8_t pitch = readU8(gSong.memory, eventBase);
  const uint8_t duration = readU8(gSong.memory, static_cast<uint16_t>(eventBase + 1u));
  track.samplesLeft = gSong.stepSamples * static_cast<uint32_t>(duration == 0 ? 1 : duration);

  stopVoiceAutomation(track.voice);
  if (pitch == kSongRestPitch) {
    noteOff(track.voice);
    return;
  }

  SfxEngine& eng = gSfx[track.voice];
  eng.voice = track.voice;
  if (loadEffectFromMemory(eng, gSong.memory, track.effectAddr, true, pitch)) {
    eng.vibratoPhaseStep = vibratoRateToPhaseStep(track.vibratoRate64);
    eng.vibratoDepthCents = track.vibratoDepthCents;
    startEffectEngine(eng);
    applySfxStep(eng, eng.steps[0]);
  }
}

void startSong(const uint8_t* memory, uint16_t addr) {
  stopSong();
  if (memory == nullptr) return;

  const uint8_t trackCount = readU8(memory, addr);
  if (trackCount == 0) return;
  const uint8_t bpm = readU8(memory, static_cast<uint16_t>(addr + 1u));
  const uint8_t loop = readU8(memory, static_cast<uint16_t>(addr + 2u));
  const uint32_t stepSamples = static_cast<uint32_t>(
      (static_cast<uint64_t>(gActualSampleRate) * 60u + (static_cast<uint32_t>(bpm ? bpm : 1u) * 2u)) /
      (static_cast<uint32_t>(bpm ? bpm : 1u) * 4u));

  gSong.active = true;
  gSong.loop = loop != 0;
  gSong.trackCount = trackCount > kMaxSongTracks ? kMaxSongTracks : trackCount;
  gSong.stepSamples = stepSamples == 0 ? 1u : stepSamples;
  gSong.memory = memory;

  uint16_t trackBase = static_cast<uint16_t>(addr + 3u);
  for (uint8_t i = 0; i < gSong.trackCount; i++) {
    SongTrackState& track = gSong.tracks[i];
    track.active = true;
    track.voice = readU8(memory, trackBase);
    track.effectAddr = readU16(memory, static_cast<uint16_t>(trackBase + 1u));
    track.vibratoRate64 = readU16(memory, static_cast<uint16_t>(trackBase + 3u));
    track.vibratoDepthCents = static_cast<int16_t>(readU16(memory, static_cast<uint16_t>(trackBase + 5u)));
    track.eventsAddr = readU16(memory, static_cast<uint16_t>(trackBase + 7u));
    track.eventCount = readU8(memory, track.eventsAddr);
    track.eventIndex = 0;
    track.samplesLeft = 0;
    if (track.voice >= kMaxVoices || track.eventCount == 0) {
      track.active = false;
    } else {
      triggerSongEvent(track);
    }
    trackBase = static_cast<uint16_t>(trackBase + 9u);
  }

  bool anyTrackActive = false;
  for (uint8_t i = 0; i < gSong.trackCount; i++) {
    anyTrackActive = anyTrackActive || gSong.tracks[i].active;
  }
  if (!anyTrackActive) {
    gSong = SongState{};
  }
}

void triggerSfxPreset(uint8_t effectId, uint8_t voice) {
  if (voice >= kMaxVoices || effectId >= kSfxPresetCount) return;
  SfxEngine& eng = gSfx[voice];
  stopVoiceAutomation(voice);
  eng.voice = voice;
  eng.stepCount = kSfxPresetStepCounts[effectId];
  eng.relativePitch = false;
  eng.basePitchHz = 0;
  for (uint8_t i = 0; i < eng.stepCount; i++) {
    const SfxStep& src = kSfxPresets[effectId][i];
    eng.steps[i].delaySamples = scaleSfxDelaySamples(src.delaySamples);
    eng.steps[i].waveform = src.waveform;
    eng.steps[i].freqValue = static_cast<int16_t>(src.freqHz);
    eng.steps[i].pulseWidth = src.pulseWidth;
    eng.steps[i].volume = src.volume;
    eng.steps[i].filterCutoff = src.filterCutoff;
  }
  startEffectEngine(eng);
  applySfxStep(eng, eng.steps[0]);
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
  if (gSong.active) {
    bool anyTrackActive = false;
    for (uint8_t i = 0; i < gSong.trackCount; i++) {
      SongTrackState& track = gSong.tracks[i];
      if (!track.active) continue;
      anyTrackActive = true;
      if (track.samplesLeft > 0) {
        track.samplesLeft--;
      }
      if (track.samplesLeft > 0) continue;

      track.eventIndex++;
      if (track.eventIndex >= track.eventCount) {
        if (gSong.loop) {
          track.eventIndex = 0;
        } else {
          track.active = false;
          stopVoiceAutomation(track.voice);
          noteOff(track.voice);
          continue;
        }
      }

      triggerSongEvent(track);
    }
    if (!anyTrackActive) {
      gSong = SongState{};
    }
  }

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
    if (!eng.active || eng.stepCount == 0) continue;
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
      applySfxStep(eng, eng.steps[nextIndex]);
      if (eng.steps[nextIndex].waveform == WAVE_OFF) {
        eng.active = false;
        eng.nextDelaySamples = 0;
      } else {
        const uint8_t futureIndex = nextIndex + 1;
        eng.nextDelaySamples = (futureIndex < eng.stepCount) ? eng.steps[futureIndex].delaySamples : 0;
      }
    }

    if (eng.relativePitch && eng.vibratoDepthCents != 0) {
      Voice& v = gVoices[eng.voice];
      if (v.waveform != WAVE_OFF && eng.stepIndex < eng.stepCount) {
        const int32_t vib = (triangleLfoQ15(eng.vibratoPhase) * eng.vibratoDepthCents) >> 15;
        const int16_t cents = static_cast<int16_t>(eng.steps[eng.stepIndex].freqValue + vib);
        v.phaseStep = hzToPhaseStep(applyCents(eng.basePitchHz, cents));
      }
      eng.vibratoPhase += eng.vibratoPhaseStep;
    }
  }
}

int16_t renderSample() {
  updateToneAndSfx();

  int32_t mixed = 0;
  for (uint32_t i = 0; i < kMaxVoices; i++) {
    Voice& v = gVoices[i];
    if (v.waveform == WAVE_OFF && v.envState == ENV_OFF) continue;
    const int16_t osc = oscillate(v);
    const uint16_t env = advanceEnvelope(v);
    advancePhase(v);
    const int32_t sample = (static_cast<int32_t>(osc) * env) >> 16;
    mixed += applyDrive(applyFilter(gVoiceFilters[i], sample), gVoiceDrive[i]);
  }
  mixed = applyFilter(gMasterFilter, mixed);

  mixed = (mixed * gMasterVolume) >> 8;
  mixed /= 3;

  if (mixed > 32767) return 32767;
  if (mixed < -32768) return -32768;
  return static_cast<int16_t>(mixed);
}

}  // namespace

bool init() {
  gI2S.setBCLK(AUDIO_I2S_BCLK_PIN);
  gI2S.setDATA(AUDIO_I2S_DOUT_PIN);
  gI2S.setBitsPerSample(16);
  gI2S.setBuffers(6, kI2SBufferWords);
#if AUDIO_I2S_USE_SYSCLK
  gI2S.setSysClk(AUDIO_SAMPLE_RATE_TARGET);
#endif
  if (!gI2S.begin(AUDIO_SAMPLE_RATE_TARGET)) {
    Serial.println("audio: failed to initialize i2s");
    gAudioReady = false;
    return false;
  }
  gActualSampleRate = AUDIO_SAMPLE_RATE_TARGET;
  gAudioReady = true;
  stopAll();
  return true;
}

void pump() {
  if (!gAudioReady) return;
  const int frames = gI2S.availableForWrite() / static_cast<int>(sizeof(int16_t) * 2u);
  for (int i = 0; i < frames; i++) {
    const int16_t sample = renderSample();
    gI2S.write16(sample, sample);
  }
}

void stopAll() {
  stopSong();
  for (Voice& voice : gVoices) voice = Voice{};
  for (SfxEngine& eng : gSfx) eng = SfxEngine{};
  memset(gVoiceDrive, 0, sizeof(gVoiceDrive));
  gTone = {};
  gSong = SongState{};
  resetFilter();
  setMasterVolume(200);
}

void dispatchCommand(uint8_t id, const uint16_t* args, uint8_t argCount, const uint8_t* memory) {
  if (!gAudioReady || args == nullptr) return;

  switch (id) {
    case SYS_VOICE:
      if (argCount >= 1) stopVoiceAutomation(static_cast<uint8_t>(args[0]));
      if (argCount >= 4) setVoice(args[0], args[1], args[2], args[3], false);
      break;
    case SYS_ENVELOPE:
      if (argCount >= 5) setEnvelope(args[0], args[1], args[2], args[3], args[4]);
      break;
    case SYS_NOTE_OFF:
      if (argCount >= 1) {
        stopVoiceAutomation(static_cast<uint8_t>(args[0]));
        noteOff(args[0]);
      }
      break;
    case SYS_FILTER:
      if (argCount >= 3) setFilter(args[0], args[1], args[2]);
      break;
    case SYS_VFILTER:
      if (argCount >= 4) setVoiceFilter(static_cast<uint8_t>(args[0]), args[1], args[2], args[3]);
      break;
    case SYS_VDRIVE:
      if (argCount >= 2 && args[0] < kMaxVoices) gVoiceDrive[args[0]] = static_cast<uint8_t>(args[1]);
      break;
    case SYS_VOLUME:
      if (argCount >= 1) setMasterVolume(static_cast<uint8_t>(args[0]));
      break;
    case SYS_TONE:
      if (argCount >= 3) {
        stopVoiceAutomation(static_cast<uint8_t>(args[0]));
        playTone(args[0], args[1], args[2]);
      }
      break;
    case SYS_SFX:
      if (argCount >= 2) {
        if (args[0] < kSfxPresetCount) {
          triggerSfxPreset(static_cast<uint8_t>(args[0]), static_cast<uint8_t>(args[1]));
        } else if (args[1] < kMaxVoices) {
          stopVoiceAutomation(static_cast<uint8_t>(args[1]));
          SfxEngine& eng = gSfx[args[1]];
          eng.voice = static_cast<uint8_t>(args[1]);
          if (loadEffectFromMemory(eng, memory, args[0], false, 0)) {
            startEffectEngine(eng);
            applySfxStep(eng, eng.steps[0]);
          }
        }
      }
      break;
    case SYS_NOTE:
      if (argCount >= 3 && args[1] < kMaxVoices) {
        stopVoiceAutomation(static_cast<uint8_t>(args[1]));
        SfxEngine& eng = gSfx[args[1]];
        eng.voice = static_cast<uint8_t>(args[1]);
        if (loadEffectFromMemory(eng, memory, args[0], true, args[2])) {
          eng.vibratoPhaseStep = (argCount >= 4) ? vibratoRateToPhaseStep(args[3]) : 0;
          eng.vibratoDepthCents = (argCount >= 5) ? static_cast<int16_t>(args[4]) : 0;
          startEffectEngine(eng);
          applySfxStep(eng, eng.steps[0]);
        }
      }
      break;
    case SYS_MPLAY:
      if (argCount >= 1) startSong(memory, args[0]);
      break;
    case SYS_MSTOP:
      stopSong();
      break;
    default:
      break;
  }
}

void drainCommands(AudioCmdBuffer& buffer, const uint8_t* memory) {
  for (int i = 0; i < buffer.count; i++) {
    dispatchCommand(buffer.cmds[i].id, buffer.cmds[i].args, buffer.cmds[i].argCount, memory);
  }
  buffer.count = 0;
}

}  // namespace vm_audio
