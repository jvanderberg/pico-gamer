# Pico Gamer — Current Implementation Status

## Implemented

### Core Runtime

- shared C++ VM in `vm/lib/pico_vm`
- BASIC compiler in `web/src/basic` (lexer → parser → codegen → assembler)
- assembler and `.game` build path
- WASM build of the VM for the browser
- CLI compiler: `web/compile-game.ts`

### Device Runner

- RP2040 firmware in `firmware/vm-runner`
- SH1106 DMA-accelerated display driver with delta updates
- joystick (ADC → digital threshold) and rotary encoder input
- USB mass-storage game loading (FAT12)
- VM audio command drain into the device synth
- I2S audio output for MAX98357A

### Web Runner

- React/Vite UI with CodeMirror editor and inline linter
- same VM core compiled to WASM
- `AudioWorklet` synth sink
- mobile-responsive game view
- example game browser

### Terminal Runner

- `terminal/pico-term.ts` — runs `.bas`/`.game` files in the terminal
- Unicode half-block character rendering (128x32)
- keyboard input mapping (arrows, WASD, encoder keys)
- color modes (green, amber, cyan, white)
- audio via `node-web-audio-api` (same synth processor as web)

### Sprite Engine

- 32 sprite slots with automatic velocity integration
- edge behaviors: wrap, bounce, destroy, stop
- bitmap and vector sprite formats
- collision detection with groups and masks
- collision modes: detect, bounce, destroy, stop
- hit callbacks (BASIC `CALLBACK`)
- sprite animation with configurable frame rate
- sprite direction (cardinal velocity from heading)
- rotation support for vector sprites

### Tilemap & Camera

- tilemap rendering with animated tiles
- tile properties (solid, etc.)
- tile-based collision resolution
- camera system with smooth follow, dead zone, and world bounds
- BLIT for raw bitmap rendering

### Particle System

- configurable emitters (position, velocity, spread, lifetime, rate)
- gravity support
- per-emitter control (start, stop, clear)

### Audio

- 6-voice synth shared across web, terminal, and device
- pulse, saw, triangle, and noise oscillators
- ADSR envelopes per voice
- per-voice filter (LP, BP, HP, notch, comb)
- per-voice drive
- master filter on mixed output
- custom `EFFECT` data compiled into VM memory
- built-in SFX preset table
- `NOTE` for pitched playback of custom effects
- note-level vibrato
- `SONG` sequencer for multi-voice chiptune playback
- `TONE` for simple frequency output

### Benchmarks

- `firmware/fps-bench` — standalone display performance benchmark (DMA I2C, starfield + bouncing balls, serial FPS stats)

## Active Gaps

- more BASIC game examples
- cleaner end-user audio docs in `BASIC-REFERENCE.md`
- higher-level music composition tooling
- optional DSP expansion beyond the current filter/drive set
