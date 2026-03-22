# Terminal Game Runner — Plan

## Goal
Run Pico Gamer `.bas` or `.game` files in a terminal, rendering the 128×64 monochrome framebuffer as text characters with keyboard input.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ .bas source │────▶│ BASIC compiler│────▶│  assembler  │──▶ bytecode
└─────────────┘     │ (TypeScript)  │     │ (TypeScript) │
                    └──────────────┘     └─────────────┘
                                                │
                    ┌──────────────┐             ▼
                    │  pico-vm.wasm │◀── vm_load_program()
                    │  (emscripten) │
                    │               │──▶ vm_exec_frame() @ 60fps
                    │               │──▶ vm_get_framebuffer() → 1024 bytes
                    └──────────────┘
                           │
                    ┌──────────────┐
                    │ Terminal      │
                    │ renderer     │  128×64 px → 128×32 chars
                    │ (▀▄█ blocks) │  using Unicode half-block chars
                    └──────────────┘
```

## Display Rendering

The framebuffer is 128×64 monochrome (1 bit/pixel), packed as 1024 bytes in horizontal format:
- 128 pixels wide = 16 bytes per row
- 64 rows = 1024 bytes total
- Bit 7 is leftmost pixel

Each terminal character covers a 2×2 pixel area using Unicode quarter-block characters (U+2596–U+259F):

```
index = (top-left << 0) | (top-right << 1) | (bottom-left << 2) | (bottom-right << 3)

 0=  (space)   4= ▖   8= ▗  12= ▄
 1= ▘          5= ▌   9= ▚  13= ▙
 2= ▝          6= ▞  10= ▐  14= ▟
 3= ▀          7= ▛  11= ▜  15= █
```

Result: 64 columns × 32 rows — fits any terminal.

### Rendering approach
- Read 1024-byte framebuffer via `vm_get_framebuffer()`
- Pair rows: row 0+1, row 2+3, ... row 62+63
- For each column, read the pixel from each row in the pair
- Map to the appropriate block character
- Use ANSI escape `\x1b[H` to home cursor (no clear — avoids flicker)
- Only redraw if framebuffer changed (compare against previous frame)

## Input

Raw mode stdin (`process.stdin.setRawMode(true)`):

| Key(s)          | VM Input          |
|-----------------|-------------------|
| Arrow keys      | UP/DOWN/LEFT/RIGHT|
| W/A/S/D         | UP/LEFT/DOWN/RIGHT|
| Space           | ENC_BTN           |
| Q / E           | ENC_CW / ENC_CCW  |
| K               | BTN               |
| Ctrl+C          | Exit              |

Same key mapping as the web emulator. ANSI escape sequences for arrow keys (`\x1b[A` etc).

## Game Loop

```
1. Load WASM module (reuse existing pico-vm.wasm + pico-vm.mjs)
2. Compile .bas → bytecode (or load .game directly)
3. vm_init() + vm_load_program()
4. setInterval at ~60fps (16.67ms):
   a. vm_set_input(consumeInputWord())
   b. vm_set_elapsed_ms(elapsed)
   c. vm_exec_frame()
   d. vm_audio_cmd_clear()  (discard audio — no sound in terminal)
   e. Read framebuffer, render to terminal
5. On Ctrl+C: restore terminal, exit
```

## File Structure

```
terminal/
├── PLAN.md          (this file)
└── pico-term.ts     (single-file CLI runner)
```

Run with: `npx tsx terminal/pico-term.ts [file.bas|file.game]`

## Dependencies

- Reuses existing `web/src/wasm/pico-vm.mjs` + `pico-vm.wasm` (already built)
- Reuses existing `web/src/basic/compiler.ts` and `web/src/assembler/assembler.ts`
- No new npm packages needed — just Node built-ins (fs, stdin, process)

## Steps

1. **Create `terminal/pico-term.ts`** — single file with:
   - WASM loading (copy pattern from wasm-vm.ts Node path)
   - BASIC compiler integration (import from web/src/basic)
   - Framebuffer → terminal renderer
   - Raw stdin input handler
   - 60fps game loop via setInterval

2. **Test with bouncing-dot.bas** — simplest case, no input needed

3. **Test with the pong demo** — validates keyboard input (Q/E for encoder)

4. **Test with muncher.bas** — full game stress test

## Open Questions

- Terminal width: most terminals are 80 cols. 128 chars won't fit.
  Options: (a) require wide terminal, (b) skip every other column (64-wide),
  (c) scale down. Recommend (a) — most modern terminals can do 128+ cols.
- Color: could use ANSI colors to make it green-on-black like the OLED.
  Simple: `\x1b[32m` for green foreground, `\x1b[40m` for black background.
- Frame rate: Node setInterval isn't precise at 16ms. Could use a
  busy-wait loop with process.hrtime for accuracy, but setInterval is
  probably fine for a demo.
