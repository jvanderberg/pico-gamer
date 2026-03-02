# Pico-Gamer BASIC Language & VM Reference

## 1. Platform Overview

Pico-Gamer is an RP2040-based handheld gaming platform with a web emulator. BASIC programs are compiled to assembly, then assembled into bytecode that runs on a 16-bit stack-based virtual machine.

### Display

- **Resolution:** 128 x 64 pixels
- **Color depth:** 1-bit (monochrome -- white on black)
- **Framebuffer:** 1024 bytes, row-major, MSB-first within each byte
- **Target frame rate:** 60 fps

### Hardware Model (Emulated)

| Component | Details |
|---|---|
| Screen | SH1106 1.3" OLED, 128x64 monochrome |
| Joystick | KY-023 (4-direction + button click) |
| Rotary encoder | CW, CCW, and button press |
| Audio | SID-style 3-voice synthesizer (stubbed in web emulator) |

### Keyboard Mapping (Web Emulator)

| Input | Keys |
|---|---|
| Up | Arrow Up, W |
| Down | Arrow Down, S |
| Left | Arrow Left, A |
| Right | Arrow Right, D |
| Button (BTN) | K |
| Encoder CW | Q, L |
| Encoder CCW | E, J |
| Encoder Button | Space, Tab |

---

## 2. BASIC Language Reference

### 2.1 Variables and Types

All values are **unsigned 16-bit integers** (0--65535). There are no floating-point numbers or strings as first-class runtime values. Signed arithmetic is handled via two's complement: values 0x8000--0xFFFF represent -32768 to -1. Comparisons (`<`, `>`, `<=`, `>=`) use **signed** semantics.

Variables are case-insensitive, auto-allocated at addresses starting from `0xC100`, and occupy 2 bytes each (little-endian). Variable names may contain letters, digits, and underscores, and must begin with a letter or underscore.

```basic
x = 42
myVar = 0
score = score + 100
```

### 2.2 Numeric Literals

| Format | Example | Notes |
|---|---|---|
| Decimal | `42`, `0`, `65535` | Standard integers |
| Hex (`$` prefix) | `$FF`, `$C000` | BASIC-style hex |
| Hex (`0x` prefix) | `0xFF`, `0xC000` | C-style hex |
| Negative | `-1`, `-100` | Unary minus, stored as two's complement (`-1` = `65535`) |

All literals are masked to 16 bits (`& 0xFFFF`).

### 2.3 Constants

```basic
CONST MAX_SPEED = 100
CONST TILE_SIZE = 8
```

- Declared with `CONST name = value`.
- Value must be a compile-time numeric literal or expression that reduces to a literal.
- Constants are inlined as immediate values (no memory allocation).
- User constants can override built-in constants.

### 2.4 Arrays

```basic
DIM enemies(10)       ' Declare array of 10 elements
enemies(0) = 42       ' Set element
x = enemies(3)        ' Read element
```

- Declared with `DIM name(size)`.
- Size must be a numeric literal.
- Elements are 16-bit (2 bytes each), zero-indexed.
- Indices are computed at runtime; no bounds checking.
- Arrays are allocated contiguously in the variable region.

### 2.5 DATA Blocks

DATA blocks embed raw byte sequences into the program binary, primarily for bitmap graphics and vector sprite data.

```basic
DATA ship_gfx, $3C, $7E, $FF, $FF, $7E, $3C
DATA bullet, $C0, $C0
```

- Syntax: `DATA name, byte1, byte2, ...`
- Each byte value is masked to 8 bits (`& 0xFF`).
- The name becomes a label that resolves to the address of the first byte.
- Use the name as a variable in expressions to get its address:
  ```basic
  SPRITE 0, ship_gfx, 8, 8, 60, 30, 0, 0, 0, EDGE_NONE
  x = PEEK(ship_gfx)    ' Read first byte of data
  ```

### 2.6 String Literals

String literals are only valid as arguments to `TEXT_SM` and `TEXT_LG`. They are stored as null-terminated byte sequences in the data section.

```basic
TEXT_SM "HELLO", 10, 20
TEXT_LG "GAME OVER", 37, 20
```

### 2.7 Comments

```basic
' This is a comment (apostrophe style)
REM This is also a comment
x = 42  ' Inline comment after code
```

### 2.8 Statement Separator

A colon (`:`) can separate multiple statements on the same line:

```basic
x = 1 : y = 2 : z = x + y
```

### 2.9 Labels and GOTO

Labels and `GOTO` exist but are rarely needed. Prefer `SUB`/`CALL` for subroutines and `DO`/`FOR` for loops.

```basic
myLabel:
x = x + 1
IF x < 10 THEN GOTO myLabel
```

- Labels are identifiers immediately followed by `:` (no space).
- `GOTO label` -- unconditional jump.

---

## 3. Operators

### 3.1 Operator Precedence (lowest to highest)

| Precedence | Operators | Type |
|---|---|---|
| 1 (lowest) | `OR` | Bitwise/logical OR |
| 2 | `XOR` | Bitwise/logical XOR |
| 3 | `AND` | Bitwise/logical AND |
| 4 | `NOT` | Unary bitwise/logical NOT |
| 5 | `=`, `<>`, `<`, `>`, `<=`, `>=` | Comparison (signed) |
| 6 | `SHL`, `SHR` | Bit shift |
| 7 | `+`, `-` | Addition, subtraction |
| 8 | `*`, `DIV`, `MOD` | Multiply, integer divide, modulo |
| 9 (highest) | Unary `-` | Negation |

### 3.2 Arithmetic Operators

| Operator | Syntax | Description |
|---|---|---|
| `+` | `a + b` | Addition (wraps at 16 bits) |
| `-` | `a - b` | Subtraction (wraps at 16 bits) |
| `*` | `a * b` | Multiplication (wraps at 16 bits) |
| `DIV` | `a DIV b` | Unsigned integer division (division by zero halts the VM) |
| `MOD` | `a MOD b` | Unsigned modulo (modulo by zero halts the VM) |
| `-` (unary) | `-a` | Two's complement negation |

### 3.3 Comparison Operators

All comparisons return `1` (true) or `0` (false). The `<`, `>`, `<=`, `>=` operators use **signed** comparison (values >= 0x8000 are treated as negative).

| Operator | Syntax | Description |
|---|---|---|
| `=` | `a = b` | Equal |
| `<>` | `a <> b` | Not equal |
| `<` | `a < b` | Less than (signed) |
| `>` | `a > b` | Greater than (signed) |
| `<=` | `a <= b` | Less than or equal (signed) |
| `>=` | `a >= b` | Greater than or equal (signed) |

### 3.4 Bitwise / Logical Operators

These operators work on 16-bit values bitwise. Since true = 1 and false = 0, they double as logical operators.

| Operator | Syntax | Description |
|---|---|---|
| `AND` | `a AND b` | Bitwise AND |
| `OR` | `a OR b` | Bitwise OR |
| `XOR` | `a XOR b` | Bitwise XOR |
| `NOT` | `NOT a` | Bitwise NOT (complement all 16 bits) |
| `SHL` | `a SHL b` | Logical shift left by b bits |
| `SHR` | `a SHR b` | Logical shift right by b bits (zero-fill) |

**Note:** `SHR` is an unsigned (logical) right shift. For arithmetic (sign-preserving) right shift, use the `ASHR()` function.

---

## 4. Control Flow

### 4.1 IF / ELSEIF / ELSE / END IF

**Single-line form:**

```basic
IF condition THEN statement
IF condition THEN statement ELSE statement
```

**Block form:**

```basic
IF condition THEN
  ' statements
ELSEIF condition THEN
  ' statements
ELSE
  ' statements
END IF
```

- Conditions are expressions: zero = false, non-zero = true.
- `ELSEIF` and `ELSE` are optional.
- Block form requires `END IF` to close.

### 4.2 FOR / NEXT

```basic
FOR i = start TO end
  ' body
NEXT

FOR i = 0 TO 100 STEP 5
  ' body (i = 0, 5, 10, ..., 100)
NEXT
```

- `STEP` is optional (default is 1).
- The loop variable is tested at the top: if `var > to` (signed), the loop exits.
- `EXIT FOR` breaks out of the innermost FOR loop.

### 4.3 DO / LOOP

**Infinite loop:**

```basic
DO
  ' body
LOOP
```

**Pre-tested (test at top):**

```basic
DO WHILE condition
  ' body
LOOP

DO UNTIL condition
  ' body
LOOP
```

**Post-tested (test at bottom):**

```basic
DO
  ' body
LOOP WHILE condition

DO
  ' body
LOOP UNTIL condition
```

- `WHILE` continues while the condition is true (non-zero).
- `UNTIL` continues until the condition becomes true (non-zero).
- `EXIT DO` breaks out of the innermost DO loop.

### 4.4 EXIT

```basic
EXIT FOR    ' Break out of innermost FOR loop
EXIT DO     ' Break out of innermost DO loop
```

---

## 5. Subroutines

### 5.1 SUB / END SUB

```basic
SUB myFunction(param1, param2)
  ' body -- can use param1, param2 as variables
  result = param1 + param2
END SUB
```

**Calling a SUB:**

```basic
myFunction 10, 20          ' Arguments passed as comma-separated values
```

- Parameters are passed by writing to the parameter variables before calling.
- Return values must be communicated through shared variables (no explicit return value).
- SUBs are compiled into a separate section; they do not execute inline.
- SUB names are case-insensitive for calling.
- No parentheses on the call site (they are used only in the declaration).

### 5.2 CALLBACK / END CALLBACK

Callbacks are special subroutines called by the sprite engine when collision events occur.

```basic
CALLBACK on_hit(slot)
  SPR_POS slot, RAND() MOD 100, RAND() MOD 50
END CALLBACK
```

- Declared like SUB but with `CALLBACK` / `END CALLBACK`.
- The name becomes an addressable label you can pass to `SPR_ON_HIT`.
- On invocation by the engine, the callback receives the sprite slot index as its parameter.
- Callbacks have a cycle budget of 5,000 VM instructions per invocation.

**Registering a callback:**

```basic
SPR_ON_HIT 0, on_hit       ' Register on_hit for sprite slot 0
```

---

## 6. Memory Access

### 6.1 POKE / POKE16

Write a value directly to a memory address:

```basic
POKE $C000, 42         ' Write byte (8-bit) to address $C000
POKE16 $C000, 1000     ' Write word (16-bit, little-endian) to address $C000
```

### 6.2 PEEK / PEEK16

Read a value from a memory address (used in expressions):

```basic
x = PEEK($C000)        ' Read byte (8-bit) from address $C000
y = PEEK16($C000)      ' Read word (16-bit, little-endian) from address $C000
```

---

## 7. Drawing Syscalls

All drawing targets the 128x64 monochrome framebuffer. Pixel coordinates are unsigned 16-bit. Pixels drawn outside the screen (0--127, 0--63) are silently clipped.

The framebuffer is **automatically cleared** at the start of each game frame. Sprites are drawn **after** your frame code runs. So your drawing code adds to a clean framebuffer each frame.

### 7.1 CLEAR

```basic
CLEAR
```

Fills the entire framebuffer with black (all zeros). This is normally done automatically each frame, so explicit CLEAR is only needed for special cases.

### 7.2 PIXEL

```basic
PIXEL x, y, color
```

Set a single pixel. `color`: 1 = white (on), 0 = black (off).

### 7.3 LINE

```basic
LINE y0, x0, y1, x1
```

Draw a white line from (x0, y0) to (x1, y1) using Bresenham's algorithm.

**Important:** The argument order is `y0, x0, y1, x1` (not x0, y0, x1, y1). This is due to the internal push order used by the compiler.

### 7.4 RECT

```basic
RECT x, y, w, h
```

Draw a filled white rectangle with top-left corner at (x, y), width w, height h.

### 7.5 BLIT

```basic
BLIT addr, x, y, w, h
```

Copy a 1-bit bitmap from memory address `addr` to position (x, y) with dimensions w x h. Only "on" pixels are drawn (transparent background).

**Bitmap format:** Row-aligned, MSB-first. Each row occupies `ceil(w / 8)` bytes. Bit 7 (MSB) of the first byte corresponds to the leftmost pixel.

Example: a 5x3 bitmap occupies 1 byte per row (3 bytes total):

```
Byte: 0xF8  →  #####...  (top 5 bits used, low 3 bits ignored)
Byte: 0x88  →  #...#...
Byte: 0xF8  →  #####...
```

### 7.6 TEXT_SM

```basic
TEXT_SM "HELLO", x, y
TEXT_SM stringAddr, x, y
```

Draw text using the **small font** (3x5 pixels per glyph, 4-pixel advance). Supports printable ASCII 32--126 (uppercase A-Z, digits, and common punctuation). Only white pixels are drawn (transparent background).

### 7.7 TEXT_LG

```basic
TEXT_LG "GAME OVER", x, y
TEXT_LG stringAddr, x, y
```

Draw text using the **large font** (5x7 pixels per glyph, 6-pixel advance). Same character coverage as TEXT_SM.

### 7.8 TEXT_NUM

```basic
TEXT_NUM value, x, y
```

Draw an integer value as text at (x, y) using the small font. The value is converted to its decimal string representation at runtime.

---

## 8. Sprite System

The engine manages up to **32 sprite slots** (0--31). Active sprites are automatically moved by their velocity, checked for collisions, and drawn to the framebuffer every frame, after your BASIC code yields.

### 8.1 SPRITE -- Create/Configure a Sprite

```basic
SPRITE slot, addr, w, h, x, y, flags, vx, vy, edge
```

| Arg | Description |
|---|---|
| `slot` | Sprite slot index (0--31) |
| `addr` | Memory address of bitmap or vector data (typically a DATA label) |
| `w` | Width in pixels (bounding box for vector sprites) |
| `h` | Height in pixels |
| `x` | Initial X position (pixels) |
| `y` | Initial Y position (pixels) |
| `flags` | Sprite flags (see below) |
| `vx` | Horizontal velocity (signed, see velocity units below) |
| `vy` | Vertical velocity (signed) |
| `edge` | Edge behavior mode (see edge modes below) |

A newly created sprite is immediately **active** and **visible**.

### 8.2 Sprite Flags

| Constant | Value | Description |
|---|---|---|
| `SPR_FLIPX` | 1 | Flip sprite horizontally |
| `SPR_FLIPY` | 2 | Flip sprite vertically |
| `SPR_VECTOR` | 4 | Sprite uses vector line data instead of bitmap |

Combine with OR: `SPR_FLIPX OR SPR_FLIPY` = `3`.

### 8.3 Velocity Units

Velocity uses a fixed-point system where **64 = 1 pixel per frame** at 60 fps.

| Velocity | Speed |
|---|---|
| 64 | 1 px/frame (60 px/sec) |
| 32 | 0.5 px/frame |
| 128 | 2 px/frame |
| -64 | 1 px/frame leftward/upward |

Use negative values for leftward or upward movement.

### 8.4 Bitmap Format (for sprites)

Same row-aligned, MSB-first format as BLIT:

- Each row is `ceil(width / 8)` bytes.
- Bit 7 of the first byte = leftmost pixel of the row.
- Only "on" bits draw white; "off" bits are transparent.

Example: An 8x8 diamond shape:

```basic
DATA diamond, $18, $3C, $7E, $FF, $FF, $7E, $3C, $18
SPRITE 0, diamond, 8, 8, 60, 28, 0, 0, 0, EDGE_NONE
```

Example: A 16x2 wide sprite (2 bytes per row):

```basic
DATA wide, $FF, $FF, $FF, $FF
SPRITE 0, wide, 16, 2, 0, 0, 0, 0, 0, EDGE_NONE
```

### 8.5 Vector Sprite Format

When `SPR_VECTOR` (bit 2) is set in flags, the addr points to vector line segment data instead of a bitmap.

**Data format:**

```
Byte 0:       N (number of line segments)
Bytes 1..4N:  N segments, each 4 bytes: x1, y1, x2, y2
```

Each coordinate is a **signed 4.4 fixed-point** byte relative to the sprite center:
- High nibble = integer part (signed, two's complement over 8 bits)
- Low nibble = fractional part (1/16 pixel)
- Range: approximately -8.0 to +7.9375 pixels from center

Example: A triangle ship (3 line segments):

```basic
' nose=(0,-3), left=(-2,2), right=(2,2)
DATA ship_vecs, 3, $00,$D0,$E0,$20, $E0,$20,$20,$20, $20,$20,$00,$D0
SPRITE 0, ship_vecs, 7, 7, 62, 30, SPR_VECTOR, 0, 0, EDGE_WRAP
```

Vector sprites support rotation (via `SPR_ROT`) and participate in pixel-perfect collision detection through runtime rasterization.

### 8.6 Sprite Position and Velocity

```basic
SPR_POS slot, x, y          ' Set position
SPR_VEL slot, vx, vy        ' Set velocity
x, y = SPR_GET(slot)         ' Get current position (tuple assign)
```

### 8.7 SPR_OFF -- Deactivate a Sprite

```basic
SPR_OFF slot
```

Deactivates the sprite. It will no longer move, collide, or draw.

### 8.8 SPR_VIS -- Set Visibility

```basic
SPR_VIS slot, visible
```

Set whether the sprite is drawn. `1` = visible, `0` = hidden. A hidden sprite still moves and participates in collisions; it is just not rendered.

### 8.9 Edge Modes

```basic
SPR_EDGE slot, mode
```

Controls what happens when a sprite reaches the screen boundary.

| Constant | Value | Behavior |
|---|---|---|
| `EDGE_NONE` | 0 | No edge behavior; sprite can leave the screen |
| `EDGE_WRAP` | 1 | Wrap around to the opposite edge |
| `EDGE_BOUNCE` | 2 | Bounce off edges, reversing velocity |
| `EDGE_DESTROY` | 3 | Deactivate when fully off-screen |
| `EDGE_STOP` | 4 | Clamp to edge and zero velocity |

When a bounce, destroy, or stop occurs, the sprite's `hitFlags` bit 0 is set.

### 8.10 Rotation

```basic
SPR_ROT slot, angle, rotSpeed
```

| Arg | Description |
|---|---|
| `angle` | Current rotation angle, 0--255 (256 steps = 360 degrees) |
| `rotSpeed` | Angular velocity (signed, same fixed-point as linear velocity: 64 = full revolution per second) |

```basic
angle = SPR_GETROT(slot)     ' Get current angle (0-255)
```

The rotation system uses a quarter-wave sine lookup table for efficient fixed-point rotation. Angle 0 = no rotation, 64 = 90 degrees, 128 = 180 degrees, 192 = 270 degrees.

### 8.11 Wall Collisions

```basic
SPR_WALL slot, mode
```

Sets the collision response when this sprite overlaps a wall rectangle.

| Constant | Value | Behavior |
|---|---|---|
| `COLL_NONE` | 0 | No wall collision |
| `COLL_DETECT` | 1 | Detect only (set hitFlags, no physics response) |
| `COLL_BOUNCE` | 2 | Bounce off wall, reversing velocity on collision axis |
| `COLL_DESTROY` | 3 | Deactivate sprite on wall contact |
| `COLL_STOP` | 4 | Stop at wall, zero velocity on collision axis |

When a wall collision occurs, hitFlags bit 1 is set and hitIndex is the wall slot.

### 8.12 Sprite-Sprite Collisions

```basic
SPR_COLL slot, mode
```

Sets the collision response when this sprite overlaps another sprite.

Same mode constants as wall collisions (COLL_NONE through COLL_STOP). When a sprite collision occurs, hitFlags bit 2 is set and hitIndex is the other sprite's slot.

For non-rotated sprites, collision uses AABB (axis-aligned bounding box) overlap. For rotated sprites, after the AABB pre-check passes, **pixel-perfect** collision detection is used.

### 8.13 Collision Groups

```basic
SPR_GROUP slot, group, mask
```

| Arg | Description |
|---|---|
| `group` | 8-bit bitmask: which groups this sprite belongs to |
| `mask` | 8-bit bitmask: which groups this sprite can collide with |

Two sprites A and B only test for collision if `(A.group AND B.mask) OR (B.group AND A.mask)` is non-zero. Default: group = 0xFF, mask = 0xFF (collides with everything).

Example -- bullets hit asteroids but not each other:

```basic
SPR_GROUP bulletSlot, 4, 2    ' Group 4 (bullets), mask 2 (hits asteroids only)
SPR_GROUP asteroidSlot, 2, 4  ' Group 2 (asteroids), mask 4 (hit by bullets only)
```

### 8.14 Hit Detection

```basic
result = SPR_HIT(slot)
```

Returns a packed 16-bit value encoding the most recent collision info:

- **Low byte** (bits 0-7): `hitFlags`
  - Bit 0: Edge/border hit
  - Bit 1: Wall hit
  - Bit 2: Sprite hit
- **High byte** (bits 8-15): `hitIndex` -- slot index of the last wall or sprite involved

```basic
hit = SPR_HIT(0)
IF hit AND 4 THEN           ' Sprite collision occurred
  other = hit SHR 8         ' Get the other sprite's slot
END IF
```

Hit flags are cleared at the start of each frame.

### 8.15 Hit Callbacks

```basic
SPR_ON_HIT slot, callbackName
```

Registers a CALLBACK to be invoked automatically when the sprite's hitFlags are non-zero after physics. The callback receives the sprite slot as its parameter.

```basic
CALLBACK on_hit(slot)
  SPR_POS slot, RAND() MOD 120, RAND() MOD 56
END CALLBACK

SPR_ON_HIT 0, on_hit
```

Callbacks run during the sprite update phase with a budget of 5,000 VM cycles.

### 8.16 Frame Lifecycle

Each game frame proceeds in this order:

1. **Framebuffer cleared** (all pixels set to black)
2. **VM executes** up to 50,000 cycles or until YIELD
3. **Sprite physics** -- positions updated from velocities
4. **Wall collisions** resolved
5. **Sprite-sprite collisions** resolved
6. **Edge behaviors** applied
7. **Hit callbacks** invoked for any sprites with non-zero hitFlags
8. **Sprites drawn** to framebuffer (active and visible sprites only)
9. **Particles updated** -- continuous emitters spawn, velocity/gravity applied, life decremented
10. **Particles drawn** to framebuffer (on top of sprites)
11. **Framebuffer rendered** to canvas

---

## 9. Wall System

Walls are invisible collision rectangles (up to **16 slots**, 0--15). Sprites can collide with walls based on their `wallMode`.

### 9.1 WALL_SET

```basic
WALL_SET slot, x, y, w, h
```

Define a wall rectangle at position (x, y) with width w and height h.

### 9.2 WALL_OFF

```basic
WALL_OFF slot
```

Deactivate a wall slot.

To make walls visible, draw rectangles at the same coordinates in your frame loop:

```basic
WALL_SET 0, 30, 0, 4, 64
DO
  RECT 30, 0, 4, 64        ' Draw visible representation
  YIELD
LOOP
```

---

## 10. Particle System

The engine provides a native particle system for visual effects like explosions, rocket exhaust, and fireworks. It runs entirely in native code, so games get rich effects with minimal VM overhead -- one syscall to configure an emitter, one to trigger a burst.

**4 emitters, 128 particles.** Particles are transient (no collision, no callbacks). They are drawn after sprites (on top).

### 10.1 PFX_SET -- Configure an Emitter

```basic
PFX_SET slot, speed, life, spread, direction, gravity, flags
```

| Arg | Description |
|---|---|
| `slot` | Emitter slot (0--3) |
| `speed` | Particle speed (0--255, same units as sprite velocity: 64 = 1 px/frame) |
| `life` | Particle lifetime in frames (1--255) |
| `spread` | Cone half-angle (0 = focused beam, 128 = full circle) |
| `direction` | Center angle (0--255, same as sprite rotation: 0 = right, 64 = down, 128 = left, 192 = up) |
| `gravity` | Y acceleration per frame (signed: positive = down, negative = up) |
| `flags` | Emitter flags (see below) |

### 10.2 PFX_POS -- Set Emitter Position

```basic
PFX_POS slot, x, y
```

Sets the source position for particles spawned from this emitter.

### 10.3 PFX_BURST -- Spawn a Burst

```basic
PFX_BURST slot, count
```

Immediately spawns `count` particles from emitter `slot`. Particles that exceed the 128-particle pool are silently dropped.

### 10.4 PFX_ON -- Continuous Emission

```basic
PFX_ON slot, rate
```

Sets the emitter to continuously spawn `rate` particles per frame. Set `rate` to 0 to stop.

### 10.5 PFX_CLEAR -- Clear Particles

```basic
PFX_CLEAR slot
```

Clears emitter `slot` and kills all its particles. Use `PFX_CLEAR PFX_ALL` to clear all emitters and particles.

### 10.6 Particle Flags

| Constant | Value | Description |
|---|---|---|
| `PFX_2X2` | 4 | Draw particles as 2x2 pixels instead of 1x1 |
| `PFX_BLACK` | 8 | Draw black particles (eraser effect) |
| `PFX_SPEED_VAR` | 16 | Randomize speed +/- 25% |
| `PFX_LIFE_VAR` | 32 | Randomize lifetime +/- 25% |
| `PFX_ALL` | 255 | Used with PFX_CLEAR to clear all emitters |

Combine with OR: `PFX_2X2 OR PFX_SPEED_VAR OR PFX_LIFE_VAR` = `52`.

### 10.7 Particle Physics

- Velocity uses the same fixed-point system as sprites (64 = 1 px/frame)
- Gravity is applied every frame: `vy += gravity`
- Particles flicker (alternate visible/invisible) in the last 3 frames of life for a fade effect
- Particles have no collision detection -- they are purely visual

### 10.8 Examples

**Explosion:**

```basic
PFX_SET 0, 80, 20, 128, 0, 1, PFX_SPEED_VAR OR PFX_LIFE_VAR
PFX_POS 0, 64, 32
PFX_BURST 0, 30
```

**Rocket exhaust (continuous):**

```basic
PFX_SET 1, 40, 15, 10, 192, 0, PFX_LIFE_VAR
PFX_POS 1, ship_x, ship_y + 4
PFX_ON 1, 2
```

---

## 11. Input

### 11.1 INPUT() Function

```basic
inp = INPUT()
```

Returns a 16-bit input word:
- Low byte (`bits 0-7`): button bitfield.
- High byte (`bits 8-15`): signed encoder delta (accumulated detents for this frame, `+` CW / `-` CCW).

### 11.2 Input Constants

| Constant | Value | Bit | Input |
|---|---|---|---|
| `INPUT_UP` | 1 | 0 | Joystick up |
| `INPUT_DOWN` | 2 | 1 | Joystick down |
| `INPUT_LEFT` | 4 | 2 | Joystick left |
| `INPUT_RIGHT` | 8 | 3 | Joystick right |
| `INPUT_BTN` | 16 | 4 | Joystick button |
| `INPUT_ENC_CW` | 32 | 5 | Rotary encoder clockwise |
| `INPUT_ENC_CCW` | 64 | 6 | Rotary encoder counter-clockwise |
| `INPUT_ENC_BTN` | 128 | 7 | Rotary encoder button |
| `INPUT_ENC_DELTA_SHIFT` | 8 | — | Right-shift amount to read signed encoder delta from INPUT() |
| `INPUT_ENC_DELTA_MASK` | 65280 | — | Mask for encoder delta byte (`0xFF00`) |

### 11.3 Testing Input

Use bitwise AND to test individual buttons:

```basic
inp = INPUT()
IF inp AND INPUT_UP THEN y = y - 1
IF inp AND INPUT_DOWN THEN y = y + 1
IF inp AND INPUT_LEFT THEN x = x - 1
IF inp AND INPUT_RIGHT THEN x = x + 1
IF inp AND INPUT_BTN THEN fire
IF inp AND INPUT_ENC_BTN THEN action
```

Read full encoder movement (including multiple detents in one frame):

```basic
inp = INPUT()
enc_delta = ASHR(inp, INPUT_ENC_DELTA_SHIFT)  ' signed: +CW / -CCW
angle = (angle + enc_delta * 4) AND 255
```

---

## 12. Math and Utility Functions

### 12.1 RAND()

```basic
x = RAND()
```

Returns a random unsigned 16-bit value (0--65535).

For a range, use MOD:

```basic
x = RAND() MOD 100         ' 0 to 99
x = RAND() MOD 128         ' 0 to 127 (full screen X)
```

### 12.2 TIME()

```basic
t = TIME()
```

Returns milliseconds elapsed since program start, masked to 16 bits (wraps every ~65.5 seconds).

### 12.3 SIN(angle)

```basic
s = SIN(angle)
```

Lookup-table sine function. Angle is 0--255 (256 steps = 360 degrees). Returns an unsigned byte 0--255 representing the sine value:

- 0 = sin(0) = 0
- 64 = sin(90 deg) = 127
- 128 = sin(180 deg) = 0
- 192 = sin(270 deg) = 129 (i.e., -127 as unsigned byte)

The returned value represents `sin(angle) * 127`, stored as an unsigned byte. Values >= 128 represent negative results (use `IF val >= 128 THEN val = val - 256` to get the signed value).

### 12.4 COS(angle)

```basic
c = COS(angle)
```

Same as SIN but offset by 64 (90 degrees): `COS(angle) = SIN(angle + 64)`.

### 12.5 ABS(value)

```basic
x = ABS(y)
```

Returns the absolute value. If the value is negative (bit 15 set, i.e., >= 0x8000), it is negated.

### 12.6 ASHR(value, bits)

```basic
x = ASHR(value, bits)
```

**Arithmetic shift right.** Shifts `value` right by `bits` positions, preserving the sign bit. This is the signed equivalent of `SHR`.

```basic
x = ASHR(256, 2)       ' = 64 (positive: same as SHR)
x = ASHR(-256, 2)      ' = -64 (sign preserved, stored as 0xFFC0)
```

### 12.7 FX_MUL(a, b, q)

```basic
x = FX_MUL(a, b, q)
```

**Fixed-point multiply.** Computes `(a * b) >> q` with both `a` and `b` treated as signed 16-bit values. The result is masked to 16 bits.

This is essential for fixed-point arithmetic where you need to multiply two values and then shift down to maintain the correct scale.

```basic
' Apply drag: velocity *= 250/256
ship_vx = FX_MUL(ship_vx, 250, 8)

' Scale a trig value
delta = FX_MUL(cos_val, 5, 5)
```

---

## 13. Control Flow Syscalls

### 13.1 YIELD

```basic
YIELD
```

Signals the end of one frame of game logic. The runtime will:

1. Update sprite positions and physics
2. Run hit callbacks
3. Draw sprites to the framebuffer
4. Render to screen
5. Wait for the next 60fps tick
6. Clear the framebuffer
7. Resume BASIC execution

Every game loop **must** call YIELD once per frame. Without it, the VM runs until its 50,000-cycle budget is exhausted.

### 13.2 HALT

```basic
HALT
```

Stops the VM permanently. The program ends. (A HALT is also automatically appended at the end of every BASIC program.)

---

## 14. Tile System (Stubbed)

The following syscalls are defined but **not yet implemented** in the web emulator:

| Syscall | ID | Purpose |
|---|---|---|
| `TILESET` | 0x07 | Load tileset graphics |
| `TILEMAP` | 0x08 | Set tile map |
| `SCROLL` | 0x09 | Set scroll offset |

These are reserved for future implementation.

---

## 15. Built-in Constants Reference

All of these constants are available without declaration:

### Input

| Name | Value |
|---|---|
| `INPUT_UP` | 1 |
| `INPUT_DOWN` | 2 |
| `INPUT_LEFT` | 4 |
| `INPUT_RIGHT` | 8 |
| `INPUT_BTN` | 16 |
| `INPUT_ENC_CW` | 32 |
| `INPUT_ENC_CCW` | 64 |
| `INPUT_ENC_BTN` | 128 |

### Edge Modes

| Name | Value |
|---|---|
| `EDGE_NONE` | 0 |
| `EDGE_WRAP` | 1 |
| `EDGE_BOUNCE` | 2 |
| `EDGE_DESTROY` | 3 |
| `EDGE_STOP` | 4 |

### Collision / Wall Modes

| Name | Value |
|---|---|
| `COLL_NONE` | 0 |
| `COLL_DETECT` | 1 |
| `COLL_BOUNCE` | 2 |
| `COLL_DESTROY` | 3 |
| `COLL_STOP` | 4 |

### Sprite Flags

| Name | Value |
|---|---|
| `SPR_FLIPX` | 1 |
| `SPR_FLIPY` | 2 |
| `SPR_VECTOR` | 4 |

### Particle Flags

| Name | Value |
|---|---|
| `PFX_ALL` | 255 |
| `PFX_2X2` | 4 |
| `PFX_BLACK` | 8 |
| `PFX_SPEED_VAR` | 16 |
| `PFX_LIFE_VAR` | 32 |

---

## 16. VM Architecture

### 16.1 Overview

BASIC programs are compiled through a three-stage pipeline:

1. **BASIC source** -- compiled to assembly text (lexer, parser, codegen)
2. **Assembly text** -- assembled to bytecode (two-pass assembler)
3. **Bytecode** -- executed by the 16-bit stack VM

### 16.2 Memory

- **64 KB** flat address space (`0x0000`--`0xFFFF`)
- **Little-endian** byte order
- Program bytecode is loaded at address `0x0000`
- Variables are auto-allocated starting at `0xC100` (2 bytes each)
- Arrays are allocated contiguously after regular variables
- DATA blocks and string literals are placed in the data section (between the JMP to main and the main code)

### 16.3 Stack

- Separate 256-entry operand stack (not in main memory)
- 16-bit entries
- Stack overflow or underflow halts the VM with an error

### 16.4 Cycle Budget

- **50,000 cycles per frame** -- the VM executes up to this many instructions between YIELDs
- **5,000 cycles per hit callback** invocation

### 16.5 Opcodes

The VM supports the following opcodes. BASIC programs never need to use these directly, but they are listed for reference and debugging.

**Stack manipulation:**

| Opcode | Hex | Operand | Description |
|---|---|---|---|
| HALT | 0x00 | -- | Stop execution |
| NOP | 0x01 | -- | No operation |
| PUSH8 | 0x02 | u8 | Push 8-bit immediate |
| PUSH16 | 0x03 | u16 | Push 16-bit immediate |
| POP | 0x04 | -- | Discard top of stack |
| DUP | 0x05 | -- | Duplicate top of stack |
| SWAP | 0x06 | -- | Swap top two entries |
| OVER | 0x07 | -- | Copy second entry to top |

**Arithmetic:**

| Opcode | Hex | Description |
|---|---|---|
| ADD | 0x10 | a + b |
| SUB | 0x11 | a - b |
| MUL | 0x12 | a * b |
| DIV | 0x13 | a / b (unsigned) |
| MOD | 0x14 | a % b (unsigned) |
| NEG | 0x15 | Two's complement negate |

**Bitwise:**

| Opcode | Hex | Description |
|---|---|---|
| AND | 0x20 | a & b |
| OR | 0x21 | a \| b |
| XOR | 0x22 | a ^ b |
| NOT | 0x23 | ~a (complement) |
| SHL | 0x24 | a << b |
| SHR | 0x25 | a >>> b (logical, zero-fill) |

**Comparison (push 1 for true, 0 for false):**

| Opcode | Hex | Description |
|---|---|---|
| EQ | 0x30 | a == b |
| LT | 0x31 | a < b (unsigned) |
| GT | 0x32 | a > b (unsigned) |
| LTS | 0x33 | a < b (signed) |
| GTS | 0x34 | a > b (signed) |

**Control flow:**

| Opcode | Hex | Operand | Description |
|---|---|---|---|
| JMP | 0x40 | u16 | Unconditional jump |
| JZ | 0x41 | u16 | Jump if top of stack == 0 |
| JNZ | 0x42 | u16 | Jump if top of stack != 0 |
| CALL | 0x43 | u16 | Push return address, jump |
| RET | 0x44 | -- | Pop return address, jump |

**Memory (absolute address in operand):**

| Opcode | Hex | Operand | Description |
|---|---|---|---|
| LOAD | 0x50 | u16 | Push 16-bit word from address |
| STORE | 0x51 | u16 | Pop and store 16-bit word at address |
| LOAD8 | 0x52 | u16 | Push byte from address |
| STORE8 | 0x53 | u16 | Pop and store byte at address |

**Memory (address on stack):**

| Opcode | Hex | Description |
|---|---|---|
| LOAD_IDX | 0x54 | Pop address, push 16-bit word |
| STORE_IDX | 0x55 | Pop address, pop value, store 16-bit word |
| LOAD8_IDX | 0x56 | Pop address, push byte |
| STORE8_IDX | 0x57 | Pop address, pop value, store byte |

**System:**

| Opcode | Hex | Operand | Description |
|---|---|---|---|
| SYSCALL | 0x60 | u8 | Invoke syscall by ID |

### 16.6 Program Structure (Generated)

The compiler generates the following layout:

```
  JMP __main              ; Skip over data and subs
; --- data ---
__data_mysprite:          ; DATA blocks
  .data ...
__str_0:                  ; String literals
  .data 72, 105, 0        ; "Hi\0"
; --- subs ---
__sub_myfunc:             ; SUB bodies
  ...
  RET
__cb_on_hit:              ; CALLBACK bodies
  STORE <retAddr>
  STORE <slot>
  ...
  LOAD <retAddr>
  RET
; --- main ---
__main:                   ; Main program code
  ...
  HALT
```

---

## 17. Syscall Reference

This is the complete list of syscall IDs. BASIC programs call these through the language statements and functions documented above.

| ID | Name | BASIC Syntax | Args (from stack, top first) | Returns |
|---|---|---|---|---|
| 0x00 | CLEAR | `CLEAR` | -- | -- |
| 0x01 | PIXEL | `PIXEL x, y, color` | color, y, x | -- |
| 0x02 | LINE | `LINE y0, x0, y1, x1` | x1, y1, x0, y0 | -- |
| 0x03 | RECT | `RECT x, y, w, h` | h, w, y, x | -- |
| 0x05 | BLIT | `BLIT addr, x, y, w, h` | h, w, y, x, addr | -- |
| 0x06 | YIELD | `YIELD` | -- | -- |
| 0x10 | INPUT | `INPUT()` | -- | bitfield |
| 0x20 | RAND | `RAND()` | -- | u16 |
| 0x21 | TIME | `TIME()` | -- | u16 (ms) |
| 0x22 | SIN | `SIN(angle)` | angle | u8 |
| 0x23 | COS | `COS(angle)` | angle | u8 |
| 0x24 | TEXT_SM | `TEXT_SM str, x, y` | y, x, addr | -- |
| 0x25 | TEXT_LG | `TEXT_LG str, x, y` | y, x, addr | -- |
| 0x26 | TEXT_NUM | `TEXT_NUM val, x, y` | y, x, value | -- |
| 0x27 | ASHR | `ASHR(val, bits)` | bits, val | i16 |
| 0x28 | FX_MUL | `FX_MUL(a, b, q)` | q, b, a | i16 |
| 0x40 | SPR_SET | `SPRITE slot, addr, w, h, x, y, flags, vx, vy, edge` | edge, vy, vx, flags, y, x, h, w, addr, slot | -- |
| 0x41 | SPR_POS | `SPR_POS slot, x, y` | y, x, slot | -- |
| 0x42 | SPR_VEL | `SPR_VEL slot, vx, vy` | vy, vx, slot | -- |
| 0x43 | SPR_GET | `x, y = SPR_GET(slot)` | slot | x, y |
| 0x44 | SPR_OFF | `SPR_OFF slot` | slot | -- |
| 0x45 | SPR_EDGE | `SPR_EDGE slot, mode` | mode, slot | -- |
| 0x46 | SPR_WALL | `SPR_WALL slot, mode` | mode, slot | -- |
| 0x47 | SPR_COLL | `SPR_COLL slot, mode` | mode, slot | -- |
| 0x48 | WALL_SET | `WALL_SET slot, x, y, w, h` | h, w, y, x, slot | -- |
| 0x49 | WALL_OFF | `WALL_OFF slot` | slot | -- |
| 0x4A | SPR_HIT | `SPR_HIT(slot)` | slot | (hitIndex<<8)\|hitFlags |
| 0x4B | SPR_GROUP | `SPR_GROUP slot, group, mask` | mask, group, slot | -- |
| 0x4C | SPR_ON_HIT | `SPR_ON_HIT slot, addr` | addr, slot | -- |
| 0x4D | SPR_ROT | `SPR_ROT slot, angle, speed` | speed, angle, slot | -- |
| 0x4E | SPR_GETROT | `SPR_GETROT(slot)` | slot | angle (0-255) |
| 0x4F | SPR_VIS | `SPR_VIS slot, visible` | visible, slot | -- |
| 0x50 | PFX_SET | `PFX_SET slot, speed, life, spread, dir, gravity, flags` | flags, gravity, dir, spread, life, speed, slot | -- |
| 0x51 | PFX_POS | `PFX_POS slot, x, y` | y, x, slot | -- |
| 0x52 | PFX_BURST | `PFX_BURST slot, count` | count, slot | -- |
| 0x53 | PFX_ON | `PFX_ON slot, rate` | rate, slot | -- |
| 0x54 | PFX_CLEAR | `PFX_CLEAR slot` | slot | -- |

---

## 18. Complete Examples

### 18.1 Bouncing Dot

The simplest possible game -- a single pixel that bounces around the screen. The sprite engine handles all movement and drawing.

```basic
DATA dot_gfx, $80

SPRITE 0, dot_gfx, 1, 1, 10, 5, 0, 64, 64, EDGE_BOUNCE

DO
  YIELD
LOOP
```

### 18.2 Input Test

Move a block with the joystick.

```basic
x = 60
y = 28

DO
  inp = INPUT()
  IF inp AND INPUT_UP THEN y = y - 1
  IF inp AND INPUT_DOWN THEN y = y + 1
  IF inp AND INPUT_LEFT THEN x = x - 1
  IF inp AND INPUT_RIGHT THEN x = x + 1
  RECT x, y, 4, 4
  YIELD
LOOP
```

### 18.3 Sprites with Collision Groups

Multiple sprites with walls, different collision groups, and a hit callback.

```basic
DATA big_circle, $07,$E0,$1F,$F8,$3F,$FC,$7F,$FE,$7F,$FE,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$7F,$FE,$7F,$FE,$3F,$FC,$1F,$F8,$07,$E0
DATA diamond_gfx, $18,$3C,$7E,$FF,$FF,$7E,$3C,$18
DATA square_gfx, $FF,$81,$81,$81,$81,$81,$81,$FF

CALLBACK square_hit(slot)
  SPR_POS slot, RAND() MOD 112, RAND() MOD 48
END CALLBACK

' Walls
WALL_SET 0, 30, 0, 4, 64
WALL_SET 1, 94, 0, 4, 64

' Big circle -- bounces off walls and edges
SPRITE 0, big_circle, 16, 16, 50, 10, 0, 32, 48, EDGE_BOUNCE
SPR_WALL 0, COLL_BOUNCE
SPR_COLL 0, COLL_BOUNCE
SPR_GROUP 0, 1, $FF

' Diamond -- wraps at edges, ignores walls
SPRITE 1, diamond_gfx, 8, 8, 60, 5, 0, 128, -64, EDGE_WRAP
SPR_COLL 1, COLL_BOUNCE
SPR_GROUP 1, 2, $FF

' Square -- detect-only + hit callback
SPRITE 2, square_gfx, 8, 8, 60, 40, 0, -64, -64, EDGE_BOUNCE
SPR_COLL 2, COLL_DETECT
SPR_GROUP 2, 1, $FF
SPR_ON_HIT 2, square_hit

DO
  RECT 30, 0, 4, 64
  RECT 94, 0, 4, 64
  YIELD
LOOP
```

### 18.4 Starfield

Dithered background with scrolling stars and bouncing balls. All movement is handled by the sprite engine -- zero per-frame CPU cost.

```basic
DATA dither, $55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$55,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA,$AA
DATA star_gfx, $80
DATA ball8, $3C,$7E,$FF,$FF,$FF,$FF,$7E,$3C
DATA ball12, $0F,$00,$3F,$C0,$7F,$E0,$7F,$E0,$FF,$F0,$FF,$F0,$FF,$F0,$FF,$F0,$7F,$E0,$7F,$E0,$3F,$C0,$0F,$00

' Initialize balls (slots 0-4)
FOR i = 0 TO 4
  bw = 8
  gfx = ball8
  IF RAND() AND 1 THEN
    bw = 12
    gfx = ball12
  END IF

  bx = bw + RAND() MOD (128 - 2 * bw)
  by = bw + RAND() MOD (64 - 2 * bw)

  vx = 64 + RAND() MOD 192
  IF RAND() AND 1 THEN vx = 0 - vx
  vy = 64 + RAND() MOD 128
  IF RAND() AND 1 THEN vy = 0 - vy

  SPRITE i, gfx, bw, bw, bx, by, 0, vx, vy, EDGE_BOUNCE
NEXT

' Initialize stars (slots 5-31)
FOR i = 5 TO 31
  sx = RAND() MOD 128
  sy = RAND() MOD 64
  speed = 0 - (64 + RAND() MOD 192)
  SPRITE i, star_gfx, 1, 1, sx, sy, 0, speed, 0, EDGE_WRAP
NEXT

' Main loop -- just draw the dither background each frame
DO
  FOR y = 0 TO 62 STEP 2
    BLIT dither, 0, y, 128, 2
  NEXT
  YIELD
LOOP
```
