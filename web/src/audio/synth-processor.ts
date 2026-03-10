/**
 * SID-style 6-voice synthesizer running on the AudioWorklet thread.
 *
 * Oscillators: pulse (variable width), sawtooth, triangle, noise (LFSR).
 * Per-voice ADSR envelope. Global 2-pole state-variable filter (LP/BP/HP).
 * SFX preset engine with sample-accurate timing.
 * TONE convenience (auto note-off timer on caller-specified voice).
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
const SYS_VFILTER  = 0x37;
const SYS_NOTE     = 0x38;
const SYS_VDRIVE   = 0x39;
const SYS_MPLAY    = 0x3a;
const SYS_MSTOP    = 0x3b;
const BUILTIN_SFX_COUNT = 16;
const SONG_REST_PITCH = 0xff;

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
const FILTER_NOTCH = 3;
const FILTER_COMB = 4;
const COMB_MAX_DELAY = 1024;

interface PresetStep {
  delaySamples: number;
  waveform: number;
  freqHz: number;
  pulseWidth: number;
  volume: number;
  filterCutoff: number;
}

interface EffectStep {
  delaySamples: number;
  waveform: number;
  freqValue: number;
  pulseWidth: number;
  volume: number;
  filterCutoff: number;
}

interface EffectPayload {
  mode: "absolute" | "relative";
  basePitch: number;
  vibratoRate64: number;
  vibratoDepth: number;
  steps: Array<{
    delayMs: number;
    waveform: number;
    freqValue: number;
    pulseWidth: number;
    volume: number;
    filterCutoff: number;
  }>;
}

interface SongEventPayload {
  pitch: number;
  duration: number;
}

interface SongTrackPayload {
  voice: number;
  vibratoRate64: number;
  vibratoDepth: number;
  effect: EffectPayload;
  events: SongEventPayload[];
}

interface SongPayload {
  bpm: number;
  loop: boolean;
  tracks: SongTrackPayload[];
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
  lp: number;
  bp: number;
  cutoffParam: number;
  resonanceParam: number;
  combDelay: number;
  combFeedback: number;
  combIndex: number;
  combBuffer: Float32Array;
}

interface SfxEngine {
  active: boolean;
  voice: number;
  steps: EffectStep[];
  stepIndex: number;
  sampleCounter: number;
  relativePitch: boolean;
  basePitch: number;
  vibratoPhase: number;
  vibratoStep: number;
  vibratoDepth: number;
}

interface ToneTimer {
  active: boolean;
  voice: number;
  samplesLeft: number;
}

interface SongTrackState {
  active: boolean;
  voice: number;
  vibratoRate64: number;
  vibratoDepth: number;
  effect: EffectPayload;
  events: SongEventPayload[];
  eventIndex: number;
  samplesLeft: number;
}

interface SongState {
  loop: boolean;
  stepSamples: number;
  tracks: SongTrackState[];
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
  return {
    cutoff: 1,
    resonance: 0,
    mode: FILTER_LP,
    lp: 0,
    bp: 0,
    cutoffParam: 255,
    resonanceParam: 0,
    combDelay: 1,
    combFeedback: 0,
    combIndex: 0,
    combBuffer: new Float32Array(COMB_MAX_DELAY),
  };
}

function setFilterParams(f: FilterState, cutoff: number, resonance: number, mode: number): void {
  f.cutoffParam = cutoff & 0xff;
  f.resonanceParam = resonance & 0xff;
  f.cutoff = 0.01 + f.cutoffParam / 255 * 0.89;
  f.resonance = f.resonanceParam / 255;
  f.mode = mode;
  f.combDelay = 1 + Math.round(((255 - f.cutoffParam) / 255) * (COMB_MAX_DELAY - 1));
  f.combFeedback = (f.resonanceParam / 255) * 0.98;
}

function applyFilter(f: FilterState, sampleIn: number): number {
  if (f.mode === FILTER_COMB) {
    const readIndex = (f.combIndex + COMB_MAX_DELAY - f.combDelay) % COMB_MAX_DELAY;
    const delayed = f.combBuffer[readIndex] ?? 0;
    const output = (sampleIn + delayed) * 0.5;
    f.combBuffer[f.combIndex] = Math.max(-1, Math.min(1, sampleIn + delayed * f.combFeedback));
    f.combIndex = (f.combIndex + 1) % COMB_MAX_DELAY;
    return output;
  }
  const damping = 1 - f.resonance * 0.95;
  f.lp += f.cutoff * f.bp;
  const hp = sampleIn - f.lp - damping * f.bp;
  f.bp += f.cutoff * hp;
  switch (f.mode) {
    case FILTER_LP: return f.lp;
    case FILTER_BP: return f.bp;
    case FILTER_HP: return hp;
    case FILTER_NOTCH: return f.lp + hp;
    default: return f.lp;
  }
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

function midiToHz(note: number): number {
  return Math.round(440 * Math.pow(2, (note - 69) / 12));
}

function triangleLfo(phase: number): number {
  if (phase < 0.25) return phase * 4;
  if (phase < 0.75) return 2 - phase * 4;
  return phase * 4 - 4;
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
  private voiceFilters: FilterState[];
  private voiceDrive: number[];
  private masterFilter: FilterState;
  private masterVolume: number;
  private sfx: SfxEngine[];
  private tone: ToneTimer;
  private song: SongState | null;
  private sfxPresets: PresetStep[][] = [];
  private voiceExternal: boolean[];

  constructor() {
    super();
    this.voices = [createVoice(), createVoice(), createVoice(), createVoice(), createVoice(), createVoice()];
    this.voiceFilters = [createFilter(), createFilter(), createFilter(), createFilter(), createFilter(), createFilter()];
    this.voiceDrive = [0, 0, 0, 0, 0, 0];
    this.voiceExternal = [false, false, false, false, false, false];
    this.masterFilter = createFilter();
    this.masterVolume = 200 / 255; // sensible default
    this.sfx = [];
    for (let i = 0; i < 6; i++) {
      this.sfx.push({
        active: false,
        voice: i,
        steps: [],
        stepIndex: 0,
        sampleCounter: 0,
        relativePitch: false,
        basePitch: 0,
        vibratoPhase: 0,
        vibratoStep: 0,
        vibratoDepth: 0,
      });
    }
    this.tone = { active: false, voice: 0, samplesLeft: 0 };
    this.song = null;

    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "init-presets") {
        this.sfxPresets = msg.presets as PresetStep[][];
        return;
      }
      if (msg.type === "reset") {
        this.resetAll();
        return;
      }
      const { type, args, effect, song } = msg as { type: number; args: number[]; effect?: EffectPayload; song?: SongPayload };
      this.handleCommand(type, args, effect, song);
    };
  }

  private handleCommand(type: number, args: number[], effect?: EffectPayload, song?: SongPayload): void {
    const sr = sampleRate;
    switch (type) {
      case SYS_VOICE: {
        const [voice, waveform, freqHz, pw] = args;
        if (voice! < 0 || voice! > 5) break;
        this.voiceExternal[voice!] = true;
        this.stopVoiceAutomation(voice!);
        this.startVoice(voice!, waveform!, freqHz!, pw!, sr, false);
        break;
      }
      case SYS_ENVELOPE: {
        const [voice, a, d, s, r] = args;
        if (voice! < 0 || voice! > 5) break;
        const v = this.voices[voice!]!;
        v.attack = paramToRate(a!, sr);
        v.decay = paramToRate(d!, sr);
        v.sustain = (s! & 0xFF) / 255;
        v.release = paramToRate(r!, sr);
        break;
      }
      case SYS_NOTE_OFF: {
        const [voice] = args;
        if (voice! < 0 || voice! > 5) break;
        this.voiceExternal[voice!] = false;
        this.stopVoiceAutomation(voice!);
        const v = this.voices[voice!]!;
        if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
        break;
      }
      case SYS_FILTER: {
        const [cutoff, resonance, mode] = args;
        setFilterParams(this.masterFilter, cutoff!, resonance!, mode!);
        break;
      }
      case SYS_VFILTER: {
        const [voice, cutoff, resonance, mode] = args;
        if (voice! < 0 || voice! > 5) break;
        setFilterParams(this.voiceFilters[voice!]!, cutoff!, resonance!, mode!);
        break;
      }
      case SYS_VDRIVE: {
        const [voice, amount] = args;
        if (voice! < 0 || voice! > 5) break;
        this.voiceDrive[voice!] = (amount! & 0xff) / 255;
        break;
      }
      case SYS_VOLUME: {
        this.masterVolume = (args[0]! & 0xFF) / 255;
        break;
      }
      case SYS_TONE: {
        const [voice, freqHz, durationMs] = args;
        if (voice! < 0 || voice! > 5) break;
        this.voiceExternal[voice!] = true;
        this.stopVoiceAutomation(voice!);
        const v = this.voices[voice!]!;
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
        this.tone.voice = voice!;
        this.tone.samplesLeft = Math.round((durationMs! / 1000) * sr);
        break;
      }
      case SYS_SFX: {
        const [effectRef, voice] = args;
        if (voice! < 0 || voice! > 5) break;
        this.voiceExternal[voice!] = true;
        if (effect) {
          this.startEffect(voice!, effect);
          break;
        }
        if (effectRef! < 0 || effectRef! >= BUILTIN_SFX_COUNT || effectRef! >= this.sfxPresets.length) break;
        const preset = this.sfxPresets[effectRef!]!;
        this.startBuiltinPreset(voice!, preset);
        break;
      }
      case SYS_NOTE: {
        const [, voice] = args;
        if (voice! < 0 || voice! > 5 || !effect) break;
        this.voiceExternal[voice!] = true;
        this.startEffect(voice!, effect);
        break;
      }
      case SYS_MPLAY:
        if (song) this.startSong(song);
        break;
      case SYS_MSTOP:
        this.stopSong();
        break;
    }
  }

  private resetAll(): void {
    for (let i = 0; i < 6; i++) {
      this.stopVoiceAutomation(i);
      const v = this.voices[i]!;
      v.waveform = 0;
      v.envState = ENV_OFF;
      v.envLevel = 0;
      v.phase = 0;
      v.phaseStep = 0;
      this.voiceFilters[i] = createFilter();
      this.voiceDrive[i] = 0;
      this.voiceExternal[i] = false;
    }
    this.masterFilter = createFilter();
    this.masterVolume = 200 / 255;
    this.stopSong();
  }

  private stopVoiceAutomation(voice: number): void {
    const eng = this.sfx[voice]!;
    eng.active = false;
    eng.steps = [];
    eng.stepIndex = 0;
    eng.sampleCounter = 0;
    eng.relativePitch = false;
    eng.basePitch = 0;
    eng.vibratoPhase = 0;
    eng.vibratoStep = 0;
    eng.vibratoDepth = 0;
    if (this.tone.active && this.tone.voice === voice) {
      this.tone.active = false;
      this.tone.samplesLeft = 0;
    }
  }

  private startBuiltinPreset(voice: number, preset: PresetStep[]): void {
    this.stopVoiceAutomation(voice);
    const eng = this.sfx[voice]!;
    eng.active = preset.length > 0;
    eng.voice = voice;
    eng.steps = preset.map((step) => ({
      delaySamples: step.delaySamples,
      waveform: step.waveform,
      freqValue: step.freqHz,
      pulseWidth: step.pulseWidth,
      volume: step.volume,
      filterCutoff: step.filterCutoff,
    }));
    eng.stepIndex = 0;
    eng.sampleCounter = 0;
    eng.relativePitch = false;
    eng.basePitch = 0;
    eng.vibratoPhase = 0;
    eng.vibratoStep = 0;
    eng.vibratoDepth = 0;
    if (eng.steps.length > 0) {
      this.applySfxStep(eng, eng.steps[0]!);
    }
  }

  private startEffect(voice: number, effect: EffectPayload): void {
    this.stopVoiceAutomation(voice);
    const eng = this.sfx[voice]!;
    eng.active = effect.steps.length > 0;
    eng.voice = voice;
    eng.steps = effect.steps.map((step) => ({
      delaySamples: Math.max(0, Math.round(step.delayMs * sampleRate / 1000)),
      waveform: step.waveform,
      freqValue: step.freqValue,
      pulseWidth: step.pulseWidth,
      volume: step.volume,
      filterCutoff: step.filterCutoff,
    }));
    eng.stepIndex = 0;
    eng.sampleCounter = 0;
    eng.relativePitch = effect.mode === "relative";
    eng.basePitch = effect.basePitch;
    eng.vibratoPhase = 0;
    eng.vibratoStep = effect.vibratoRate64 / (64 * sampleRate);
    eng.vibratoDepth = effect.vibratoDepth;
    if (eng.steps.length > 0) {
      this.applySfxStep(eng, eng.steps[0]!);
    }
  }

  private stopSong(): void {
    if (!this.song) return;
    for (const track of this.song.tracks) {
      this.stopVoiceAutomation(track.voice);
      const v = this.voices[track.voice]!;
      if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
    }
    this.song = null;
  }

  private startSong(song: SongPayload): void {
    this.stopSong();
    const stepSamples = Math.max(1, Math.round(sampleRate * 60 / Math.max(1, song.bpm) / 4));
    const tracks: SongTrackState[] = [];

    for (const track of song.tracks) {
      if (track.voice < 0 || track.voice > 5 || track.events.length === 0) continue;
      tracks.push({
        active: true,
        voice: track.voice,
        vibratoRate64: track.vibratoRate64,
        vibratoDepth: track.vibratoDepth,
        effect: track.effect,
        events: track.events,
        eventIndex: 0,
        samplesLeft: 0,
      });
    }

    if (tracks.length === 0) return;
    this.song = { loop: song.loop, stepSamples, tracks };
    for (const track of this.song.tracks) {
      this.triggerSongEvent(track);
    }
  }

  private triggerSongEvent(track: SongTrackState): void {
    const currentSong = this.song;
    if (!currentSong) return;
    const event = track.events[track.eventIndex]!;
    track.samplesLeft = Math.max(1, event.duration * currentSong.stepSamples);

    // If the voice is externally occupied (SFX/VOICE/TONE), skip this note
    // but keep the timer running so the song stays in sync
    if (this.voiceExternal[track.voice]) {
      // Check if the external sound has finished (envelope off and no active automation)
      const v = this.voices[track.voice]!;
      const eng = this.sfx[track.voice]!;
      if (v.envState === ENV_OFF && !eng.active) {
        this.voiceExternal[track.voice] = false;
      } else {
        return;
      }
    }

    if (event.pitch === SONG_REST_PITCH) {
      this.stopVoiceAutomation(track.voice);
      const v = this.voices[track.voice]!;
      if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
      return;
    }

    this.startEffect(track.voice, {
      ...track.effect,
      mode: "relative",
      basePitch: midiToHz(event.pitch),
      vibratoRate64: track.vibratoRate64,
      vibratoDepth: track.vibratoDepth,
    });
  }

  private advanceSong(): void {
    if (!this.song) return;
    let anyActive = false;

    for (const track of this.song.tracks) {
      if (!track.active) continue;
      anyActive = true;
      track.samplesLeft--;
      if (track.samplesLeft > 0) continue;

      track.eventIndex++;
      if (track.eventIndex >= track.events.length) {
        if (this.song.loop) {
          track.eventIndex = 0;
        } else {
          track.active = false;
          this.stopVoiceAutomation(track.voice);
          const v = this.voices[track.voice]!;
          if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
          continue;
        }
      }

      this.triggerSongEvent(track);
    }

    if (!anyActive || this.song.tracks.every((track) => !track.active)) {
      this.song = null;
    }
  }

  private startVoice(
    voice: number,
    waveform: number,
    freqHz: number,
    pw: number,
    sr: number,
    retrigger: boolean,
  ): void {
    const v = this.voices[voice]!;
    const wasOff = v.waveform === WAVE_OFF;
    v.waveform = waveform;
    v.phaseStep = freqToStep(freqHz, sr);
    v.pulseWidth = (pw & 0xFF) / 255;
    if (waveform === WAVE_OFF) {
      if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
      return;
    }
    if (retrigger || wasOff || v.envState === ENV_OFF || v.envState === ENV_RELEASE) {
      v.phase = 0;
      v.envState = ENV_ATTACK;
      v.envLevel = 0;
      if (waveform === WAVE_NOISE) {
        v.lfsr = 0x7FFF;
        v.lfsrOut = 0;
      }
    }
  }

  private applySfxStep(eng: SfxEngine, step: EffectStep): void {
    const v = this.voices[eng.voice]!;
    const wasOff = v.waveform === WAVE_OFF;
    v.waveform = step.waveform;
    if (step.waveform === WAVE_OFF) {
      v.envState = ENV_OFF;
      v.envLevel = 0;
    } else {
      const freqHz = eng.relativePitch
        ? eng.basePitch * Math.pow(2, step.freqValue / 1200)
        : step.freqValue;
      v.phaseStep = freqToStep(freqHz, sampleRate);
      if (step.pulseWidth !== 0xff) {
        v.pulseWidth = step.pulseWidth / 255;
      }
      if (step.volume !== 0xff) {
        v.envLevel = step.volume / 255;
        v.sustain = v.envLevel;
      }
      v.envState = ENV_SUSTAIN;
      if (wasOff) {
        v.phase = 0;
        if (step.waveform === WAVE_NOISE) {
          v.lfsr = 0x7FFF;
          v.lfsrOut = 0;
        }
      }
    }
    if (step.filterCutoff > 0) {
      const f = this.voiceFilters[eng.voice]!;
      setFilterParams(f, step.filterCutoff, f.resonanceParam, f.mode);
    }
  }

  private applyDrive(sample: number, amount: number): number {
    if (amount <= 0) return sample;
    const gain = 1 + amount * 3;
    const x = sample * gain;
    return x / (1 + Math.abs(x) * 0.75);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]![0]!;
    const len = output.length;

    for (let i = 0; i < len; i++) {
      this.advanceSong();

      // TONE auto note-off
      if (this.tone.active) {
        this.tone.samplesLeft--;
        if (this.tone.samplesLeft <= 0) {
          this.tone.active = false;
          const v = this.voices[this.tone.voice]!;
          if (v.envState !== ENV_OFF) v.envState = ENV_RELEASE;
        }
      }

      // SFX step advancement (one engine per voice)
      for (let si = 0; si < 6; si++) {
        const eng = this.sfx[si]!;
        if (!eng.active) continue;
        eng.sampleCounter++;
        const nextIdx = eng.stepIndex + 1;
        if (nextIdx < eng.steps.length) {
          const nextStep = eng.steps[nextIdx]!;
          if (eng.sampleCounter >= nextStep.delaySamples) {
            eng.sampleCounter = 0;
            eng.stepIndex = nextIdx;
            this.applySfxStep(eng, nextStep);
            if (nextStep.waveform === WAVE_OFF) {
              eng.active = false;
            }
          }
        }
        if (eng.relativePitch && eng.vibratoDepth !== 0) {
          const v = this.voices[eng.voice]!;
          if (v.waveform !== WAVE_OFF && eng.stepIndex < eng.steps.length) {
            const step = eng.steps[eng.stepIndex]!;
            const cents = step.freqValue + triangleLfo(eng.vibratoPhase) * eng.vibratoDepth;
            const freqHz = eng.basePitch * Math.pow(2, cents / 1200);
            v.phaseStep = freqToStep(freqHz, sampleRate);
          }
          eng.vibratoPhase += eng.vibratoStep;
          if (eng.vibratoPhase >= 1) eng.vibratoPhase -= 1;
        }
      }

      // Mix voices
      let mixed = 0;
      for (let vi = 0; vi < 6; vi++) {
        const v = this.voices[vi]!;
        if (v.waveform === WAVE_OFF && v.envState === ENV_OFF) continue;

        const osc = oscillate(v);
        const env = advanceEnvelope(v);
        advancePhase(v);
        const sample = osc * env;
        const filtered = applyFilter(this.voiceFilters[vi]!, sample);
        mixed += this.applyDrive(filtered, this.voiceDrive[vi]!);
      }
      mixed = applyFilter(this.masterFilter, mixed);

      // Master volume and clamp
      mixed = mixed * this.masterVolume * 0.167;
      output[i] = Math.max(-1, Math.min(1, mixed));
    }

    return true;
  }
}

registerProcessor("synth-processor", SynthProcessor);
