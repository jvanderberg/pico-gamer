# Audio Design

This document describes the current audio implementation in the repo. It supersedes the older PWM DAC, routed global filter, and `SYS_MUSIC` tracker plans.

## Overview

Pico-Gamer now uses one synth model across the web emulator and device firmware:

- 6 synth voices
- pulse, saw, triangle, and noise oscillators
- per-voice ADSR envelopes
- per-voice filters
- per-voice drive
- one master filter on the summed mix
- built-in SFX presets plus custom `EFFECT` data from VM memory
- `NOTE` for pitched instruments and `SFX` for absolute-pitch effects
- `SONG` / `TRACK` data for simple sequenced playback
- `MPLAY` / `MSTOP` for song transport

There are currently two firmware consumers:

- `firmware/vm-runner`
  - the actual VM game runner
  - default device sample rate: `22050 Hz`
- `firmware/audio-proto`
  - standalone synth test harness
  - often used at `44100 Hz`

## Output Path

### Device

The firmware audio path is I2S, not PWM.

- transport: Arduino-Pico `I2S`
- output format: stereo `16-bit`, with the same mono sample written to both channels
- default pins:
  - `GPIO16` = `BCLK`
  - `GPIO17` = `LRCLK/WS`
  - `GPIO18` = `DOUT`
- expected amp board: MAX98357A-style I2S mono amplifier

### Web

The web build renders through an `AudioWorklet`. It uses the same command model and effect data layout as the device path, but runs with browser sample rate and floating-point DSP.

## Synth Topology

Each voice has:

- oscillator
- ADSR envelope
- optional effect/note automation state
- local filter
- local drive

The full path is:

```text
voice oscillator -> ADSR -> voice filter -> voice drive -> mix
mix -> master filter -> master volume -> output
```

There is no filter routing mask anymore. Every voice owns its own filter, and the master filter always processes the summed mix.

## Voice Model

### Waveforms

| ID | Constant | Meaning |
|---|---|---|
| `0` | `OFF` / `WAVE_OFF` | silence |
| `1` | `WAVE_PULSE` | pulse wave with variable width |
| `2` | `WAVE_SAW` | sawtooth |
| `3` | `WAVE_TRI` | triangle |
| `4` | `WAVE_NOISE` | LFSR noise |

### Envelope

Each voice has a standard ADSR envelope:

- attack
- decay
- sustain
- release

`VOICE` is the low-level oscillator command. `NOTE` is the musical trigger command. `NOTE` retriggers the voice intentionally so instruments behave like notes instead of free-running drones.

## Filters

The synth supports the same filter modes on both voice-local filters and the master filter.

| Constant | Meaning |
|---|---|
| `FILTER_LP` | low-pass |
| `FILTER_BP` | band-pass |
| `FILTER_HP` | high-pass |
| `FILTER_NOTCH` | notch |
| `FILTER_COMB` | comb / short feedback delay |

### Normal Filter Modes

For `LP`, `BP`, `HP`, and `NOTCH`:

- `cutoff` controls the filter frequency
- `resonance` controls emphasis around the cutoff

### Comb Mode

`FILTER_COMB` uses different semantics:

- `cutoff` maps to delay length
  - lower values = longer, more hollow ringing
  - higher values = shorter, more metallic resonance
- `resonance` maps to feedback amount

## Drive

The current implementation has per-voice drive only:

- `VDRIVE voice, amount`

There is no separate master `DRIVE` command yet.

## Runtime Commands

The VM/audio command range is `0x30-0x3B`.

| ID | BASIC | Meaning |
|---|---|---|
| `0x30` | `VOICE voice, waveform, freq_hz, pulse_width` | low-level voice control |
| `0x31` | `ENVELOPE voice, attack, decay, sustain, release` | ADSR for one voice |
| `0x32` | `NOTEOFF voice` | release one voice |
| `0x33` | `FILTER cutoff, resonance, mode` | master filter |
| `0x34` | `VOLUME level` | master volume |
| `0x35` | `TONE voice, freq_hz, duration_ms` | convenience tone |
| `0x36` | `SFX effect_or_preset, voice` | play built-in or custom effect |
| `0x37` | `VFILTER voice, cutoff, resonance, mode` | voice-local filter |
| `0x38` | `NOTE effect, voice, pitch[, vib_rate64, vib_depth]` | play a custom instrument at pitch |
| `0x39` | `VDRIVE voice, amount` | per-voice drive |
| `0x3A` | `MPLAY song` | start a compiled song |
| `0x3B` | `MSTOP` | stop the active song |

## BASIC Audio Model

There are two layers:

- direct synth control
  - `VOICE`, `ENVELOPE`, `NOTEOFF`, `VFILTER`, `VDRIVE`, `FILTER`, `VOLUME`, `TONE`
- data-driven playback
  - `EFFECT`, `STEP`, `SFX`, `NOTE`, `SONG`, `TRACK`, `MPLAY`, `MSTOP`

### Direct Control Example

```basic
ENVELOPE 0, 8, 32, 180, 48
VFILTER 0, 96, 40, FILTER_LP
VDRIVE 0, 72
FILTER 220, 12, FILTER_LP
VOICE 0, WAVE_PULSE, 220, 96
```

### Custom Effect Definition

```basic
EFFECT lead
  STEP 0,   WAVE_PULSE, 0, 92, 255, 0
  STEP 20,  WAVE_PULSE, 0, 92, 200, 0
  STEP 70,  WAVE_PULSE, 0, 92, 176, 0
  STEP 170, OFF
END EFFECT
```

### Step Syntax

Full form:

```basic
STEP delay_ms, waveform, freq_or_cents, pulse_width, volume, filter_cutoff
```

Short form:

```basic
STEP delay_ms, OFF
```

Field meaning:

- `delay_ms`
  - time since the previous step
- `waveform`
  - one of the waveform constants, or `OFF`
- `freq_or_cents`
  - for `SFX`: absolute frequency in Hz
  - for `NOTE`: signed cents offset from the played pitch
- `pulse_width`
  - `0..255`
  - `255` means keep the current pulse width
- `volume`
  - `0..255`
  - `255` means keep the current volume
- `filter_cutoff`
  - `0..255`
  - `0` means do not change the voice-local filter cutoff

Effect step values are compile-time constants. The compiler resolves note names, waveform constants, filter mode constants, and integer expressions when it emits the effect data.

### Binary Format

Custom effects compile to bytes in VM memory.

Layout:

- byte `0`
  - step count
- then `N` step records, 8 bytes each:
  - bytes `0-1`
    - `delay_ms` as little-endian `u16`
  - byte `2`
    - waveform
  - bytes `3-4`
    - `freq_or_cents` as little-endian `i16`
  - byte `5`
    - pulse width
  - byte `6`
    - volume
  - byte `7`
    - filter cutoff

The runtime reads this same layout on both web and device.

## NOTE

`NOTE` plays a custom effect as a pitched instrument:

```basic
NOTE lead, 1, C4
NOTE lead, 1, C4, 320, 8
```

Arguments:

- `effect`
  - effect label compiled by `EFFECT`
- `voice`
  - `0..5`
- `pitch`
  - MIDI note number
  - BASIC provides constants like `C4`, `DS4`, `GS1`, `A2`
- optional `vib_rate64`
  - vibrato rate in `1/64 Hz`
- optional `vib_depth`
  - vibrato depth in cents

In `NOTE` mode, step pitch is relative. A step frequency of `0` means "play exactly at the requested pitch." Positive and negative values shift the note in cents.

## SFX

`SFX` plays an effect in absolute-frequency mode:

```basic
SFX zap, 3
SFX SFX_COIN, 3
```

The first argument can be:

- a custom `EFFECT` label
- a built-in preset constant

### Built-in Presets

The built-in preset table still ships for convenience:

| Constant | ID |
|---|---|
| `SFX_LASER` | `0` |
| `SFX_EXPLODE` | `1` |
| `SFX_PICKUP` | `2` |
| `SFX_JUMP` | `3` |
| `SFX_HIT` | `4` |
| `SFX_BOUNCE` | `5` |
| `SFX_POWERUP` | `6` |
| `SFX_DEATH` | `7` |
| `SFX_COIN` | `8` |
| `SFX_BEEP` | `9` |
| `SFX_THUD` | `10` |
| `SFX_ZAP` | `11` |
| `SFX_ALARM` | `12` |
| `SFX_CLICK` | `13` |
| `SFX_WHOOSH` | `14` |
| `SFX_BLIP` | `15` |

Preset IDs below `16` are treated as built-ins. Custom effects are compiled into VM memory and passed by address.

## SONG / TRACK / MPLAY

The current runtime includes a simple song sequencer on top of `EFFECT` and `NOTE`.

BASIC syntax:

```basic
SONG spacey, 92, 1
  TRACK 0, bass, 0,   0, "C2:8 R:4 GS1:8 R:4"
  TRACK 1, lead, 320, 8, "R:8 C4:4 DS4:4 G4:8"
END SONG

MPLAY spacey
MSTOP
```

Song fields:

- `SONG name, bpm, loop`
- `bpm` is stored as `u8`; the runtime clamps values below `1` up to `1`
- `loop` is boolean-like: `0` stops at the end, nonzero loops
- each `TRACK` is `TRACK voice, effect, vibratoRate64, vibratoDepth, pattern`
- `voice` is `0..5`
- `effect` must reference a custom `EFFECT`
- `vibratoRate64` is in `1/64 Hz`
- `vibratoDepth` is in cents
- `pattern` must be a string literal

Pattern token format:

- notes: `C4:4`, `DS4:2`, `F2:8`
- rests: `R:4` or `-:4`
- separators: spaces or commas
- accidentals: `#` or `S`
- octave range: `0..8`
- duration range: `1..255`

Timing:

- one duration unit is one quarter of a beat
- `4` duration units equals one beat at the song BPM
- track vibrato settings are applied to every note event in that track

Transport behavior:

- `MPLAY` stops any currently playing song, then starts the new song from the beginning
- `MSTOP` stops the active song and releases its voices

### Song Binary Format

Songs compile to VM memory in this layout:

- byte `0`
  - track count
- byte `1`
  - BPM
- byte `2`
  - loop flag
- then one track record per track, 9 bytes each:
  - byte `0`
    - voice
  - bytes `1-2`
    - effect address
  - bytes `3-4`
    - vibrato rate in `1/64 Hz`
  - bytes `5-6`
    - vibrato depth in cents
  - bytes `7-8`
    - event-list address
- each event list is:
  - bytes `0-1`
    - event count as little-endian `u16`
  - then `N` 2-byte events:
    - byte `0`
      - pitch (`0xFF` means rest)
    - byte `1`
      - duration

## Music Today

The intended layering is:

- `EFFECT` defines instrument shape over time
- `NOTE` plays that shape at pitch
- `SONG` / `TRACK` provides a compact built-in sequencer format for scheduled note playback

If a dedicated music API is added later, it should sit on top of `EFFECT` and `NOTE`, not introduce a second unrelated engine.

## Web and Device Parity

The command model is shared:

- same syscall IDs
- same effect byte layout
- same built-in preset IDs
- same filter modes
- same `NOTE` vibrato arguments

Implementation details differ:

- web uses floating-point DSP in an `AudioWorklet`
- firmware uses integer/fixed-point style DSP and I2S output

But game-facing behavior should match closely.

## Current Limits

The current implementation does not provide:

- `SYS_MUSIC`
- BASIC `MUSIC ...` syntax
- routed global filters
- per-step resonance changes
- per-step filter mode changes
- per-step drive changes
- master drive

Those older plan branches were removed from this document on purpose so the docs match the code that actually ships.
