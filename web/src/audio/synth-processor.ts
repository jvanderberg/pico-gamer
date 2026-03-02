/**
 * SID-style 3-voice synthesizer running on the AudioWorklet thread.
 *
 * Oscillators: pulse (variable width), sawtooth, triangle, noise (LFSR).
 * Per-voice ADSR envelope. Global 2-pole state-variable filter (LP/BP/HP).
 * SFX preset engine with sample-accurate timing.
 * TONE convenience (auto note-off timer on voice 0).
 *
 * This file is self-contained (no imports) because AudioWorklet.addModule()
 * loads it in an isolated scope. SFX presets are sent via message on init.
 */

// Syscall IDs (must match syscall-ids.ts)
const SYS_VOICE    = 0x30;
const SYS_ENVELOPE = 0x31;
const SYS_NOTE_OFF = 0x32;
const SYS_FILTER   = 0x33;
const SYS_VOLUME   = 0x34;
const SYS_TONE     = 0x35;
const SYS_SFX      = 0x36;

// Waveform IDs
const WAVE_OFF   = 0;
const WAVE_PULSE = 1;
const WAVE_SAW   = 2;
const WAVE_TRI   = 3;
const WAVE_NOISE = 4;

// ADSR states
const ENV_OFF     = 0;
const ENV_ATTACK  = 1;
const ENV_DECAY   = 2;
const ENV_SUSTAIN = 3;
const ENV_RELEASE = 4;

// Filter modes
const FILTER_LP = 0;
const FILTER_BP = 1;
const FILTER_HP = 2;

interface SfxStep {
  delaySamples: number;
  waveform: number;
  freqHz: number;
  pulseWidth: number;
  volume: number;
  filterCutoff: number;
}

interface Voice {
  waveform: number;
  phase: number;      // 0..1 float phase accumulator
  phaseStep: number;  // per-sample phase increment
  pulseWidth: number; // 0..1 duty cycle

  // ADSR
  envState: number;
  envLevel: number;   // 0..1
  attack: number;     // rate per sample (0..1 increment)
  decay: number;      // rate per sample
  sustain: number;    // 0..1 target level
  release: number;    // rate per sample

  // Noise LFSR
  lfsr: number;
  lfsrOut: number;    // current noise sample -1..1
}

interface FilterState {
  cutoff: number;     // 0..1 normalized
  resonance: number;  // 0..1 (damping = 1 - resonance)
  mode: number;       // 0=LP 1=BP 2=HP
  routing: number;    // bitmask: bit 0=v0, bit 1=v1, bit 2=v2
  lp: number;
  bp: number;
}

interface SfxEngine {
  active: boolean;
  voice: number;
  preset: SfxStep[];
  stepIndex: number;
  sampleCounter: number;
}

interface ToneTimer {
  active: boolean;
  samplesLeft: number;
}

function createVoice(): Voice {
  return {
    waveform: WAVE_OFF,
    phase: 0,
    phaseStep: 0,
    pulseWidth: 0.5,
    envState: ENV_OFF,
    envLevel: 0,
    attack: 0,
    decay: 0,
    sustain: 1,
    release: 0,
    lfsr: 0x7FFF,
    lfsrOut: 0,
  };
}

function createFilter(): FilterState {
  return { cutoff: 1, resonance: 0, mode: FILTER_LP, routing: 0, lp: 0, bp: 0 };
}

/** Convert 0-255 ADSR param to rate per sample. Param 0 = instant. */
function paramToRate(param: number, sr: number): number {
  if (param === 0) return 1; // instant
  const samples = param * (sr * 2 / 255);
  return 1 / samples;
}

/** Convert Hz to phase increment (0..1 per sample). */
function freqToStep(freqHz: number, sr: number): number {
  return freqHz / sr;
}

/** Generate one oscillator sample for a voice (-1..1 range). */
function oscillate(v: Voice): number {
  switch (v.waveform) {
    case WAVE_PULSE:
      return v.phase < v.pulseWidth ? 1 : -1;
    case WAVE_SAW:
      return v.phase * 2 - 1;
    case WAVE_TRI:
      return v.phase < 0.5 ? v.phase * 4 - 1 : 3 - v.phase * 4;
    case WAVE_NOISE:
      return v.lfsrOut;
    default:
      return 0;
  }
}

/** Advance phase accumulator and LFSR for noise. */
function advancePhase(v: Voice): void {
  v.phase += v.phaseStep;
  if (v.phase >= 1) {
    v.phase -= 1;
    // Clock LFSR on each full cycle for noise
    if (v.waveform === WAVE_NOISE) {
      // 16-bit Galois LFSR, taps at bits 16,14,13,11
      const bit = v.lfsr & 1;
      v.lfsr >>= 1;
      if (bit) v.lfsr ^= 0xB400;
      v.lfsrOut = (v.lfsr / 0x7FFF) * 2 - 1;
    }
  }
}

/** Advance ADSR envelope, return current level. */
function advanceEnvelope(v: Voice): number {
  switch (v.envState) {
    case ENV_ATTACK:
      v.envLevel += v.attack;
      if (v.envLevel >= 1) {
        v.envLevel = 1;
        v.envState = ENV_DECAY;
      }
      break;
    case ENV_DECAY:
      v.envLevel -= v.decay;
      if (v.envLevel <= v.sustain) {
        v.envLevel = v.sustain;
        v.envState = ENV_SUSTAIN;
      }
      break;
    case ENV_SUSTAIN:
      break;
    case ENV_RELEASE:
      v.envLevel -= v.release;
      if (v.envLevel <= 0) {
        v.envLevel = 0;
        v.envState = ENV_OFF;
        v.waveform = WAVE_OFF;
      }
      break;
  }
  return v.envLevel;
}

class SynthProcessor extends AudioWorkletProcessor {
  private voices: Voice[];
  private filter: FilterState;
  private masterVolume: number;
  private sfx: SfxEngine;
  private tone: ToneTimer;
  private sfxPresets: SfxStep[][] = [];

  constructor() {
    super();
    this.voices = [createVoice(), createVoice(), createVoice()];
    this.filter = createFilter();
    this.masterVolume = 200 / 255; // sensible default
    this.sfx = { active: false, voice: 2, preset: [], stepIndex: 0, sampleCounter: 0 };
    this.tone = { active: false, samplesLeft: 0 };

    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "init-presets") {
        this.sfxPresets = msg.presets as SfxStep[][];
        return;
      }
      const { type, args } = msg as { type: number; args: number[] };
      this.handleCommand(type, args);
    };
  }

  private handleCommand(type: number, args: number[]): void {
    const sr = sampleRate;
    switch (type) {
      case SYS_VOICE: {
        const [voice, waveform, freqHz, pw] = args;
        if (voice! < 0 || voice! > 2) break;
        const v = this.voices[voice!]!;
        const wasOff = v.waveform === WAVE_OFF;
        v.waveform = waveform!;
        v.phaseStep = freqToStep(freqHz!, sr);
        v.pulseWidth = (pw! & 0xFF) / 255;
        if (waveform === WAVE_OFF) {
          if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
        } else if (wasOff || v.envState === ENV_OFF || v.envState === ENV_RELEASE) {
          v.phase = 0;
          v.envState = ENV_ATTACK;
          v.envLevel = 0;
          if (waveform === WAVE_NOISE) {
            v.lfsr = 0x7FFF;
            v.lfsrOut = 0;
          }
        }
        break;
      }
      case SYS_ENVELOPE: {
        const [voice, a, d, s, r] = args;
        if (voice! < 0 || voice! > 2) break;
        const v = this.voices[voice!]!;
        v.attack = paramToRate(a!, sr);
        v.decay = paramToRate(d!, sr);
        v.sustain = (s! & 0xFF) / 255;
        v.release = paramToRate(r!, sr);
        break;
      }
      case SYS_NOTE_OFF: {
        const [voice] = args;
        if (voice! < 0 || voice! > 2) break;
        const v = this.voices[voice!]!;
        if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
        break;
      }
      case SYS_FILTER: {
        const [cutoff, resonance, mode, routing] = args;
        this.filter.cutoff = 0.01 + (cutoff! & 0xFF) / 255 * 0.89;
        this.filter.resonance = (resonance! & 0xFF) / 255;
        this.filter.mode = mode!;
        this.filter.routing = routing!;
        break;
      }
      case SYS_VOLUME: {
        this.masterVolume = (args[0]! & 0xFF) / 255;
        break;
      }
      case SYS_TONE: {
        const [freqHz, durationMs] = args;
        const v = this.voices[0]!;
        v.waveform = WAVE_PULSE;
        v.phase = 0;
        v.phaseStep = freqToStep(freqHz!, sr);
        v.pulseWidth = 0.5;
        v.attack = paramToRate(0, sr);
        v.decay = paramToRate(50, sr);
        v.sustain = 0.6;
        v.release = paramToRate(30, sr);
        v.envState = ENV_ATTACK;
        v.envLevel = 0;
        this.tone.active = true;
        this.tone.samplesLeft = Math.round((durationMs! / 1000) * sr);
        break;
      }
      case SYS_SFX: {
        const effectId = args[0]!;
        if (effectId < 0 || effectId >= this.sfxPresets.length) break;
        const preset = this.sfxPresets[effectId]!;
        this.sfx.active = true;
        this.sfx.voice = 2;
        this.sfx.preset = preset;
        this.sfx.stepIndex = 0;
        this.sfx.sampleCounter = 0;
        this.applySfxStep(preset[0]!);
        break;
      }
    }
  }

  private applySfxStep(step: SfxStep): void {
    const v = this.voices[this.sfx.voice]!;
    const wasOff = v.waveform === WAVE_OFF;
    v.waveform = step.waveform;
    if (step.waveform === WAVE_OFF) {
      v.envState = ENV_OFF;
      v.envLevel = 0;
    } else {
      v.phaseStep = freqToStep(step.freqHz, sampleRate);
      v.pulseWidth = step.pulseWidth / 255;
      v.envLevel = step.volume / 255;
      v.envState = ENV_SUSTAIN;
      v.sustain = v.envLevel;
      if (wasOff) {
        v.phase = 0;
        if (step.waveform === WAVE_NOISE) {
          v.lfsr = 0x7FFF;
          v.lfsrOut = 0;
        }
      }
    }
    if (step.filterCutoff > 0) {
      this.filter.cutoff = 0.01 + (step.filterCutoff / 255) * 0.89;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]![0]!;
    const len = output.length;

    for (let i = 0; i < len; i++) {
      // TONE auto note-off
      if (this.tone.active) {
        this.tone.samplesLeft--;
        if (this.tone.samplesLeft <= 0) {
          this.tone.active = false;
          const v = this.voices[0]!;
          if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
        }
      }

      // SFX step advancement
      if (this.sfx.active) {
        this.sfx.sampleCounter++;
        const nextIdx = this.sfx.stepIndex + 1;
        if (nextIdx < this.sfx.preset.length) {
          const nextStep = this.sfx.preset[nextIdx]!;
          if (this.sfx.sampleCounter >= nextStep.delaySamples) {
            this.sfx.sampleCounter = 0;
            this.sfx.stepIndex = nextIdx;
            this.applySfxStep(nextStep);
            if (nextStep.waveform === WAVE_OFF) {
              this.sfx.active = false;
            }
          }
        }
      }

      // Mix voices
      let filtered = 0;
      let dry = 0;
      for (let vi = 0; vi < 3; vi++) {
        const v = this.voices[vi]!;
        if (v.waveform === WAVE_OFF && v.envState === ENV_OFF) continue;

        const osc = oscillate(v);
        const env = advanceEnvelope(v);
        advancePhase(v);
        const sample = osc * env;

        if (this.filter.routing & (1 << vi)) {
          filtered += sample;
        } else {
          dry += sample;
        }
      }

      // State-variable filter
      let mixed: number;
      if (this.filter.routing !== 0) {
        const f = this.filter;
        const damping = 1 - f.resonance * 0.95;
        f.lp += f.cutoff * f.bp;
        const hp = filtered - f.lp - damping * f.bp;
        f.bp += f.cutoff * hp;

        let filterOut: number;
        switch (f.mode) {
          case FILTER_LP: filterOut = f.lp; break;
          case FILTER_BP: filterOut = f.bp; break;
          case FILTER_HP: filterOut = hp; break;
          default: filterOut = f.lp;
        }
        mixed = filterOut + dry;
      } else {
        mixed = dry;
      }

      // Master volume and clamp
      mixed = mixed * this.masterVolume * 0.33;
      output[i] = Math.max(-1, Math.min(1, mixed));
    }

    return true;
  }
}

registerProcessor("synth-processor", SynthProcessor);
