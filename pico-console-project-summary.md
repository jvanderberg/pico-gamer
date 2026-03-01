# Pico Console — RP2040 Microcontroller Gaming Platform

## Overview

A minimalist handheld gaming platform built entirely from commodity, hand-solderable modules. Games are written for a custom bytecode VM with a tile-based rendering engine and SID-style synthesizer, loaded onto the device via USB mass storage — no SD card, no external storage hardware. The entire system is through-hole with no custom assembly required. Native RP2040 games are also supported via a BIOS jump table. A companion web emulator allows VM games to be developed and played in the browser.

## Hardware

### Components

| Module | Interface | Pins Used | Notes |
|---|---|---|---|
| Raspberry Pi Pico (socketed) | — | — | CPU, 2MB flash (W25Q16), USB-C |
| SH1106 1.3" 128x64 OLED w/ rotary encoder | I2C (1MHz Fast Mode Plus) | SDA, SCL, ENC_A, ENC_B, ENC_SW | Display + menu navigation + button |
| KY-023 dual-axis joystick (pin header) | Analog + digital | ADC0 (VRx), ADC1 (VRy), GPIO (SW) | Game input — 2-axis + click button |
| Piezo buzzer | PWM | 1 GPIO | Basic sound, always present |
| PAM8403 class-D amp module (pin header, optional) | Analog audio in | Same PWM pin via RC filter | Full SID-style audio output |
| Small 8Ω speaker | Driven by PAM8403 | — | Connected to amp module |
| JST 2-pin battery header | — | VSYS | Optional LiPo battery connection |
| TP4056 charge module (pin header, optional) | — | USB 5V in, LiPo out to VSYS | Handles charging + battery protection |

### Passive Components

- 2x I2C pull-up resistors (4.7kΩ, 0805 or 1206)
- Decoupling capacitors as needed
- 1x series resistor for piezo
- 1x RC low-pass filter between PWM pin and amp input (one resistor + one cap)

### Design Constraints

- All through-hole or pre-assembled modules
- Large hand-solderable passives only (0805/1206 at smallest)
- No SMD assembly — Pico is socketed via pin headers
- All modules are commodity parts, easily sourced from AliExpress/Amazon
- BOM designed for long-term availability — all modules are high-volume, generic, and unlikely to change

### Bill of Materials — Stability Assessment

| Module | Availability | Stability |
|---|---|---|
| Raspberry Pi Pico | Everywhere, massive production | Rock solid — foundation backed, not going anywhere |
| SH1106 1.3" OLED w/ encoder | Very common | Good — standard 1.3" driver, generic encoder |
| KY-023 joystick | Ubiquitous | Rock solid — two pots and a switch, unchanged 15+ years |
| Piezo | Commodity | Will exist forever |
| PAM8403 module | Everywhere | Very stable — go-to tiny amp for years |
| TP4056 module | Everywhere | Rock solid — billions made |

Highest risk item: OLED + encoder combo module. Mitigation: separate OLED and encoder are both independently commodity parts.

### Power

LiPo battery connects via JST header to VSYS on the Pico. The Pico's onboard RT6150B buck-boost regulator accepts 1.8–5.5V and outputs 3.3V, so it handles the full LiPo discharge range (3.0–4.2V) including boosting at the tail end. The TP4056 charge module handles USB charging and battery protection (DW01 IC cuts off at ~3.0V). Charging occurs whenever USB 5V is present regardless of USB data activity.

### Display Details — SH1106

The 1.3" OLED modules universally use the SH1106 driver, not the SSD1306. Key differences affecting this platform:

- **No hardware scroll** — all scrolling is software-rendered in the framebuffer
- **132x64 internal RAM** — 128 visible columns sit at a 2-column offset (column address starts at `0x02`)
- **Page addressing only** — no continuous horizontal addressing mode; each of the 8 pages (8 rows of 128 columns) must be addressed separately when writing
- **Can read display RAM over I2C** — unlike SSD1306 (not currently used but available)

### Custom Display Driver

A custom SH1106 driver will be written targeting 1MHz I2C (Fast Mode Plus). Key optimizations:

- **Dirty page tracking** — only resend pages (8-pixel-high rows) that changed since last flip
- **Per-page column range tracking** — within a dirty page, only send the modified column range
- **Full redraw fallback** — 8 page writes × 128 bytes + addressing overhead; estimated 25-40 FPS at 1MHz for worst case
- **Typical game frame** — 2-3 dirty pages (sprites moved, score updated) = much higher effective FPS

## Software Architecture

### Flash Layout (2MB W25Q16)

```
0x00000000 ┌─────────────────────────┐
           │ Firmware                │
           │ - VM interpreter        │
           │ - TinyUSB MSC stack     │
           │ - Custom SH1106 driver  │
           │ - Tile engine           │
           │ - Audio synthesizer     │
           │ - Input drivers         │
           │ - Launcher/menu         │
           │ - BIOS jump table       │
           │ ~256KB                  │
0x00040000 ├─────────────────────────┤
           │ FAT12 Game Storage      │
           │ - .game bytecode files  │
           │ - .bin native binaries  │
           │ - ~1.75MB               │
           │ - Hundreds of games     │
0x00200000 └─────────────────────────┘
```

### USB Mass Storage (TinyUSB)

The firmware implements a USB mass storage device using TinyUSB's `msc_device` class. When plugged into a PC, the game storage partition appears as a small USB drive. Users drag and drop `.game` or `.bin` files onto it. Key implementation details:

- TinyUSB callbacks (`tud_msc_read10_cb`, `tud_msc_write10_cb`) map SCSI commands to flash read/write at the partition offset
- FAT12 filesystem keeps overhead minimal
- Storage mode is separate from game mode to avoid flash contention
- Flash erase/write uses pico-sdk `flash_range_erase`/`flash_range_program` with interrupts disabled
- Linker script must be aware of the firmware/storage partition boundary
- ~200-300 lines of custom code on top of TinyUSB
- W25Q16 rated for 100,000 erase cycles per sector — fine for occasional game loading

### Two-Tier Game Support

The platform supports two types of games:

| | `.game` (VM bytecode) | `.bin` (native RP2040) |
|---|---|---|
| **Execution** | Interpreted by VM on core 0 | Loaded to RAM, executed directly |
| **Performance** | ~5-15M VM instructions/sec | Full 125MHz native |
| **Max size** | 32-64KB game memory | ~150-200KB (available SRAM) |
| **Safety** | Sandboxed — can only access syscalls | Full hardware access |
| **Portability** | Runs on hardware + web emulator | Hardware only |
| **Use case** | Most games | Performance-critical (AI, physics, procgen) |
| **Toolchain** | Web IDE compiler | Rust/C cross-compiler + SDK crate |

The launcher detects file type and either starts the VM interpreter or loads the native binary into RAM and jumps to it.

### BIOS Jump Table — Native Game Interface

Native `.bin` games access platform functionality through a fixed jump table in flash. This is the contract between firmware and native games — the table address and layout never change across firmware versions.

#### Table Location

Pinned at a fixed flash address (e.g. `0x10000100`) via linker script. The firmware populates it at compile time.

#### Table Structure

```
Offset  Entry
──────  ─────────────────────────────────────
0x00    magic: 0x5043 ("PC" — Pico Console)
0x04    version: u32

        ── High-Level Game API ──
        (same functions the VM syscalls invoke)

0x08    clear_screen()
0x0C    draw_pixel(x, y, color)
0x10    draw_line(x0, y0, x1, y1)
0x14    draw_rect(x, y, w, h)
0x18    draw_sprite(id, x, y, flags)
0x1C    blit(src, x, y, w, h)
0x20    flip()
0x24    set_tileset(data_ptr)
0x28    set_tilemap(map_ptr)
0x2C    scroll(x_offset, y_offset)
0x30    sprite_overlay(id, x, y, flags)
0x34    set_voice(ch, waveform, freq, pw)
0x38    set_envelope(ch, a, d, s, r)
0x3C    set_filter(cutoff, resonance, mode, routing)
0x40    set_volume(vol)
0x44    tone(freq, duration_ms)
0x48    read_input() -> InputState
0x4C    rand() -> u32
0x50    time_ms() -> u32

        ── Low-Level Hardware Access ──
        (for games that want full control)

0x54    i2c_write(addr, data, len)
0x58    i2c_read(addr, buf, len)
0x5C    pwm_set(slice, duty)
0x60    adc_read(channel) -> u16
0x64    gpio_read(pin) -> bool
0x68    gpio_write(pin, value)
0x6C    flash_read(offset, buf, len)
0x70    flash_write(offset, data, len)
```

#### Versioning Rules

- First two entries are always magic number and version
- **Only append new entries — never reorder or remove**
- Native games check magic + version at startup to verify compatibility
- Old games on new firmware: always works (new entries added at end)
- New games on old firmware: game checks version, gracefully degrades or refuses to run

#### SDK Crate

Published as `pico-console-sdk` for Rust (or a C header). Games compile against it:

```rust
// The SDK just knows the table address and dereferences it
const BIOS: *const BiosTable = 0x10000100 as *const BiosTable;

pub fn clear_screen() {
    unsafe { ((*BIOS).clear_screen)() }
}

pub fn flip() {
    unsafe { ((*BIOS).flip)() }
}
```

Native games are compiled with a fixed RAM load address, linked against the SDK stubs, and produce a flat `.bin` file.

#### Why Two Levels?

The high-level API (drawing, tiles, audio, input) is the same native code that the VM's syscalls invoke. There's **no performance gain** calling `draw_sprite()` natively vs via VM syscall — 99.9% of the time is in the renderer, not the dispatch. The high-level API exists for convenience.

The performance win for native games is in **game logic** — pathfinding, collision detection, physics, procedural generation, complex AI. This is where the VM interpreter overhead matters, and where native code shines.

The low-level API exists for exotic games that want to do something the high-level API doesn't support — custom display effects, unusual audio tricks, direct hardware control.

### Custom Bytecode VM

A stack-based virtual machine tailored to the platform. Games interact with hardware exclusively through system calls. Designed to support real games (roguelikes, platformers, puzzle games with depth) — not toy demos.

#### Design Principles

- Stack-based architecture (simpler interpreter, better code density)
- ~30-50 opcodes total
- Flat memory model — game gets 32-64KB byte array for bytecode, stack, globals, sprite data, and tile maps
- ~5-15M VM instructions/sec estimated at 125MHz
- All hardware access via syscalls — games never touch hardware directly

#### Core Opcodes

**Stack:** `PUSH8`, `PUSH16`, `POP`, `DUP`, `SWAP`
**Arithmetic:** `ADD`, `SUB`, `MUL`, `DIV`, `MOD`
**Logic:** `AND`, `OR`, `XOR`, `SHIFT`
**Comparison:** `EQ`, `LT`, `GT`
**Flow control:** `JMP`, `JZ`, `JNZ`, `CALL`, `RET`
**Variables:** `LOAD`, `STORE`, `LOAD_IDX`, `STORE_IDX`
**System:** `SYSCALL`

#### System Call Interface

##### Drawing Primitives

| Syscall | Description |
|---|---|
| `SYS_CLEAR` | Clear framebuffer |
| `SYS_PIXEL` | Set/clear pixel at (x, y) |
| `SYS_LINE` | Draw line |
| `SYS_RECT` | Draw rectangle |
| `SYS_SPRITE` | Draw sprite from game memory (XOR or OR overlay) |
| `SYS_BLIT` | Block copy to framebuffer |
| `SYS_FLIP` | Push framebuffer to OLED (via custom driver with dirty tracking) |

##### Tile Engine

| Syscall | Description |
|---|---|
| `SYS_TILESET` | Point to tile graphics data in game memory (up to 256 8x8 1-bit tiles = 2KB) |
| `SYS_TILEMAP` | Point to map data (grid of tile indices) |
| `SYS_SCROLL` | Set X/Y pixel scroll offset, render visible window from tilemap into framebuffer |
| `SYS_SPRITE_OVER` | Draw sprites on top of tile layer (player, enemies, projectiles) |

The tile engine enables smooth side-scrolling without per-pixel game logic. At 128x64 with 8x8 tiles, one screen is a 16x8 grid (128 bytes). A scrolling level at 256x8 tiles is just 2KB. The renderer shifts which slice of the tile map is visible and offsets by 0-7 pixels for smooth sub-tile scrolling.

##### Sound — SID-Style Synthesizer

| Syscall | Description |
|---|---|
| `SYS_VOICE` | Set voice (0-2) waveform, frequency, pulse width |
| `SYS_ENVELOPE` | Set voice ADSR parameters (attack, decay, sustain level, release) |
| `SYS_FILTER` | Set filter cutoff, resonance, mode (LP/BP/HP), voice routing |
| `SYS_VOLUME` | Master volume |

Legacy simple sound:

| Syscall | Description |
|---|---|
| `SYS_TONE` | Simple frequency + duration (convenience wrapper, uses voice 0) |

##### Input

| Syscall | Description |
|---|---|
| `SYS_INPUT` | Read joystick axes, joystick button, encoder position, encoder button |

##### System

| Syscall | Description |
|---|---|
| `SYS_RAND` | Random number |
| `SYS_TIME` | Tick count for game loop timing |

### Sound Architecture

The audio system runs entirely on the **second core (core 1)**, leaving core 0 free for the VM interpreter, display driver, and input handling.

#### Output Stage

PWM is used as a crude DAC:

- PWM carrier frequency: 62.5kHz (125MHz / 2000), giving ~11-bit resolution
- PWM duty cycle updated at audio sample rate (~22kHz)
- RC low-pass filter on the PWM pin smooths output to analog audio
- Piezo connects directly to PWM pin (basic builds)
- PAM8403 amp module connects after RC filter (full audio builds)
- Both outputs can coexist on the PCB — piezo footprint + amp header

#### SID-Style Synthesizer (3 voices)

Modeled after the MOS 6581 SID chip architecture:

**Per voice (×3):**

- **Phase accumulator oscillator** with selectable waveform:
  - Sawtooth — accumulator value directly
  - Triangle — fold the accumulator
  - Pulse — comparison against variable pulse width threshold
  - Noise — LFSR (linear feedback shift register)
- **16-bit frequency control** via phase accumulator step size
- **ADSR envelope generator** — four-state state machine (attack, decay, sustain, release) with per-voice parameters

**Global:**

- **Mixer** — sum three voice outputs, apply master volume, clamp
- **State variable filter** — 2-pole digital approximation of the SID's resonant filter
  - Modes: low-pass, band-pass, high-pass (selectable per voice routing)
  - Controllable cutoff frequency and resonance
  - ~20-30 multiply-accumulate operations per sample

#### Performance Budget

At 22kHz sample rate, core 1 has ~5,600 CPU cycles per sample at 125MHz:

- 3 oscillators: ~30-50 cycles each
- 3 ADSR envelopes: ~20 cycles each
- Filter: ~30 cycles
- Mixer + output: ~10 cycles
- **Total: ~200-300 cycles per sample (~5% of core 1)**

Massive headroom remains for future enhancements (more voices, effects, wavetable synthesis).

#### Piezo vs Speaker

- **Piezo only:** All waveforms will play but sound thin and buzzy due to sharp resonant peak and poor frequency response. Still has character — its own lo-fi aesthetic.
- **Speaker via PAM8403:** Full SID-like sound reproduction. The RC filter + class-D amp + 8Ω speaker faithfully reproduces the synthesized waveforms.

### Toolchain

#### VM Games (PC-side / Web)

1. **Web IDE** — browser-based editor, compiler, and simulator. Write code, compile to bytecode, test in canvas+Web Audio simulator, export `.game` file. Full development loop without installing anything.
2. **Assembler (Python)** — alternative CLI tool for text mnemonics to bytecode.
3. **Language TBD** — a simple scripting language targeting the VM. Likely Lua-like or BASIC-like syntax. Compiler runs in browser (JavaScript) or as a CLI tool.

#### Native Games

1. **`pico-console-sdk` Rust crate** — thin wrapper around the BIOS jump table. Games compile to `.bin` with standard Rust embedded toolchain.
2. **C header alternative** — same BIOS table bindings for C developers.
3. **Build produces a flat `.bin`** — copied to USB drive alongside `.game` files.

### Web Emulator

The VM can be ported to the browser, enabling games to be played and developed without hardware.

| Syscall | Hardware Target | Browser Target |
|---|---|---|
| `SYS_FLIP` | SH1106 via I2C | `<canvas>` element |
| `SYS_VOICE` | Core 1 synth → PWM | Web Audio API (OscillatorNode + BiquadFilterNode) |
| `SYS_ENVELOPE` | Core 1 ADSR | Web Audio API (gain envelope via AudioParam) |
| `SYS_FILTER` | Core 1 state variable filter | Web Audio API BiquadFilterNode |
| `SYS_TONE` | Convenience wrapper | Web Audio API oscillator |
| `SYS_INPUT` | ADC/GPIO | Keyboard / Gamepad API |
| `SYS_TIME` | Hardware tick counter | `performance.now()` |

Two implementation paths:

- **JavaScript reimplementation** — a few hundred lines, easy to iterate, runs everywhere. Build a web UI with game library, editor, and in-browser assembler.
- **Compile C/Rust interpreter to WASM** — via Emscripten/wasm-pack. One canonical implementation, swap syscall layer with compile flags. Guarantees behavioral parity between hardware and web. Audio via AudioWorklet.

The web player enables: in-browser game development and testing, playable demos embedded in YouTube descriptions, easy game sharing without hardware.

Note: Native `.bin` games are hardware-only and cannot run in the web emulator.

## Input Mapping

| Input | Hardware | Use |
|---|---|---|
| Joystick X/Y | KY-023 analog (2 ADC channels) | Game movement (4/8 directional, thresholded in software) |
| Joystick click | KY-023 digital | Action button |
| Encoder rotation | OLED module | Menu scrolling, secondary game input |
| Encoder button | OLED module | Menu select, secondary action button |

## User Experience

1. Plug console into PC via USB-C
2. Console appears as a small USB drive
3. Drag and drop `.game` or `.bin` files onto the drive
4. Unplug and play
5. Launcher menu lets user browse and select games via encoder
6. Joystick + buttons for in-game control

## Target Game Types

The platform is designed for games with real depth at 128x64 monochrome, not toy demos:

- Roguelikes (Brogue-style)
- Side-scrolling platformers (tile engine with smooth scrolling)
- Top-down adventure games (Zelda-like)
- Rhythm games
- Card games
- Puzzle games with depth (Sokoban variants, Tetris Attack)

Design inspiration: Playdate (400x240 1-bit) demonstrates that monochrome with good art direction looks gorgeous.

## Core Architecture Summary

```
┌──────────────────────────────────────────────────┐
│                  CORE 0                           │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │         Game Execution (one of):         │    │
│  │                                          │    │
│  │  .game: VM interpreter                   │    │
│  │    └─ syscalls ──┐                       │    │
│  │                  │                       │    │
│  │  .bin: Native code in RAM                │    │
│  │    └─ BIOS jump table ──┐               │    │
│  │                         │               │    │
│  └─────────────────────────┼───────────────┘    │
│                            ▼                     │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐    │
│  │ Tile    │  │ SH1106   │  │ Input       │    │
│  │ Engine  │  │ Driver   │  │ (ADC/GPIO)  │    │
│  │         │  │ (1MHz)   │  │             │    │
│  └─────────┘  └──────────┘  └─────────────┘    │
│                                                   │
│  ┌──────────┐                                    │
│  │ TinyUSB  │                                    │
│  │ MSC      │                                    │
│  └──────────┘                                    │
├──────────────────────────────────────────────────┤
│                  CORE 1                           │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ SID-Style Audio Synthesizer              │    │
│  │                                          │    │
│  │  Voice 0 ─┐                              │    │
│  │  Voice 1 ─┼→ Filter → Mixer → PWM       │    │
│  │  Voice 2 ─┘                              │    │
│  │                                          │    │
│  │  22kHz sample rate, ~5% CPU usage        │    │
│  └──────────────────────────────────────────┘    │
├──────────────────────────────────────────────────┤
│                  FLASH                            │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ Firmware + BIOS Table (fixed addr)       │    │
│  ├──────────────────────────────────────────┤    │
│  │ FAT12: .game and .bin files              │    │
│  └──────────────────────────────────────────┘    │
├──────────────────────────────────────────────────┤
│                  HARDWARE                         │
│                                                   │
│  PWM ──┬── Piezo (basic)                         │
│        └── RC filter → PAM8403 → Speaker         │
│                                                   │
│  I2C ──── SH1106 OLED (1MHz)                    │
│                                                   │
│  ADC ──── KY-023 Joystick                        │
│  GPIO ─── Encoder + Buttons                      │
│                                                   │
│  VSYS ─── LiPo → TP4056 (optional)              │
│                                                   │
│  USB ──── TinyUSB Mass Storage (game load)       │
└──────────────────────────────────────────────────┘
```

## Open Questions / Future Work

- Exact opcode encoding and bytecode file format
- Game metadata (title, author) — header in bytecode file or separate manifest
- Save game support (reserve flash sectors per game?)
- Enclosure design
- SH1106 1MHz I2C validation on prototype
- CHIP-8 / SUPER-CHIP compatibility mode as optional retro novelty (not the primary platform)
- Audio: tracker-style music format for sequencing the 3 voices
- Audio: additional effects (vibrato, portamento, ring modulation like the SID)
- Native SDK: exact RAM load address and memory map for .bin games
- Native SDK: how native games return to launcher cleanly (watchdog reset? jump back?)
- Web IDE: language design for the scripting language
- Web IDE: sprite/tile editor, music tracker integration
