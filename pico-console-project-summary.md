# Pico Gamer — Current Project Summary

This file is a current-state summary of the project as implemented in the repo. It replaces the older prototype write-up that still described PWM audio, a routed shared filter, and a not-yet-built music tracker.

## Overview

Pico Gamer is a handheld-style RP2040 game platform with:

- a shared VM runtime used on web and device
- a BASIC compiler that targets that VM
- USB mass-storage deployment of `.game` files on hardware
- a matching browser emulator built from the same VM core via WASM
- a shared audio engine used by both targets

Games can run:

- as VM bytecode (`.game`) on web, terminal, and hardware
- as native binaries (`.bin`) on hardware

## Current Hardware Profile

The codebase currently targets this hardware model:

| Component | Notes |
|---|---|
| Raspberry Pi Pico | RP2040 host MCU |
| SH1106 OLED | `128x64`, monochrome, I2C |
| Rotary encoder | menu navigation / extra input |
| KY-023 joystick | directional input + click |
| MAX98357A-style I2S amp | current device audio path |
| Small mono speaker | connected to the I2S amp |
| On-board flash | firmware + FAT12 game storage |

The current firmware audio implementation is I2S. Older piezo/PWM notes are obsolete.

## Software Layout

### Shared Runtime

- `vm/lib/pico_vm/`
  - shared VM core
  - syscall dispatch
  - audio command buffering

### Device

- `firmware/vm-runner/`
  - RP2040 firmware that runs `.game` files
  - SH1106 display driver
  - input polling
  - FAT12/USB game loading
  - I2S audio sink

- `firmware/audio-proto/`
  - standalone audio testbed
  - useful for synth tuning and speaker/amp bring-up

### Web

- `wasm/`
  - Emscripten bridge for the shared VM core
- `web/`
  - BASIC compiler
  - assembler
  - React/Vite UI
  - `AudioWorklet` synth sink

### Terminal

- `terminal/`
  - `pico-term.ts` — runs `.bas`/`.game` files in the terminal using Unicode half-block characters (128x32)
  - `synth-node.ts` — Node.js shim that wraps the same `synth-processor.ts` for audio via `node-web-audio-api`
  - same compiler, assembler, and WASM VM as the web emulator

## Audio Summary

The current synth architecture is:

- 6 voices
- pulse, saw, triangle, and noise oscillators
- ADSR per voice
- per-voice filter
- per-voice drive
- one master filter on the mixed output
- custom `EFFECT` data in VM memory
- `NOTE` for pitched instruments
- `SFX` for sound effects

Current filter modes:

- `FILTER_LP`
- `FILTER_BP`
- `FILTER_HP`
- `FILTER_NOTCH`
- `FILTER_COMB`

Current audio API surface:

- `VOICE`
- `ENVELOPE`
- `NOTEOFF`
- `VFILTER`
- `VDRIVE`
- `FILTER`
- `VOLUME`
- `TONE`
- `SFX`
- `NOTE`
- `EFFECT` / `STEP`

The important current design choice is that music and sound effects share one engine. There is no separate `SYS_MUSIC` runtime today.

## Game Workflow

### Hardware

1. Write BASIC or assembly.
2. Compile to `.game`.
3. Copy the `.game` file to the Pico Gamer USB drive.
4. Launch it from the device UI.

### Web

1. Compile the same source through the browser or CLI.
2. Run it in the WASM VM.
3. Hear the same synth model through the browser `AudioWorklet`.

### Terminal

1. `npx tsx terminal/pico-term.ts game.bas`
2. Compiles BASIC, runs the same WASM VM, renders via Unicode half-block characters.
3. Audio via `node-web-audio-api` (same synth processor as web).

## Native Games

Native `.bin` support is still part of the project shape, but the active day-to-day path is the VM runner. The VM path is the one with the strongest web/device parity and the one used by the current audio work.

## Documentation Map

- [README.md](README.md)
  - top-level project overview
- [AUDIO-DESIGN.md](AUDIO-DESIGN.md)
  - current audio architecture and API
- [BASIC-REFERENCE.md](BASIC-REFERENCE.md)
  - BASIC language and VM reference
- [VM-SPEC.md](VM-SPEC.md)
  - VM details

## Retired Assumptions

The following older design branches are intentionally retired from the docs:

- PWM DAC as the main audio path
- per-voice routing into one shared filter
- `SYS_MUSIC` tracker/sequencer as the current music API
- the earlier Rust/Embassy firmware plan as a description of the code that ships today

Those ideas may still be interesting historically, but they are not the implementation this repo currently runs.
