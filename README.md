# Pico Gamer

A handheld gaming console built from commodity through-hole modules around the Raspberry Pi Pico (RP2040). Games run on a custom stack-based bytecode VM or as native ARM binaries. A BASIC compiler and web-based emulator let you write, test, and play games in the browser.

**[Try the web emulator](https://jvanderberg.github.io/pico-gamer/)**

## Hardware

| Component | Module | Notes |
|-----------|--------|-------|
| CPU | Raspberry Pi Pico | RP2040, 125 MHz dual-core Cortex-M0+, socketed |
| Display | SH1106 1.3" OLED | 128x64 monochrome, I2C 1 MHz, with rotary encoder |
| Joystick | KY-023 | 2 ADC axes + digital click |
| Audio | MAX98357A-style I2S amp | Mono speaker output via `GPIO16/17/18` |
| Storage | On-board 2 MB flash | 256 KB firmware + 1.75 MB FAT12 game storage |
| Power | USB or LiPo | Optional: TP4056 charger module |

Games load via USB mass storage -- plug in, drag a `.game` file onto the drive, unplug and play.

## Architecture

The current runtime includes a shared 6-voice synth on both web and device. On hardware, `firmware/vm-runner` outputs audio over I2S to a MAX98357A-style amp; on the web, the same command model feeds an `AudioWorklet`.

### Two tiers of game support

| Type | Format | Execution | Safety |
|------|--------|-----------|--------|
| VM bytecode | `.game` | Stack VM, ~50k instructions/frame | Sandboxed, hardware access via syscalls only |
| Native ARM | `.bin` | Direct execution at 125 MHz | Full hardware access via BIOS jump table |

### VM

Stack-based, 64 KB flat memory, 256-entry 16-bit operand stack. ~30 opcodes covering stack manipulation, arithmetic, bitwise, comparison, branching, memory access, and syscalls. Games target 60 FPS with a per-frame cycle budget and `YIELD` to signal frame completion.

See [VM-SPEC.md](VM-SPEC.md) for the full instruction set and memory model.

### Sprite engine

32 sprite slots with automatic velocity integration, edge behavior (wrap, bounce, destroy, stop), and collision detection. Supports bitmap and vector sprite formats, rotation, collision groups/masks, and hit callbacks. Wall rectangles provide static collision boundaries.

### Syscalls

Display primitives (pixel, line, rect, sprite, blit, text), input polling, trig lookup tables, random number generation, fixed-point math, and the full sprite engine API -- all accessible from both assembly and BASIC.

## BASIC

A compiled BASIC dialect targeting the VM bytecode. Three-stage pipeline: lexer, parser, codegen -- emits assembly which is then assembled to bytecode.

```basic
' Bouncing dot -- a complete game in 5 lines
DATA dot_gfx, $80

SPRITE 0, dot_gfx, 1, 1, 10, 5, 0, 64, 64, EDGE_BOUNCE

DO
  YIELD
LOOP
```

**Language features:** 16-bit unsigned integers, variables, constants, arrays (`DIM`), `IF`/`ELSEIF`/`ELSE`, `FOR`/`NEXT`, `DO`/`LOOP` (with `WHILE`/`UNTIL`), subroutines (`SUB`), sprite hit callbacks (`CALLBACK`), inline data blocks, bitwise and comparison operators, built-in math functions (`RAND`, `SIN`, `COS`, `ABS`, `FX_MUL`), and direct memory access (`PEEK`/`POKE`).

See [BASIC-REFERENCE.md](BASIC-REFERENCE.md) for the full language and API reference.

## Web emulator

The web emulator runs the same C++ VM core compiled to WASM via Emscripten, so behavior matches the hardware exactly. Built with React, TypeScript, Vite, Tailwind CSS, and CodeMirror.

**Keyboard mapping:**

| Key | Input |
|-----|-------|
| Arrow keys / WASD | Joystick directions |
| K | Button |
| Q / L | Encoder CW |
| E / J | Encoder CCW |
| Space / Tab | Encoder button |

See [Building](#building) below for setup instructions.

## Terminal runner

Run `.bas` or `.game` files directly in the terminal. Renders the 128x64 framebuffer using Unicode half-block characters at full resolution (128 columns x 32 rows). Includes the same 6-voice synth via `node-web-audio-api`.

```bash
npx tsx terminal/pico-term.ts web/examples/muncher.bas
npx tsx terminal/pico-term.ts --color green web/examples/asteroids.bas
npx tsx terminal/pico-term.ts --no-audio web/examples/invaders.bas
```

Options:
- `--color green|amber|cyan|white` -- display color (default: white)
- `--no-audio` -- disable sound output

Requires a terminal at least 128 columns wide. Audio uses `node-web-audio-api` (installed as part of `npm install` in `web/`); falls back to silent mode if unavailable.

## Building

### WASM VM

Required before running the web or terminal emulator. **Rebuild after any changes to C++ under `vm/lib/`.**

```bash
source ~/emsdk/emsdk_env.sh   # if emcc is not already on PATH
bash wasm/build.sh
```

### Web emulator

```bash
cd web
npm install
npm run dev       # start dev server
npm run build     # production build
```

### Tests

```bash
cd web && npm test           # WASM + compiler/assembler tests
cd vm && pio test -e native  # native VM unit tests
```

## Project structure

```
firmware/
  vm-runner/       RP2040 firmware (VM interpreter, drivers, audio)
  fps-bench/       Display performance benchmark
vm/lib/pico_vm/    Shared C++ VM core (used by firmware and WASM)
wasm/              Emscripten build script and WASM bridge
web/
  src/basic/       BASIC compiler (lexer, parser, codegen)
  src/assembler/   Two-pass bytecode assembler
  src/audio/       6-voice synth (AudioWorklet, shared with terminal)
  src/wasm/        WASM VM bindings
  src/components/  React UI
  examples/        Demo BASIC programs
  test/            Test suite
terminal/
  pico-term.ts     Terminal game runner
  synth-node.ts    Node.js wrapper for the synth processor
```

## Examples

| Program | Description |
|---------|-------------|
| [muncher.bas](web/examples/muncher.bas) | Pac-Man clone with tilemap, ghost AI, and sound |
| [invaders.bas](web/examples/invaders.bas) | Space Invaders with particle explosions |
| [asteroids.bas](web/examples/asteroids.bas) | Full game with vector sprites, collision, scoring, wave progression |
| [kessler.bas](web/examples/kessler.bas) | Orbital debris dodging game |
| [defender.bas](web/examples/defender.bas) | Side-scrolling shooter |
| [dance-party.bas](web/examples/dance-party.bas) | Chiptune music demo |
| [sfx-demo.bas](web/examples/sfx-demo.bas) | Sound effects showcase |
| [starfield.bas](web/examples/starfield.bas) | Parallax star field with bouncing balls |
| [bouncing-dot.bas](web/examples/bouncing-dot.bas) | Minimal example -- one sprite, 5 lines |

## Documentation

- [VM-SPEC.md](VM-SPEC.md) -- VM architecture, opcodes, memory model, syscall interface
- [BASIC-REFERENCE.md](BASIC-REFERENCE.md) -- BASIC language reference and API
- [AUDIO-DESIGN.md](AUDIO-DESIGN.md) -- Current audio architecture and API
- [pico-console-project-summary.md](pico-console-project-summary.md) -- Current project summary
