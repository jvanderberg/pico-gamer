# Audio Design — Sound Effects & Music

## Overview

The audio system is a SID-inspired 6-voice synthesizer that runs identically on both targets:

- **Pico**: Core 1 renders samples into PWM DAC (default 22kHz, configurable up to 44.1kHz)
- **Web**: `AudioWorklet` renders samples at 44.1kHz via Web Audio API

Sample rate is a compile-time constant, not hardcoded. Default is 22kHz — sufficient for chiptune synthesis where waveform content is naturally band-limited. 44.1kHz is available for setups with a PAM8403 amplifier and speaker where the extra bandwidth benefits noise textures and filter sweeps. At 22kHz the synth uses ~15% CPU for 6 voices; at 44.1kHz it uses ~30%.

Same synth model, same binary data formats, same syscall interface. Sound effects and music share the same engine — effects are short synth patches, music is a sequenced pattern.

## Synthesizer Architecture

### Per Voice (x6)

| Component | Description |
|---|---|
| **Oscillator** | Phase accumulator with selectable waveform: sawtooth, triangle, pulse (variable width), noise (LFSR) |
| **Frequency** | 16-bit phase step. `step = freq_hz * 65536 / sample_rate` |
| **ADSR Envelope** | Four-state machine: attack (ramp up), decay (ramp to sustain), sustain (hold), release (ramp to zero). 8-bit parameters, 16-bit internal level |

### Global

| Component | Description |
|---|---|
| **Filter** | 2-pole state-variable filter (LP/BP/HP). Per-voice routing bits select which voices pass through the filter |
| **Mixer** | Sum voices (filtered + unfiltered), apply master volume, clamp to output range |

### Waveform IDs

```
0 = OFF       (silence)
1 = PULSE     (variable duty cycle via pulse width)
2 = SAWTOOTH  (bright, harmonics-rich)
3 = TRIANGLE  (mellow, odd harmonics only)
4 = NOISE     (LFSR pseudo-random, for percussion/effects)
```

## Syscall Interface

All audio syscalls live in the `0x30-0x3F` range. These are the VM syscall IDs — the BIOS jump table has its own offsets for native games but maps to the same functions.

### Voice Control

#### `SYS_VOICE` (0x30) — Set voice oscillator

```
Stack: [voice, waveform, freq_hz, pulse_width]
       voice:       0-5
       waveform:    0-4 (see waveform IDs)
       freq_hz:     frequency in Hz (16-bit, 0-65535)
       pulse_width: 0-255 duty cycle (128 = 50% square wave)
```

Setting `waveform = 0` silences the voice. Setting a new waveform restarts the oscillator phase.

#### `SYS_ENVELOPE` (0x31) — Set voice ADSR envelope

```
Stack: [voice, attack, decay, sustain, release]
       voice:   0-5
       attack:  0-255 (0 = instant, 255 = ~2s ramp up)
       decay:   0-255 (0 = instant, 255 = ~2s ramp down to sustain)
       sustain: 0-255 (sustain amplitude level, 255 = full)
       release: 0-255 (0 = instant cut, 255 = ~2s fade after note-off)
```

The envelope starts (gate on) when `SYS_VOICE` sets a non-zero waveform. It enters release (gate off) when waveform is set to 0 or via `SYS_NOTE_OFF`.

#### `SYS_NOTE_OFF` (0x32) — Release a voice

```
Stack: [voice]
       voice: 0-5
```

Triggers the release phase of the envelope without changing the oscillator. The voice fades according to its release parameter and then goes silent.

### Filter

#### `SYS_FILTER` (0x33) — Set global filter

```
Stack: [cutoff, resonance, mode, routing]
       cutoff:    0-255 (maps to filter frequency, 0 = low, 255 = high)
       resonance: 0-255 (0 = flat, 255 = sharp peak at cutoff)
       mode:      0 = low-pass, 1 = band-pass, 2 = high-pass
       routing:   bit mask — bits 0-5 route voices 0-5 through filter
                  unrouted voices bypass the filter
```

#### `SYS_VOLUME` (0x34) — Master volume

```
Stack: [volume]
       volume: 0-255 (0 = mute, 255 = full)
```

### Convenience

#### `SYS_TONE` (0x35) — Simple beep

```
Stack: [voice, freq_hz, duration_ms]
       voice: 0-5
```

Plays a pulse wave on the specified voice with a fast decay envelope for the given duration. Intended for simple UI feedback. Overrides the current state of the chosen voice.

### Sound Effects

#### `SYS_SFX` (0x36) — Play a preset effect

```
Stack: [effect_id, voice]
       effect_id: 0-31
       voice:     0-5
```

Plays a built-in sound effect on the specified voice. The effect is a pre-baked sequence of synth parameter changes executed by the audio thread with sample-accurate timing. The game author controls which voice is used, avoiding contention with direct VOICE calls or TONE.

##### Built-in Effect Presets

| ID | Name | Description |
|---|---|---|
| 0 | `LASER` | Pulse wave, fast pitch sweep down (1000Hz → 200Hz) |
| 1 | `EXPLODE` | Noise, fast attack, long decay, filter sweep down |
| 2 | `PICKUP` | Triangle, fast rising arpeggio (C5→E5→G5→C6) |
| 3 | `JUMP` | Triangle, quick pitch rise (200Hz → 600Hz) |
| 4 | `HIT` | Noise burst, very short decay |
| 5 | `BOUNCE` | Pulse, short pitch dip and return |
| 6 | `POWERUP` | Saw, slow rising sweep with resonant filter |
| 7 | `DEATH` | Noise + pulse, descending pitch, long release |
| 8 | `COIN` | Pulse, two quick high notes (E6→B6) |
| 9 | `BEEP` | Pulse, single short tone |
| 10 | `THUD` | Noise, low-pass filtered, very short |
| 11 | `ZAP` | Saw, resonant filter sweep, fast decay |
| 12 | `ALARM` | Pulse, alternating two tones |
| 13 | `CLICK` | Noise, 1ms burst |
| 14 | `WHOOSH` | Noise, band-pass filter sweep up |
| 15 | `BLIP` | Triangle, quick pitch down (800Hz → 400Hz) |

### Music Sequencer

#### `SYS_MUSIC` (0x37) — Load and control music

```
Stack: [command, ...]
       command 0 = LOAD:  [0, voice, addr, len]   — load pattern data for a voice
       command 1 = PLAY:  [1, tempo]               — start playback at given tempo
       command 2 = STOP:  [2]                      — stop playback, silence voices
       command 3 = LOOP:  [3, enabled]             — set loop mode (0 = once, 1 = loop)
```

**Tempo** is in ticks per second. At 8 ticks/sec with the default tick duration of 1, eighth notes at 120 BPM. Typical range: 4-16 ticks/sec.

The sequencer runs on the audio thread (AudioWorklet / Core 1) and is completely decoupled from the game loop. Once loaded and started, music plays autonomously with sample-accurate timing.

## Music Pattern Format

Music data is a flat byte array per voice, loaded into audio-thread memory via `SYS_MUSIC(LOAD, ...)`. The game stores this data in VM memory; the syscall copies it to the audio side.

### Entry Format (4 bytes per note)

```
Byte 0: note       — MIDI note number (0-127), or 0xFF = rest, 0xFE = note-off
Byte 1: waveform   — waveform ID (1-4), ignored for rest/note-off
Byte 2: duration   — length in ticks (1-255)
Byte 3: volume     — note velocity (0-255), ignored for rest/note-off
```

### MIDI Note Reference

```
C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71
Octave up = +12, octave down = -12
Sharps: C#4 = 61, D#4 = 63, F#4 = 66, G#4 = 68, A#4 = 70
```

MIDI-to-frequency conversion: `freq = 440 * 2^((note - 69) / 12)`

This conversion runs on the audio thread when a note triggers.

### Example: Voice 0 playing C major scale

```
60 01 02 200    C4,  pulse, 2 ticks, vol 200
62 01 02 200    D4,  pulse, 2 ticks, vol 200
64 01 02 200    E4,  pulse, 2 ticks, vol 200
65 01 02 200    F4,  pulse, 2 ticks, vol 200
67 01 02 200    G4,  pulse, 2 ticks, vol 200
69 01 02 200    A4,  pulse, 2 ticks, vol 200
71 01 02 200    B4,  pulse, 2 ticks, vol 200
72 01 04 200    C5,  pulse, 4 ticks, vol 200
```

## BASIC Language Bindings

### Direct Voice Control

```basic
VOICE voice, waveform, freq, pulse_width
ENVELOPE voice, attack, decay, sustain, release
NOTEOFF voice
FILTER cutoff, resonance, mode, routing
VOLUME level
```

### Convenience

```basic
TONE voice, freq, duration
SFX effect_id, voice
```

### Music — String Notation

```basic
MUSIC voice, "note_string"
MUSIC PLAY tempo
MUSIC STOP
MUSIC LOOP on_off
```

The **BASIC compiler** parses the note string at compile time and emits the binary pattern format. The VM never sees strings — only the 4-byte-per-note binary data.

#### Note String Syntax

```
note     = letter [accidental] [octave] [dots]
letter   = C D E F G A B
accidental = # (sharp) or b (flat)
octave   = 1-7 (default: 4)
dots     = . (each dot doubles the duration)
rest     = R or -
note-off = ^

duration = set by tempo and ticks:
  bare note   = 1 tick
  note.       = 2 ticks
  note..      = 4 ticks
  note...     = 8 ticks
```

#### Modifiers (inline in the string)

```
W1-W4    set waveform (1=pulse, 2=saw, 3=triangle, 4=noise)
V0-V255  set volume
O1-O7    set octave (persists until changed)
```

#### Examples

```basic
' Simple melody — pulse wave, default octave 4
MUSIC 0, "W1 C. D. E. F. G.. C5.."

' Bass line — triangle wave, octave 2
MUSIC 1, "W3 O2 C.. G.. A.. E.."

' Drum pattern — noise
MUSIC 2, "W4 V255 C C R C C R C. R"

' Start playback at 8 ticks/sec
MUSIC PLAY 8
```

#### Compiler Output

The compiler converts `"W1 C. D. E."` into:

```
; waveform = 1 (pulse), volume = 200 (default)
60 01 02 200    ; C4, pulse, 2 ticks
62 01 02 200    ; D4, pulse, 2 ticks
64 01 02 200    ; E4, pulse, 2 ticks
```

This binary blob is embedded in the game's data section. At runtime, the VM pushes the address and length and calls `SYS_MUSIC(LOAD, ...)`.

## SFX Preset Definition

Each SFX preset is a sequence of timed synth commands. The format is the same on both platforms — a table of presets compiled into the audio engine.

### Preset Entry Format

```
struct SfxStep {
    uint16_t delay_samples;   // samples to wait before this step
    uint8_t  waveform;
    uint16_t freq_hz;
    uint8_t  pulse_width;
    uint8_t  volume;
    uint8_t  filter_cutoff;   // 0 = don't change filter
};
```

A preset is an array of steps terminated by a zero-delay entry with waveform 0. The audio thread walks the steps, applying each one when its delay expires.

### Example: Laser (preset 0)

```
delay   wave  freq   pw   vol  filter
0       1     1000   128  255  0        // start: pulse at 1000Hz
200     1     800    128  255  0        // ~9ms later: sweep to 800
200     1     600    128  200  0
200     1     400    128  150  0
200     1     200    128  80   0
100     0     0      0    0    0        // end: silence
```

## Web Implementation (AudioWorklet)

### Architecture

```
Main thread                          AudioWorklet thread
───────────                          ──────────────────
VM runs, hits audio syscall          SynthProcessor.process()
  │                                     │
  ├─ SYS_VOICE/ENVELOPE/etc.           ├─ reads shared state
  │    │                                ├─ runs oscillators
  │    └─ post message to worklet       ├─ applies envelopes
  │                                     ├─ runs filter
  ├─ SYS_MUSIC(LOAD)                   ├─ steps sequencer (tick counter)
  │    │                                ├─ steps SFX preset
  │    └─ transfer pattern data         └─ writes 128 samples to output
  │
  ├─ SYS_SFX                           Sequencer:
  │    └─ post effect_id                  sample_counter += 1
  │                                       if sample_counter >= samples_per_tick:
  └─ SYS_MUSIC(PLAY/STOP)                  advance to next note entry
       └─ post command                      set voice params from entry
```

### Key Implementation Notes

- Use `MessagePort` for main thread → worklet communication
- Pre-allocate all synth state (no GC pressure in the audio callback)
- `SharedArrayBuffer` is an option for lower-latency param updates but `MessagePort` is simpler and sufficient
- Sample rate is 44.1kHz (browser default); Pico defaults to 22kHz (configurable) — same math, different rate constant
- MIDI-to-frequency: `freq = 440 * Math.pow(2, (note - 69) / 12)`

### Files

```
web/src/audio/
  synth-processor.ts    — AudioWorklet processor (runs on audio thread)
  synth-worklet.ts      — worklet registration + message handling
  audio-manager.ts      — main-thread API: init, syscall dispatch, pattern loading
  sfx-presets.ts        — SFX preset table (shared data)
```

## Pico Implementation (Core 1)

### Architecture

```
Core 0 (game)                        Core 1 (audio)
─────────────                        ──────────────
VM hits audio syscall                Timer ISR @ SAMPLE_RATE
  │                                     │
  └─ write to shared synth state        ├─ read voice state
     (lock-free, volatile)              ├─ run oscillators
                                        ├─ apply envelopes
                                        ├─ run filter
                                        ├─ step sequencer
                                        ├─ step SFX
                                        └─ write PWM duty
```

### Shared State

Core 0 writes synth parameters; Core 1 reads them. No mutex needed if writes are atomic at the word level (they are on ARM Cortex-M0+). Use `volatile` on shared state.

### Files

```
vm/lib/pico_vm/
  synth.h           — synth state structs, shared between cores
  synth.cpp         — oscillators, ADSR, filter, mixer, sequencer
  sfx_presets.cpp   — SFX preset table
```

Firmware `main.cpp` initializes Core 1 with the synth loop. Syscall handler in `syscalls.cpp` writes to the shared synth state.

## Planned: Unified EFFECT System & SID Parity

### Motivation

The current system has two separate mechanisms — hardcoded SFX presets and a tick-based music sequencer — that are really the same thing: a timed sequence of synth parameter changes. Unifying them into a single **EFFECT** format gives game authors full control over both sound effects and instrument voices with one concept.

The key insight: an "instrument" is just an effect where frequency is left as a parameter. A `PULSE, 1000Hz, vol=255` step is a sound effect. A `PULSE, ?, vol=255` step is an instrument — the `?` gets filled in when you play a note.

### Unified EFFECT Format

An EFFECT is an array of steps stored in game memory. Each step is 8 bytes:

```
Byte 0-1:  delay (ms, little-endian u16) — time since previous step
Byte 2:    waveform (0=OFF, 1=PULSE, 2=SAW, 3=TRI, 4=NOISE)
Byte 3-4:  freq/cents (i16) — interpretation depends on trigger mode
Byte 5:    pulse width (0-255, 0xFF = no change)
Byte 6:    volume (0-255, 0xFF = no change)
Byte 7:    filter cutoff (0-255, 0 = no change)
```

First byte before the steps is the step count. Total size: `1 + N*8` bytes.

A `0xFF` sentinel in pulse width or volume means "keep the current value." This lets instrument steps change only pitch without touching timbre.

### Two Entry Points, One Engine

**`SFX effect, voice`** — plays the effect verbatim. The freq field in each step is an absolute frequency in Hz. Use this for sound effects where every parameter is baked in.

**`NOTE effect, voice, pitch`** — plays the effect with frequency overridden. The freq field in each step is a **signed offset in cents** (hundredths of a semitone) from the caller's pitch. The engine computes:

```
freq = basePitch * 2^(cents / 1200)
```

This makes modulation (vibrato, pitch bends) proportional — ±20 cents sounds the same whether you play C2 or C6, which matches how real vibrato works. A step with `cents = 0` plays the note on-pitch.

### BASIC Syntax

#### Sound Effects (absolute frequencies)

```basic
EFFECT laser
  STEP 0,   PULSE, 1000, 128, 255, 0
  STEP 5,   PULSE, 800,  128, 255, 0
  STEP 10,  PULSE, 600,  128, 200, 0
  STEP 15,  PULSE, 400,  128, 150, 0
  STEP 20,  PULSE, 200,  128, 80,  0
  STEP 23,  OFF
END EFFECT

SFX laser, 2              ' play verbatim on voice 2
```

#### Instruments (frequency from caller, with vibrato)

```basic
EFFECT piano
  STEP 0,   PULSE, +0,  100, 255, 0     ' attack, on pitch
  STEP 10,  PULSE, +0,  100, 180, 0     ' decay to sustain
  STEP 300, OFF                           ' auto release after 300ms
END EFFECT

EFFECT vibrato_lead
  STEP 0,   SAW, +0,   0, 255, 0        ' on pitch
  STEP 10,  SAW, +0,   0, 200, 0        ' decay
  STEP 100, SAW, +20,  0, 200, 0        ' +20 cents (vibrato up)
  STEP 120, SAW, -20,  0, 200, 0        ' -20 cents (vibrato down)
  STEP 140, SAW, +20,  0, 200, 0        ' cycle continues...
  STEP 160, SAW, -20,  0, 200, 0
  STEP 180, OFF
END EFFECT

NOTE piano, 0, C4         ' voice 0 plays C4 with piano envelope
NOTE piano, 0, E4         ' same shape, different pitch
NOTE vibrato_lead, 1, A4  ' voice 1 plays A4 with vibrato wobble
```

#### Music (multiple voices, simultaneous)

```basic
EFFECT melody
  STEP 0,   PULSE, +0,   100, 220, 0
  STEP 250, PULSE, +0,   100, 220, 0    ' each STEP with cents=0
  STEP 500, PULSE, +0,   100, 220, 0    ' just retriggers at new pitch
  STEP 750, OFF
END EFFECT

EFFECT bass
  STEP 0,   SAW, +0, 0, 200, 80
  STEP 500, SAW, +0, 0, 200, 80
  STEP 1000, OFF
END EFFECT

' Play a phrase — NOTE sequences could be driven by a
' higher-level MUSIC command or game loop:
NOTE melody, 0, C4 : NOTE bass, 1, C2
' ... 250ms later ...
NOTE melody, 0, E4
' ... 250ms later ...
NOTE melody, 0, G4 : NOTE bass, 1, G2
```

### Engine Changes

The SFX engine in `synth-processor.ts` / `synth.cpp` already executes step arrays with sample-accurate timing. The changes are:

1. **Read steps from game memory** instead of the hardcoded preset table
2. **Add `NOTE` syscall** (`SYS_NOTE`, 0x38) that stores a base pitch and switches the freq field to cents interpretation
3. **Cents-to-Hz conversion** in `applySfxStep`: `freq = basePitch * 2^(step.cents / 1200)`
4. **No-change sentinels** (0xFF): skip updating fields that shouldn't change
5. **Retrigger envelope** on `NOTE`: reset to ATTACK state so each note gets a fresh envelope shape

The 16 built-in SFX presets can be shipped as pre-defined EFFECT blocks in a standard library or dropped entirely.

### Planned: SID Parity Features

Comparison with the MOS 6581 SID chip:

| Feature | SID 6581 | Pico-Gamer (current) | Status |
|---|---|---|---|
| Voices | 3 | 6 | Exceeds |
| Waveforms | Pulse, Saw, Tri, Noise | Pulse, Saw, Tri, Noise | Parity |
| Pulse width mod | Per-voice, 12-bit | Per-voice, 8-bit | Parity |
| ADSR envelope | Per-voice, 4-bit params | Per-voice, 8-bit params | Exceeds |
| Filter | 12dB/oct LP/BP/HP, routing, resonance | 12dB/oct LP/BP/HP, routing, resonance | Parity |
| Master volume | 4-bit (16 steps) | 8-bit (256 steps) | Exceeds |
| Ring modulation | Voice pairs | — | **Planned** |
| Oscillator sync | Voice pairs | — | **Planned** |
| Combined waveforms | Bitwise AND of waveform outputs | — | **Planned** |

#### Ring Modulation

Multiplies the output of two oscillators, producing sum-and-difference frequencies for metallic, bell-like, and inharmonic tones.

```basic
RING voice, modulator_voice    ' voice output = voice × modulator
RING 1, 0                      ' voice 1 ring-modulated by voice 0
RING 1, -1                     ' disable ring mod on voice 1
```

Implementation: one multiply in the voice mix loop.

```
if (ringModSource >= 0)
    sample = oscillate(voice) * oscillate(voices[ringModSource])
```

Per-voice state: `ringModSource: i8` (-1 = disabled, 0-5 = source voice).

#### Hard Sync

Forces one oscillator's phase to reset when another completes a cycle. Produces harmonically rich, screaming tones that change character as the slave frequency is swept.

```basic
SYNC voice, master_voice       ' voice phase resets on master cycle
SYNC 2, 1                      ' voice 2 syncs to voice 1
SYNC 2, -1                     ' disable sync on voice 2
```

Implementation: in `advancePhase`, when the master voice's phase wraps past 1.0, reset the slave's phase to 0.

Per-voice state: `syncSource: i8` (-1 = disabled, 0-5 = master voice).

#### Combined Waveforms

The SID could bitwise-AND two waveform outputs together, producing thin, characteristic tones. We approximate this by multiplying two waveform functions.

```basic
WAVEMIX voice, second_waveform   ' output = primary × secondary
WAVEMIX 0, TRIANGLE              ' voice 0: pulse × triangle
WAVEMIX 0, OFF                   ' disable, back to single waveform
```

Implementation: generate both waveforms from the same phase accumulator, multiply the results.

Per-voice state: `secondWaveform: u8` (0 = disabled).

#### Syscalls

```
SYS_RING    (0x39): [voice, modulator]     — set ring modulation source
SYS_SYNC    (0x3A): [voice, master]        — set hard sync source
SYS_WAVEMIX (0x3B): [voice, waveform2]     — set combined waveform
```

#### Cost

3 bytes of additional per-voice state. Ring mod adds one multiply per sample. Sync adds one branch per sample. Combined waveforms add one extra oscillator call per sample. All negligible on both platforms.

## How The Synth Works — Detailed Examples

This section walks through the internals step by step. Understanding these mechanics makes it possible to craft custom effects and instruments.

### Phase Accumulator Oscillator

Every voice has a **phase** value that ramps from 0.0 to 1.0 and wraps around. Each sample, the phase advances by:

```
phaseStep = frequency / sampleRate
phase += phaseStep
if (phase >= 1.0) phase -= 1.0
```

At 22kHz sample rate with a 440Hz tone: `phaseStep = 440/22000 ≈ 0.02`. Phase completes one full cycle every ~50 samples — exactly 440 cycles per second. At 44.1kHz the step is half as large (~0.01) and takes ~100 samples per cycle — same frequency, more samples of resolution.

The current phase value is fed into the selected waveform function:

| Waveform | Formula | Character |
|---|---|---|
| **Pulse** | `phase < dutyCycle ? +1 : -1` | 50% = square wave (hollow), narrow duty = nasal/reedy |
| **Sawtooth** | `phase * 2 - 1` | Bright, all harmonics, good for bass and leads |
| **Triangle** | `phase < 0.5 ? phase*4 - 1 : 3 - phase*4` | Mellow, odd harmonics only, flute-like |
| **Noise** | 16-bit Galois LFSR, clocked once per phase cycle | Unpitched hiss, for percussion and effects |

The noise generator uses a linear-feedback shift register that produces pseudo-random bits. The frequency controls how often the LFSR is clocked — higher frequency = brighter noise, lower = rumbly.

### ADSR Envelope — State Machine

Each voice has an independent envelope that shapes volume over time. It progresses through four states:

```
ATTACK → DECAY → SUSTAIN → RELEASE → OFF

envLevel starts at 0.

ATTACK:   envLevel += attackRate   (each sample)
          when envLevel >= 1.0 → switch to DECAY

DECAY:    envLevel -= decayRate    (each sample)
          when envLevel <= sustainLevel → switch to SUSTAIN

SUSTAIN:  envLevel = sustainLevel  (hold until note-off)

RELEASE:  envLevel -= releaseRate  (each sample)
          when envLevel <= 0 → switch to OFF
```

The 8-bit parameters (0-255) map to per-sample rates. Attack=0 means the rate is so fast it reaches 1.0 in one sample (instant). Attack=255 means the rate is very slow, taking ~2 seconds to ramp up. Larger parameter values = slower transitions.

The final sample output is: `oscillatorOutput * envLevel`

**Gate on** (SYS_VOICE with non-zero waveform): reset envelope to ATTACK, envLevel = 0.

**Gate off** (SYS_NOTE_OFF or waveform=0): switch to RELEASE from wherever the envelope currently is.

**Legato behavior**: calling SYS_VOICE on an already-playing voice with a new frequency does NOT retrigger the envelope. The pitch changes smoothly while the current envelope state continues. This is intentional — it allows pitch slides and legato playing.

### Building Instruments with Direct Syscalls

#### Example: Bass

```basic
' Rich, filtered bass — sawtooth through low-pass filter
ENVELOPE 0, 40, 80, 180, 100
FILTER 100, 150, 0, 1        ' low-pass, route voice 0, moderate resonance
VOICE 0, SAWTOOTH, 110, 0    ' A2, 110Hz
```

What happens sample-by-sample:
1. Envelope ramps up over ~40ms (attack=40)
2. Decays to 180/255 ≈ 70% level over ~80ms
3. Holds at that level while note plays
4. Sawtooth generates all harmonics, but the low-pass filter at cutoff=100 rolls off the highs
5. Resonance=150 adds a slight peak at the cutoff frequency, giving some body
6. On note-off, fades over ~100ms

#### Example: Snappy 8-bit Lead

```basic
' Narrow pulse wave — instant attack, fast decay to moderate sustain
ENVELOPE 1, 0, 20, 220, 30
VOICE 1, PULSE, 523, 80      ' C5, 80/255 ≈ 31% pulse width
```

Why pulse width matters: a 50% duty cycle (128) gives a hollow square wave. At 31% (80), the wave is narrow — fewer even harmonics, producing a reedy, nasal, distinctly 8-bit sound. This is the classic "chiptune lead" timbre.

Legato pitch change:

```basic
' Change pitch without retriggering envelope — smooth transition
VOICE 1, PULSE, 659, 80      ' E5 — same voice, same waveform
```

Because voice 1 is already playing PULSE, only the frequency changes. The envelope continues in its current state (sustain at 220/255). No click, no re-attack.

### SFX Preset Walkthroughs

The built-in presets are step arrays executed by the audio thread. Here's exactly what happens inside two of them.

#### LASER (Preset 0) — Pitch Sweep

```
Time    Waveform   Freq    PW    Vol   Filter
0ms     PULSE      1000    128   255   —
5ms     PULSE      800     128   255   —
10ms    PULSE      600     128   200   —
15ms    PULSE      400     128   150   —
20ms    PULSE      200     128   80    —
23ms    OFF        —       —     0     —
```

Step-by-step:
1. **0ms**: Pulse wave fires at 1000Hz, full volume. Instant start — the SFX engine bypasses ADSR and sets `envLevel` directly, forcing the envelope into SUSTAIN state.
2. **5ms later** (~110 samples at 22kHz): Frequency drops to 800Hz. Same waveform, so no phase reset — smooth pitch transition.
3. **10ms**: Down to 600Hz. Volume starts decreasing (200/255).
4. **15ms**: 400Hz, vol 150. The descending pitch creates the "pew" sound.
5. **20ms**: 200Hz, vol 80. Nearly done.
6. **23ms**: Waveform OFF, volume 0. Total duration: 23ms — barely perceptible as a sustained tone, just a quick zap.

The whole effect is over in less than one game frame at 30fps. That's the point — SFX are designed to be fast and punchy.

#### EXPLODE (Preset 1) — Noise Burst with Filter Sweep

```
Time    Waveform   Freq    PW    Vol   Filter
0ms     NOISE      800     —     255   220
5ms     NOISE      600     —     220   180
15ms    NOISE      400     —     180   120
30ms    NOISE      200     —     120   70
60ms    NOISE      100     —     60    30
100ms   OFF        —       —     0     0
```

Step-by-step:
1. **0ms**: Noise generator clocked at 800Hz (bright hiss), full volume. Filter cutoff starts high (220) — lots of high-frequency content passes through.
2. **5ms**: Frequency drops to 600Hz. The LFSR is clocked less often — noise gets slightly darker. Filter cutoff drops to 180, and volume to 220.
3. **15ms**: 400Hz clocking, filter at 120. The explosion is losing its initial brightness.
4. **30ms**: 200Hz, filter at 70. Now it sounds rumbly — the low clock rate produces chunky, granular noise.
5. **60ms**: 100Hz, filter at 30. Very low rumble, barely audible.
6. **100ms**: Silence.

The dual sweep (frequency lowering + filter cutoff dropping) is what sells the explosion. Just lowering volume would sound like noise fading out. The filter sweep makes it sound like the blast is physically moving away from you — high frequencies die first, then lows.

### Mix Pipeline — Per-Sample

Every sample (at the configured sample rate — 22,000/sec default on Pico, 44,100/sec on web), the synth does:

```
For each of the 6 voices:
    sample = oscillate(voice)           // -1.0 to +1.0
    sample = sample * voice.envLevel    // apply envelope (0.0 to 1.0)

    if voice is routed to filter:
        add sample to filteredSum
    else:
        add sample to unfilteredSum

filteredSum = SVF(filteredSum, cutoff, resonance, mode)
    // 2-pole state-variable filter: LP, BP, or HP
    // cutoff controls the frequency point
    // resonance boosts the peak at cutoff (self-oscillates near max)

output = (filteredSum + unfilteredSum) * masterVolume * (1/6)
output = clamp(output, -1.0, +1.0)
```

The `1/6` factor (0.167) prevents clipping when all 6 voices are at full volume. The final clamp is a safety net.

The filter is shared across all routed voices — they get summed first, then filtered together. This is how the SID works too: the filter creates interactions between voices, not just individual filtering.

### Why Cents, Not Hz, For Vibrato

Consider vibrato as a ±10Hz oscillation:
- At **100Hz** (G2): swings between 90-110Hz = ±10% = very wide, almost a trill
- At **2000Hz** (B6): swings between 1990-2010Hz = ±0.5% = barely perceptible

This is wrong. Real vibrato sounds the same at every pitch — a gentle wobble, not a massive pitch bend in the bass and nothing in the treble.

**Cents** (hundredths of a semitone) are proportional to pitch:

```
freq = basePitch * 2^(cents / 1200)

±20 cents at 100Hz: 98.85Hz to 101.16Hz (±1.16%)
±20 cents at 2000Hz: 1976.9Hz to 2023.1Hz (±1.16%)
```

Same perceptual amount of wobble at any pitch. This is how MIDI pitch bend works, how synthesizer LFOs work, and how human vibrato naturally behaves (string players wobble by a consistent interval, not a fixed Hz amount).

### The Unified Concept: Instrument = Effect

An **effect** is a baked-in sequence — every parameter including frequency is specified:

```basic
EFFECT laser
  STEP 0,   PULSE, 1000, 128, 255, 0    ' freq is absolute Hz
  STEP 5,   PULSE, 800,  128, 255, 0
  STEP 10,  PULSE, 600,  128, 200, 0
  ...
END EFFECT

SFX laser, 2    ' play exactly as defined on voice 2
```

An **instrument** is the same thing, but frequency has a hole (`+0` = "use the caller's pitch"):

```basic
EFFECT piano
  STEP 0,   PULSE, +0, 100, 255, 0      ' +0 cents = on pitch
  STEP 10,  PULSE, +0, 100, 180, 0      ' same pitch, volume decays
  STEP 300, OFF
END EFFECT

NOTE piano, 0, C4     ' fills the +0 with C4's frequency (261.63Hz)
NOTE piano, 0, E4     ' same shape, E4's frequency (329.63Hz)
```

There's no separate "instrument" type. An EFFECT with `+0` cents is an instrument. An EFFECT with absolute Hz values is a sound effect. The engine distinguishes them by how they're triggered: `SFX` uses Hz, `NOTE` uses cents.

This means vibrato is just an instrument where the cents values oscillate:

```basic
EFFECT vibrato_lead
  STEP 0,   SAW, +0,   0, 255, 0    ' on pitch
  STEP 100, SAW, +20,  0, 200, 0    ' 20 cents sharp
  STEP 120, SAW, -20,  0, 200, 0    ' 20 cents flat
  STEP 140, SAW, +20,  0, 200, 0    ' oscillates...
  STEP 160, SAW, -20,  0, 200, 0
  STEP 180, OFF
END EFFECT

NOTE vibrato_lead, 1, A4    ' A4 with gentle pitch wobble
```

### Full Multi-Voice Music Example

Three voices playing simultaneously: melody, bass, and hi-hat.

```basic
' Melody instrument — pulse lead with quick decay
EFFECT melody_inst
  STEP 0,   PULSE, +0, 100, 220, 0
  STEP 200, PULSE, +0, 100, 180, 0
  STEP 400, OFF
END EFFECT

' Bass instrument — sawtooth, filtered, longer sustain
EFFECT bass_inst
  STEP 0,   SAW, +0, 0, 200, 80
  STEP 400, SAW, +0, 0, 200, 80
  STEP 800, OFF
END EFFECT

' Hi-hat — noise burst, very short
EFFECT hat
  STEP 0,   NOISE, 8000, 0, 200, 200
  STEP 30,  NOISE, 8000, 0, 80,  120
  STEP 60,  OFF
END EFFECT

' Playing a bar of music from the game loop:
' Beat 1: melody C4 + bass C2 + hat
NOTE melody_inst, 0, C4
NOTE bass_inst, 1, C2
SFX hat, 2

' Beat 2 (250ms later): melody E4 + hat
NOTE melody_inst, 0, E4
SFX hat, 2

' Beat 3 (250ms later): melody G4 + bass G2 + hat
NOTE melody_inst, 0, G4
NOTE bass_inst, 1, G2
SFX hat, 2

' Beat 4 (250ms later): melody C5 + hat
NOTE melody_inst, 0, C5
SFX hat, 2
```

Each `NOTE` call loads the effect step array onto the voice and triggers it with the given pitch. The effect engine handles attack/decay/release timing automatically. The game loop just fires notes at the right moments.

Note that `SFX hat, 2` uses absolute frequencies — the hi-hat's freq (8000Hz) is baked into the effect, not overridden. The noise generator's frequency controls brightness, not pitch, so it makes sense to fix it.

## Design Constraints

- **6 voices** — double the classic SID, still within CPU budget on Pico
- **No sample playback** — everything is synthesized (no PCM buffers to store/stream)
- **4 bytes per note** — compact enough for multi-voice songs in the VM's 32-64KB memory
- **Sequencer on audio thread** — decoupled from frame rate, sample-accurate timing
- **SFX uses caller-specified voice** — game author controls voice allocation, no hidden contention
- **Compile-time string parsing** — no string handling on the audio thread or in the VM
