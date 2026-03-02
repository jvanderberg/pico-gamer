# Audio Design — Sound Effects & Music

## Overview

The audio system is a SID-inspired 6-voice synthesizer that runs identically on both targets:

- **Pico**: Core 1 renders samples at 22kHz into PWM DAC
- **Web**: `AudioWorklet` renders samples at 44.1kHz via Web Audio API

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
- Sample rate is 44.1kHz (browser default); Pico uses 22kHz — same math, different rate constant
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
VM hits audio syscall                Timer ISR @ 22kHz
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

## Design Constraints

- **6 voices** — double the classic SID, still within CPU budget on Pico
- **No sample playback** — everything is synthesized (no PCM buffers to store/stream)
- **4 bytes per note** — compact enough for multi-voice songs in the VM's 32-64KB memory
- **Sequencer on audio thread** — decoupled from frame rate, sample-accurate timing
- **SFX uses caller-specified voice** — game author controls voice allocation, no hidden contention
- **Compile-time string parsing** — no string handling on the audio thread or in the VM
