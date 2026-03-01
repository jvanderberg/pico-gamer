# Pico Console — Prototype Implementation Plan

## Context

Starting from a design doc with no source code. Hardware in hand: 2x Pico, SH1106 OLED+encoder combo, some class D amps. On order: KY-023 joystick, piezo. Goal: build the Rust firmware shell incrementally, validating hardware and subsystems while waiting for remaining parts.

## Project Setup

**Workspace layout:**
```
pico-console/
├── .cargo/config.toml        # thumbv6m-none-eabi target, probe-rs runner
├── rust-toolchain.toml        # stable + thumbv6m target
├── memory.x                   # custom linker: 256KB firmware + 1.75MB storage partition
├── build.rs                   # copy memory.x to OUT_DIR
├── Cargo.toml                 # workspace root
└── crates/
    ├── firmware/              # main #![no_std] binary
    │   ├── Cargo.toml
    │   └── src/
    │       ├── main.rs        # embassy entry, peripheral init, core1 spawn
    │       ├── display/       # custom SH1106 driver + framebuffer
    │       ├── audio/         # core1 synth (oscillators, ADSR, filter)
    │       ├── input/         # encoder (PIO) + joystick (ADC, stubbed)
    │       ├── usb/           # USB MSC class (custom on embassy-usb)
    │       ├── storage/       # flash partition + FAT12 reader
    │       ├── vm/            # bytecode interpreter + syscall dispatch
    │       ├── launcher/      # game selection menu
    │       └── bios.rs        # jump table at fixed flash address
    └── pico-console-sdk/      # thin library for native .bin game authors
        └── src/lib.rs         # BIOS table struct + safe wrappers
```

**Core dependencies:** embassy-executor, embassy-time, embassy-sync, embassy-rp (rp2040), embassy-usb, embedded-hal 1.0, embedded-graphics, defmt/defmt-rtt, cortex-m-rt, static_cell, heapless, fixed (fixed-point math for audio)

**Debug setup:** Flash second Pico as Picoprobe (CMSIS-DAP), use probe-rs for flashing + defmt RTT logging throughout development.

---

## Phase 0 — Skeleton + Blink

**Validates:** Toolchain, probe-rs flashing, embassy boots, defmt logging works.
**Hardware:** 2x Pico (one as probe)

- Set up workspace, config files, memory.x
- Minimal `main.rs`: embassy entry, blink onboard LED, `defmt::info!` over RTT
- `cargo run` via probe-rs

---

## Phase 1 — SH1106 Display

**Validates:** I2C comms, SH1106 init, display output on actual module.
**Hardware:** Pico + OLED module

**Custom driver from the start** (not the existing `sh1106` crate — it's embedded-hal 0.2, no dirty tracking, full-screen flushes only). The SH1106 init is ~15 commands; the real value is dirty page + column range tracking which no existing crate provides.

- `Sh1106` struct: async I2C, 1024-byte framebuffer, `dirty: u8` page bitmask, `dirty_cols: [(u8,u8); 8]` per-page column ranges
- `flush()` only sends dirty pages, only dirty column ranges within each page (SH1106 column offset +2)
- Implement `embedded_graphics::DrawTarget` for free text/shape primitives
- Start at 400kHz I2C, push to 1MHz and validate stability (may need 2.2kΩ pull-ups instead of 4.7kΩ)
- Test pattern: checkerboard, walking pixel, text rendering

---

## Phase 2 — Rotary Encoder Input

**Validates:** PIO program, async event handling, encoder debouncing.
**Hardware:** Same OLED+encoder combo

- Use `embassy_rp::pio_programs::rotary_encoder::PioEncoder` (built-in, hardware debounced, zero CPU)
- Encoder button via `gpio::Input` with `Pull::Up` + `wait_for_falling_edge()` + 20ms debounce
- `InputState` struct with encoder + joystick fields (joystick stubbed to center)
- Input task updates shared state via `embassy_sync::Signal`

---

## Phase 3 — Launcher Menu

**Validates:** Display + input integration end-to-end, UI loop, frame timing, dirty tracking efficiency.
**Hardware:** Pico + OLED+encoder

- Scrollable list rendered with embedded-graphics
- Encoder rotates through items, button selects
- Hardcoded items initially (later: read from FAT12)
- Game loop pattern: read input → update state → draw → flush → repeat at target FPS
- Proves dirty tracking works: only cursor/scrolled text causes page redraws

---

## Phase 4 — Audio Synthesizer on Core 1

**Validates:** Dual-core execution, real-time timer ISR, PWM DAC, SID-style synthesis, inter-core comms.
**Hardware:** Pico + class D amp + speaker

**Dual-core architecture:**
- Core 0: embassy executor (game logic, display, input, USB)
- Core 1: embassy executor for async command reception + **raw timer ISR (TIMER_IRQ_3) at 22kHz** for sample generation (async Timer is too jittery for audio)

**PWM DAC:** 125MHz / 2000 = 62.5kHz carrier, ~11-bit resolution (duty 0–1999)

**SID synthesizer:**
- 3 voices, each: 32-bit phase accumulator oscillator (saw/tri/pulse/noise), 16-bit frequency, ADSR envelope
- Global: mixer + state variable filter (LP/BP/HP, cutoff, resonance)
- ~200–300 cycles per sample (~5% of core 1)

**Inter-core comms:** Synth parameters as `AtomicU16`/`AtomicU8` — core 0 stores, core 1 ISR loads. Lock-free, zero overhead.

**Critical:** Audio ISR + synth code must be placed in RAM (`#[link_section = ".data"]`) so flash erase/write from USB MSC doesn't crash core 1.

---

## Phase 5 — Flash Storage + FAT12

**Validates:** Flash read/write/erase at storage partition, FAT12 parsing, sector abstraction for USB.
**Hardware:** Pico only (flash is onboard)

- Use `embassy_rp::flash::Flash` (async, handles XIP disable)
- Storage partition at offset 0x40000 (256KB), size ~1.75MB
- **Custom minimal FAT12 reader** (~300 lines) — firmware only needs read-only access (list directory entries, read file data). Host OS handles all FAT writes via USB MSC raw sector I/O.
- First-boot format: embed a pre-built FAT12 boot sector + empty FAT + root dir as `const` data, write to flash if signature missing

---

## Phase 6 — USB Mass Storage

**Validates:** USB enumeration, SCSI command handling, host OS sees a FAT12 drive, file copy works.
**Hardware:** Pico only

**Custom MSC class on embassy-usb** (~500 lines) — no existing crate for embassy-usb. The protocol is straightforward:
- 2 bulk endpoints (IN/OUT)
- Read CBW (31 bytes) → dispatch SCSI command → send CSW (13 bytes)
- Required SCSI commands: INQUIRY, READ_CAPACITY_10, READ_10, WRITE_10, TEST_UNIT_READY, REQUEST_SENSE, MODE_SENSE

**Flash write handling:** Buffer full 4KB erase sector (8 × 512-byte USB sectors), read-modify-write for partial sectors.

**Mode switching:** Detect USB VBUS → enter MSC mode. Unplugged → enter launcher/game mode.

---

## Phase 7 — VM Interpreter

**Validates:** Bytecode execution, syscall dispatch, all subsystems integrated.
**Hardware:** All available (joystick stubbed if not arrived)

- `Vm` struct: 32KB game memory, PC, SP, 256-entry operand stack
- ~30–50 opcodes: stack ops, arithmetic, logic, comparison, flow control, variables, SYSCALL
- `run_frame()`: execute instructions until `SYS_FLIP` (natural frame pacing)
- `SyscallHandler` trait connects VM to display, audio atomics, input state
- Host-testable: opcode dispatch + stack ops can run `cargo test` on the host with mock syscalls

---

## Phase 8 — BIOS Jump Table + Native Games (deferred)

Once VM and gameplay loop work:
- Pin `BiosTable` struct at `0x10000100` via `#[link_section = ".bios_table"]`
- Load `.bin` from FAT12 into RAM, jump to entry
- Return to launcher via watchdog reset
- Publish `pico-console-sdk` crate

---

## Phase 9 — Joystick (when hardware arrives)

- 2 ADC channels (X/Y), digital button with pull-up
- Center calibration on startup, deadzone (~10%)
- Drop-in replacement for the joystick stub in InputState — zero changes elsewhere

---

## Key Technical Decisions

| Decision | Choice | Why |
|---|---|---|
| SH1106 driver | Custom | Dirty page tracking is the core perf optimization; no crate provides it |
| Encoder | Embassy PIO encoder | Built-in, hardware debounced, zero CPU |
| Audio timing | Raw timer ISR on core 1 | Async timer too jittery for 22kHz audio |
| Audio params | Atomics (lock-free) | Zero-overhead inter-core communication |
| USB MSC | Custom on embassy-usb | No existing crate; protocol is simple (~500 LOC) |
| FAT12 | Custom read-only parser | Only need dir listing + file read; ~300 LOC |
| Flashing | probe-rs (dev), UF2 (release) | defmt + debugging in dev; UF2 for end users |

## Verification

Each phase has a clear hardware-observable or defmt-observable test:
- **Phase 0:** LED blinks, defmt output in terminal
- **Phase 1:** Test pattern on OLED
- **Phase 2:** Encoder rotation logged / displayed
- **Phase 3:** Interactive menu on screen
- **Phase 4:** Audible tones from speaker
- **Phase 5:** defmt logs of FAT12 directory listing
- **Phase 6:** Host OS mounts USB drive, files copy successfully
- **Phase 7:** A hand-assembled bytecode program draws on screen and makes sound
