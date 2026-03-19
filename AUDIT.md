# Pico Gamer — Code Audit

_March 2026 (updated after tilemap/animation/camera commits)_

Overall this is a well-engineered project. Clean architecture, good separation of concerns, strict TypeScript config, proper bounds checking in the VM core. The recent tilemap, camera, animation, and muncher game additions are substantial and mostly solid, but they introduce several new issues worth addressing.

---

## Critical / High Priority

### 1. Duplicate syscall ID: SYS_SCROLL and SYS_TILE_PROP both = 0x09
**`vm/lib/pico_vm/syscalls.h:20-21`**

Two enum values share the same ID. In the switch dispatch, whichever case appears first wins; the other is dead code. If SCROLL was intended as a stub to be replaced by TILE_PROP, the old entry should be removed. As-is, this is a silent conflict.

### 2. Tilemap memory access has no address masking
**`vm/lib/pico_vm/sprites.cpp:651, 662`**

`mem[tm.mapAddr + r * tm.mapW + c]` and `mem + tm.tilesetAddr + tileIdx * TILE_BYTES` index into the VM's 64KB memory without `& 0xFFFF` masking. If `mapAddr + row * width + col` exceeds 65535, this reads out of bounds of the actual memory array. The rest of the VM is careful about this; the new tilemap code isn't.

### 3. Vector sprite memory access is unbounded
**`vm/lib/pico_vm/sprites.cpp:322-327, 425-430`**

`spr.addr` comes from user bytecode and indexes directly into VM memory with no validation on the line count `n` or resulting addresses. A malformed vector sprite definition can read arbitrary memory. The same decode logic is duplicated between `rasterizeVectorSprite()` and `drawVectorSprite()`.

### 4. Particle emitter position truncated by double int16_t cast
**`vm/lib/pico_vm/syscalls.cpp:514-515`**

```cpp
ctx.particles->emitters[slot].x_fp = (int16_t)((int16_t)x << 8);
```

The inner `(int16_t)x` promotes to `int` for the shift, but the outer `(int16_t)` cast truncates the result back to 16 bits. For any x >= 128, the high bits are lost. The emitter fields are `int32_t`, so the outer cast should be removed:
```cpp
ctx.particles->emitters[slot].x_fp = ((int16_t)x) << 8;
```

### 5. BASIC codegen has no memory bounds check
**`web/src/basic/codegen.ts:807-811`**

`emitDim()` increments `nextVarAddr` without checking whether allocation exceeds the 64KB address space. Multiple large arrays silently overflow past 0xFFFF.

### 6. SUB call silently truncates extra arguments
**`web/src/basic/codegen.ts:965`**

`Math.min(stmt.args.length, params.length)` means calling a SUB with too many or too few arguments compiles without error. Extra args are silently dropped; missing args leave stack garbage in the parameter slots. Should be a compile error.

---

## Medium Priority

### 7. VM-SPEC.md is significantly out of date

Multiple issues:
- Section 5.4.5 says audio syscalls 0x30–0x3F are "stubs/NOPs." In reality, 12 fully-implemented audio syscalls exist.
- Tile syscalls 0x07–0x0B are documented as stubs but are now fully implemented.
- Particle syscalls (0x50–0x54), camera syscalls (0x60–0x64), and sprite animation/direction syscalls (0x55–0x57) aren't documented at all.
- BASIC-REFERENCE.md and AUDIO-DESIGN.md are correct — just VM-SPEC that's behind.

### 8. ~~Syscall dispatch has no null guards on context pointers~~ [WONTFIX]

`ctx.fb`, `ctx.sprites`, `ctx.walls` are always initialized by `createSyscallContext`. `ctx.viewport` and `ctx.tilemap` already have null guards where used. The runtime always initializes all fields. Not a real risk.

### 9. ~~Audio command buffer silently drops overflow~~ [WONTFIX]

Intentional design for a real-time audio ring buffer on a microcontroller. Silent drop is the correct behavior — the alternative (blocking or error) would be worse.

### 10. ~~Engine audio draining doesn't validate memory addresses~~ [WONTFIX]

On closer inspection, `vm.readMem()` already does `addr & 0xFFFF` masking. Effect `count` is `uint8_t` (max 255). All address arithmetic uses `& 0xffff`. Already safe.

### 11. [x] Parser lookahead safety
**`web/src/basic/parser.ts:818, 897`**

~~`parseEffect()` and `parseSong()` while-loops use `tokens[pos + 1]?.type` with optional chaining but rely on `peek()` which uses `!` assertion. An unexpected EOF could cause issues.~~

Fixed: added `peek() !== TokenType.EOF` guard to both while-loops.

### 12. [x] DIM array size not validated at parse time
**`web/src/basic/parser.ts:739`**

~~`parseInt(sizeTok.value, 0)` accepts 0, negative, or values > 65535 with no bounds check. Combined with issue #5, this means `DIM x(40000)` compiles and overflows silently.~~

Fixed: DIM size now validated at parse time (must be 1–65535).

---

## Low Priority / Code Quality

### 13. ~~Duplicate vector sprite decode~~ [WONTFIX]
The two functions (`rasterizeVectorSprite` and `drawVectorSprite`) share a 5-line preamble but do fundamentally different things with the results (buffer vs framebuffer). Extracting a helper would require a callback/visitor pattern — more complexity than the duplication warrants.

### 14. [x] Duplicate emitter reset logic
**`vm/lib/pico_vm/particles.cpp`**

~~`resetParticleTable` and the per-slot clear in `clearParticles` both zero out the same emitter fields identically.~~

Fixed: extracted `resetEmitter()` helper, used by both `resetParticleTable` and `clearParticles`.

### 15. [x] Magic numbers for sprite flags
**`vm/lib/pico_vm/sprites.h`, `sprites.cpp`**

~~`(a.flags & 4)` checks for vector sprites throughout collision code.~~

Fixed: added `SPRITE_FLAG_FLIPX`, `SPRITE_FLAG_FLIPY`, `SPRITE_FLAG_VECTOR` constants in `sprites.h`. All usages in `sprites.cpp` now use named constants.

### 16. [x] Edge/collision mode enums are bare integers
**`vm/lib/pico_vm/sprites.h`**

~~Edge behavior (0=none, 1=wrap, 2=bounce, 3=destroy, 4=stop) is documented in a comment but uses raw `uint8_t`.~~

Fixed: added `EDGE_NONE/WRAP/BOUNCE/DESTROY/STOP`, `COLL_NONE/DETECT/BOUNCE/DESTROY/STOP`, and `HIT_BORDER/WALL/SPRITE` constants. All magic numbers in `applyCollisionMode` and `applyEdgeBehavior` replaced.

### 17. O(n²) collision detection
Fine for 32 sprites, but the pixel-perfect overlap test with rotated vector sprites is expensive. No spatial partitioning. Acceptable at current scale.

### 18. [x] No test coverage for tilemap system
~~The new `drawTileMap()`, `resolveTileCollisions()`, tile property syscalls, and camera syscalls have no native test coverage.~~

Fixed: 26 native tests added in `test_tilemap/test_tilemap.cpp`.

### 19. [x] No test coverage for sprite animation
~~`SPR_ANIM`, `SPR_IMG`, `SPR_DIR` syscalls and the animation tick logic in `updateSprites()` are untested.~~

Fixed: covered by the new tilemap test suite (test_sprite_animation_advances_frames, test_spr_img_changes_bitmap, test_spr_dir_sets_cardinal_velocity, test_syscall_spr_anim, test_syscall_spr_dir).

### 20. [x] Assembler .ORG allows negative addresses
**`web/src/assembler/assembler.ts:56-58`**

~~`parseInt(line.slice(5).trim(), 0)` accepts negative numbers, which would corrupt address calculations.~~

Fixed: `.org` now validates address is 0–65535.

### 21. Audio gesture listener cleanup
**`web/src/audio/audio-manager.ts:109-120`**

Uses `{ once: true }` but the cleanup path for non-triggered listeners on component unmount is unclear.

### 22. muncher.bas ghost count is hardcoded
**`web/examples/muncher.bas:46-50`**

Ghost arrays use literal `4` in 15+ places. Should be a `CONST GHOST_COUNT = 4`.

---

## What's Done Well

- **VM core safety**: stack overflow/underflow halts, division-by-zero halts, 16-bit address masking on all core memory ops
- **TypeScript strictness**: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noFallthroughCasesInSwitch` — all strict flags enabled
- **Tilemap architecture**: clean separation of map data, tile properties, and rendering; animated tiles are simple and effective
- **Camera system**: smooth camera follow with configurable dead zone and world bounds, well-integrated with sprite and tilemap rendering
- **Sprite animation**: frame-based animation with configurable rate, clean tick/advance logic
- **Hardware abstraction**: display format conversion isolated to firmware, VM core is hardware-agnostic
- **WASM bridge**: proper bounds checking on all sprite accessors, correct fixed memory size (8MB, no growth), good emscripten workarounds
- **Flash/USB safety**: deferred write queue prevents ISR-context flash operations, RMW cache for erases
- **Audio architecture**: AudioWorklet isolation, 6-voice SID-style synth, command buffer with overflow protection, proper browser gesture handling
- **Fixed-point math**: consistent 24.8 for sprites, 8.8 for particles, with conversion helpers
- **BASIC compiler pipeline**: clean lexer → parser → codegen → assembler chain, proper error propagation, constant folding with division-by-zero protection
- **muncher.bas**: impressive 800-line Pac-Man implementation demonstrating the full tilemap/camera/collision/animation stack

---

## Recommended Priority

1. [x] Fix the duplicate `SYS_SCROLL`/`SYS_TILE_PROP` enum (trivial, high risk if SCROLL is ever used)
2. [x] Add `& 0xFFFF` masking to tilemap memory access
3. [x] Add bounds validation to vector sprite memory access
4. [x] Fix the `int16_t` double-cast in `SYS_PFX_POS`
5. [x] Add memory overflow check in `emitDim()` codegen
6. [x] Make SUB arg count mismatch a compile error
7. [x] Update VM-SPEC.md to document all implemented syscalls
8. [x] Add native tests for tilemap, camera, and sprite animation (26 tests)

The biggest theme is that new tilemap/camera code doesn't follow the same defensive patterns (address masking, bounds checks) that the original VM core does. Worth a pass to bring it up to the same standard.
