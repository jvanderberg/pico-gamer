# Pico Gamer — Current Implementation Status

This file replaces the older phase-by-phase prototype plan. That earlier plan described a future Rust/Embassy/PWM architecture that is no longer the codebase reality.

## Implemented

### Core Runtime

- shared C++ VM in `vm/lib/pico_vm`
- BASIC compiler in `web/src/basic`
- assembler and `.game` build path
- WASM build of the VM for the browser

### Device Runner

- RP2040 firmware in `firmware/vm-runner`
- SH1106 display output
- joystick / encoder input handling
- USB mass-storage game loading
- VM audio command drain into the device synth
- I2S audio output for MAX98357A-style boards

### Web Runner

- React/Vite UI
- same VM core compiled to WASM
- `AudioWorklet` synth sink
- same audio command model as hardware

### Audio

- 6-voice synth on web and device
- custom `EFFECT` data compiled into VM memory
- built-in SFX preset table
- `NOTE` for pitched playback of custom effects
- note-level vibrato
- per-voice filters
- per-voice drive
- master filter
- comb and notch filter modes

### Audio Prototype Harness

- `firmware/audio-proto`
  - standalone synth demo
  - useful for preset tuning and hardware audio validation

## Current Direction

The current audio direction is:

1. Keep one shared synth model across web and device.
2. Build instruments and effects with `EFFECT` and `NOTE`.
3. Treat any future music API as a higher-level layer on top of that engine.

This means the older parallel-plan ideas are retired:

- no PWM-first audio plan
- no routed shared filter model
- no separate `SYS_MUSIC` engine as the primary path

## Active Gaps

These are still reasonable next steps:

- a higher-level music sequencing API built on top of `NOTE`
- more BASIC examples using `EFFECT`, `NOTE`, `VFILTER`, and `VDRIVE`
- cleaner end-user audio docs in `BASIC-REFERENCE.md`
- more hardware validation on the I2S amp path
- optional DSP expansion beyond the current filter/drive set

## Rule For Future Work

When extending audio, prefer:

- shared data formats
- shared syscall semantics
- shared behavior between web and hardware

Avoid introducing a second audio engine just for music. The current implementation is finally converging on one path, and the docs should stay aligned with that.
