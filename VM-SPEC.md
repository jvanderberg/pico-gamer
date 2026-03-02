# Pico-Gamer VM: Technical Implementation Specification

This document specifies the pico-gamer virtual machine with enough precision to reimplement it from scratch in any language. All opcode values, stack effects, memory layouts, and syscall numbers are exact.

---

## 1. Memory Model

### 1.1 Address Space

- **Total size**: 65,536 bytes (64 KB), configurable at creation but 64 KB is the default.
- **Address width**: 16-bit unsigned. All addresses are masked with `0xFFFF` on every access, so the address space wraps around.
- **Endianness**: Little-endian for all multi-byte values (both in-memory data and instruction operands).

### 1.2 Memory Layout

The memory is a flat, unprotected byte array. There is no MMU, no memory protection, and no hardware-enforced segmentation. Code and data share the same address space and are freely interleaved.

In practice, the BASIC compiler uses this layout convention:

| Region | Address Range | Purpose |
|--------|--------------|---------|
| Code entry | `0x0000` | Program starts executing here (PC initial value = 0). The BASIC compiler emits `JMP __main` at address 0. |
| Data section | After the initial JMP | `.data` blocks (sprite bitmaps, string literals) placed by the assembler. |
| Subroutines | After data | `SUB` and `CALLBACK` bodies, ending with `RET`. |
| Main code | After subs | The `__main:` label — the main program body. |
| Variables | `0xC100` upward | Auto-allocated scalar variables (2 bytes each) and arrays (2 bytes per element). The BASIC codegen allocates starting at `0xC100` and grows upward. |

This layout is a convention of the BASIC compiler, not enforced by the VM. Hand-written assembly can use any layout.

### 1.3 Memory Access Functions

```
readU8(mem, addr)   → mem[addr & 0xFFFF]
writeU8(mem, addr, val) → mem[addr & 0xFFFF] = val & 0xFF

readU16(mem, addr)  → mem[addr & 0xFFFF] | (mem[(addr+1) & 0xFFFF] << 8)   // little-endian
writeU16(mem, addr, val) →
    mem[addr & 0xFFFF]       = val & 0xFF
    mem[(addr+1) & 0xFFFF]   = (val >> 8) & 0xFF
```

### 1.4 Program Loading

Programs are loaded as raw bytecode at a base address (default 0). The `loadProgram(mem, program, baseAddr)` function simply copies the bytecode byte array into memory starting at `baseAddr`.

---

## 2. Registers / VM State

The VM has no general-purpose registers. All computation is done on the stack. The complete VM state is:

| Field | Type | Initial Value | Description |
|-------|------|--------------|-------------|
| `memory` | `uint8[65536]` | All zeros | Flat memory array |
| `stack` | `uint16[256]` | All zeros | Operand stack (separate from memory) |
| `pc` | `uint16` | `0` | Program counter — address of next instruction to fetch |
| `sp` | `uint16` | `0` | Stack pointer — index into the stack array. Points to the next empty slot (grows upward). `sp=0` means empty, `sp=1` means one item. |
| `halted` | `bool` | `false` | Set to `true` on HALT, stack overflow/underflow, division by zero, or unknown opcode. Once halted, `step()` returns false immediately. |
| `cycles` | `uint32+` | `0` | Monotonically increasing instruction counter. Incremented by 1 for each instruction dispatched (including HALT, NOP). |

### 2.1 The Stack

The stack is a **separate array of 256 uint16 entries**, completely independent from the 64 KB memory. It is NOT located in the memory address space. The stack cannot be addressed by LOAD/STORE instructions.

- **Growth direction**: Upward. `sp` starts at 0 (empty) and increments on push.
- **Push**: `stack[sp] = value & 0xFFFF; sp++`
- **Pop**: `sp--; return stack[sp]`
- **Peek**: `return stack[sp - 1]` (returns 0 if `sp == 0`)
- **Overflow**: If `sp >= stack.length` (256) during push, the VM halts with an error.
- **Underflow**: If `sp <= 0` during pop, the VM halts with an error.

All values on the stack are unsigned 16-bit integers (`0x0000`–`0xFFFF`). Signed interpretation is only applied by specific opcodes (LTS, GTS, NEG) using two's complement.

### 2.2 Call Stack

There is **no separate call stack**. Return addresses are pushed onto the operand stack by `CALL` and popped by `RET`. This means:
- Subroutine arguments and return addresses share the same stack.
- A subroutine must clean up any values it pushed before executing `RET`, or the return address will be wrong.
- The BASIC compiler's CALLBACK mechanism manually saves and restores the return address to a memory variable to work around this.

### 2.3 PC Behavior

- The PC is a 16-bit unsigned integer, masked with `0xFFFF` after every increment.
- On reset, PC = 0. Execution begins at address 0.
- The PC advances past instruction bytes as they are fetched (see Section 4).

---

## 3. Instruction Set

### 3.1 Encoding Summary

Every instruction begins with a 1-byte opcode. Some opcodes are followed by an inline operand of 1 or 2 bytes. The total instruction length is `1 + operand_size`.

| Operand Size | Opcodes |
|-------------|---------|
| 0 bytes (opcode only) | HALT, NOP, POP, DUP, SWAP, OVER, ADD, SUB, MUL, DIV, MOD, NEG, AND, OR, XOR, NOT, SHL, SHR, EQ, LT, GT, LTS, GTS, RET, LOAD_IDX, STORE_IDX, LOAD8_IDX, STORE8_IDX |
| 1 byte (uint8 operand) | PUSH8, SYSCALL |
| 2 bytes (uint16 LE operand) | PUSH16, JMP, JZ, JNZ, CALL, LOAD, STORE, LOAD8, STORE8 |

### 3.2 Stack Manipulation

#### HALT (0x00)
- Encoding: `[0x00]` (1 byte)
- Stack: `[] -> []`
- Sets `vm.halted = true`. `step()` returns `false`.

#### NOP (0x01)
- Encoding: `[0x01]` (1 byte)
- Stack: `[] -> []`
- No operation.

#### PUSH8 (0x02)
- Encoding: `[0x02, imm8]` (2 bytes)
- Stack: `[] -> [imm8]`
- Pushes the unsigned 8-bit immediate value (0–255) onto the stack as a 16-bit value.

#### PUSH16 (0x03)
- Encoding: `[0x03, lo, hi]` (3 bytes)
- Stack: `[] -> [imm16]`
- Reads a 16-bit little-endian immediate (`lo | (hi << 8)`) and pushes it onto the stack.

#### POP (0x04)
- Encoding: `[0x04]` (1 byte)
- Stack: `[a] -> []`
- Discards the top of stack.

#### DUP (0x05)
- Encoding: `[0x05]` (1 byte)
- Stack: `[a] -> [a, a]`
- Duplicates the top of stack (uses peek, so returns 0 if stack is empty without erroring).

#### SWAP (0x06)
- Encoding: `[0x06]` (1 byte)
- Stack: `[a, b] -> [b, a]`
- Swaps the top two elements. Implementation: pops b, pops a, pushes b, pushes a.

#### OVER (0x07)
- Encoding: `[0x07]` (1 byte)
- Stack: `[a, b] -> [a, b, a]`
- Copies the second element to the top. Implementation: pops b, pops a, pushes a, pushes b, pushes a.

### 3.3 Arithmetic

All arithmetic operates on unsigned 16-bit values. Results are masked with `0xFFFF`. The operand order is: `a` is pushed first (deeper), `b` is pushed second (on top). Pop order is always b first, then a.

#### ADD (0x10)
- Encoding: `[0x10]` (1 byte)
- Stack: `[a, b] -> [(a + b) & 0xFFFF]`

#### SUB (0x11)
- Encoding: `[0x11]` (1 byte)
- Stack: `[a, b] -> [(a - b) & 0xFFFF]`
- Note: subtracts b from a (not a from b). If a < b, the result wraps around (two's complement).

#### MUL (0x12)
- Encoding: `[0x12]` (1 byte)
- Stack: `[a, b] -> [(a * b) & 0xFFFF]`
- The intermediate product may exceed 16 bits; only the low 16 bits are kept.

#### DIV (0x13)
- Encoding: `[0x13]` (1 byte)
- Stack: `[a, b] -> [(a / b) >>> 0]`
- **Unsigned** integer division (truncated toward zero).
- **Division by zero**: Halts the VM with an error. Sets `vm.halted = true` and throws.
- The result is forced to unsigned 32-bit via `>>> 0`, then masked to 16 bits by the push.

#### MOD (0x14)
- Encoding: `[0x14]` (1 byte)
- Stack: `[a, b] -> [a % b]`
- Unsigned modulo.
- **Division by zero**: Halts the VM with an error.

#### NEG (0x15)
- Encoding: `[0x15]` (1 byte)
- Stack: `[a] -> [(-a) & 0xFFFF]`
- Two's complement negation. `NEG(0) = 0`, `NEG(1) = 0xFFFF`, `NEG(0x8000) = 0x8000`.

### 3.4 Bitwise Operations

#### AND (0x20)
- Encoding: `[0x20]` (1 byte)
- Stack: `[a, b] -> [a & b]`

#### OR (0x21)
- Encoding: `[0x21]` (1 byte)
- Stack: `[a, b] -> [a | b]`

#### XOR (0x22)
- Encoding: `[0x22]` (1 byte)
- Stack: `[a, b] -> [a ^ b]`

#### NOT (0x23)
- Encoding: `[0x23]` (1 byte)
- Stack: `[a] -> [(~a) & 0xFFFF]`
- Bitwise complement, masked to 16 bits.

#### SHL (0x24)
- Encoding: `[0x24]` (1 byte)
- Stack: `[a, b] -> [(a << b) & 0xFFFF]`
- Shift `a` left by `b` bits. Result masked to 16 bits.

#### SHR (0x25)
- Encoding: `[0x25]` (1 byte)
- Stack: `[a, b] -> [(a >>> b) & 0xFFFF]`
- **Unsigned** (logical) right shift. Zeros are shifted in from the left. Result masked to 16 bits.

### 3.5 Comparison

All comparisons push `1` for true, `0` for false.

#### EQ (0x30)
- Encoding: `[0x30]` (1 byte)
- Stack: `[a, b] -> [a == b ? 1 : 0]`

#### LT (0x31)
- Encoding: `[0x31]` (1 byte)
- Stack: `[a, b] -> [a < b ? 1 : 0]`
- **Unsigned** comparison. Both operands are treated as values in `0`–`65535`.

#### GT (0x32)
- Encoding: `[0x32]` (1 byte)
- Stack: `[a, b] -> [a > b ? 1 : 0]`
- **Unsigned** comparison.

#### LTS (0x33)
- Encoding: `[0x33]` (1 byte)
- Stack: `[a, b] -> [signed(a) < signed(b) ? 1 : 0]`
- **Signed** comparison. Both operands are interpreted as signed 16-bit two's complement integers (range -32768 to 32767) using: `signed(v) = v >= 0x8000 ? v - 0x10000 : v`.

#### GTS (0x34)
- Encoding: `[0x34]` (1 byte)
- Stack: `[a, b] -> [signed(a) > signed(b) ? 1 : 0]`
- **Signed** comparison, same interpretation as LTS.

### 3.6 Control Flow

#### JMP (0x40)
- Encoding: `[0x40, lo, hi]` (3 bytes)
- Stack: `[] -> []`
- Unconditional jump. Sets `pc = lo | (hi << 8)`.
- The address is fetched from the instruction stream (2 bytes, little-endian) BEFORE the jump. The PC is advanced past the operand bytes during fetch, then overwritten with the target address.

#### JZ (0x41)
- Encoding: `[0x41, lo, hi]` (3 bytes)
- Stack: `[cond] -> []`
- Jump if zero. Fetches the 16-bit address, then pops `cond`. If `cond == 0`, sets `pc = addr`. Otherwise, execution continues at the next instruction.

#### JNZ (0x42)
- Encoding: `[0x42, lo, hi]` (3 bytes)
- Stack: `[cond] -> []`
- Jump if not zero. Fetches the 16-bit address, then pops `cond`. If `cond != 0`, sets `pc = addr`.

#### CALL (0x43)
- Encoding: `[0x43, lo, hi]` (3 bytes)
- Stack: `[] -> [return_addr]`
- Subroutine call. Fetches the 16-bit target address from the instruction stream. At this point, PC has already advanced past the 3-byte CALL instruction, so PC points to the instruction after CALL. Pushes the current PC (return address) onto the stack, then sets `pc = addr`.
- **Important**: The return address pushed is the address of the instruction immediately AFTER the CALL instruction.

#### RET (0x44)
- Encoding: `[0x44]` (1 byte)
- Stack: `[return_addr] -> []`
- Return from subroutine. Pops the return address from the stack and sets `pc = popped_value`.

### 3.7 Memory Access — Absolute Address

These instructions take a 16-bit address as an inline operand in the instruction stream.

#### LOAD (0x50)
- Encoding: `[0x50, lo, hi]` (3 bytes)
- Stack: `[] -> [value16]`
- Reads a 16-bit little-endian value from memory at the inline address and pushes it.

#### STORE (0x51)
- Encoding: `[0x51, lo, hi]` (3 bytes)
- Stack: `[value] -> []`
- Pops a value and writes it as a 16-bit little-endian value to the inline address.

#### LOAD8 (0x52)
- Encoding: `[0x52, lo, hi]` (3 bytes)
- Stack: `[] -> [value8]`
- Reads a single byte from memory at the inline address and pushes it (zero-extended to 16 bits).

#### STORE8 (0x53)
- Encoding: `[0x53, lo, hi]` (3 bytes)
- Stack: `[value] -> []`
- Pops a value and writes the low byte (`value & 0xFF`) to the inline address.

### 3.8 Memory Access — Indexed (Stack-Addressed)

These instructions take the address from the stack, not from the instruction stream. They have no inline operands.

#### LOAD_IDX (0x54)
- Encoding: `[0x54]` (1 byte)
- Stack: `[addr] -> [value16]`
- Pops `addr`, reads a 16-bit little-endian value from `memory[addr]`, pushes the result.

#### STORE_IDX (0x55)
- Encoding: `[0x55]` (1 byte)
- Stack: `[value, addr] -> []`
- Pops `addr` (top), then pops `value` (below). Writes `value` as 16-bit little-endian to `memory[addr]`.
- **Pop order matters**: address is on TOP, value is below. This matches the natural order when computing an address after a value expression.

#### LOAD8_IDX (0x56)
- Encoding: `[0x56]` (1 byte)
- Stack: `[addr] -> [value8]`
- Pops `addr`, reads a single byte from `memory[addr]`, pushes it (zero-extended).

#### STORE8_IDX (0x57)
- Encoding: `[0x57]` (1 byte)
- Stack: `[value, addr] -> []`
- Pops `addr` (top), then pops `value` (below). Writes `value & 0xFF` to `memory[addr]`.

### 3.9 Syscall

#### SYSCALL (0x60)
- Encoding: `[0x60, id]` (2 bytes)
- Stack: depends on the syscall (see Section 5)
- Fetches the 1-byte syscall ID from the instruction stream, then invokes the syscall handler with that ID and the VM state. The handler reads arguments from the stack (via pop) and may push return values.

---

## 4. Instruction Encoding Details

### 4.1 Fetch Cycle

Each `step()` call:
1. If `vm.halted`, return `false` immediately.
2. Fetch the opcode byte: `opcode = memory[pc]; pc = (pc + 1) & 0xFFFF`.
3. Increment `vm.cycles` by 1.
4. Dispatch on `opcode`. During dispatch, any inline operands are fetched by further advancing PC.
5. Return `!vm.halted`.

### 4.2 Operand Fetch

- **fetchU8()**: Reads `memory[pc]`, advances `pc` by 1 (masked to 16 bits). Returns a `uint8`.
- **fetchU16()**: Reads `memory[pc]` (low byte) and `memory[pc+1]` (high byte), advances `pc` by 2 (masked to 16 bits). Returns `lo | (hi << 8)` as a `uint16`.

### 4.3 Multi-byte Operand Byte Order

All multi-byte operands in the instruction stream are **little-endian**: low byte first, high byte second.

For example, `PUSH16 0x1234` encodes as: `[0x03, 0x34, 0x12]`.

### 4.4 Immediate Encoding by the Assembler

The assembler selects PUSH8 or PUSH16 based on value range:
- Values `0`–`255` use `PUSH8` (2 bytes total).
- Values `256`–`65535` use `PUSH16` (3 bytes total).

Label references always use 16-bit operands because addresses can be anywhere in the 64 KB space.

---

## 5. Syscall Mechanism

### 5.1 Invocation

A syscall is triggered by the `SYSCALL` instruction:
1. The VM fetches a 1-byte syscall ID from the instruction stream.
2. The VM calls `syscallHandler(id, vm)`.
3. The handler pops arguments from the VM stack and may push return values.

### 5.2 Argument Convention

Arguments are pushed onto the stack **before** the SYSCALL instruction executes. The handler pops them in **reverse order** (last argument pushed is popped first). From the handler's perspective, popping retrieves arguments from right to left.

For syscalls invoked from BASIC, the BASIC compiler pushes arguments in a specific order (sometimes reordered via `pushOrder`) so that the C handler can pop them in a natural order.

### 5.3 Return Values

Syscalls that return a value push the result onto the stack before returning. Syscalls that return multiple values (tuples) push all values; the caller pops them in reverse order.

### 5.4 Complete Syscall Table

#### 5.4.1 Display Syscalls

| ID | Name | Args (pop order) | Stack Effect | Description |
|----|------|-------------------|-------------|-------------|
| `0x00` | CLEAR | (none) | `[] -> []` | Clears the framebuffer (all pixels to 0). |
| `0x01` | PIXEL | pop color, pop y, pop x | `[x, y, color] -> []` | Sets pixel at (x,y) to color (0 or 1). |
| `0x02` | LINE | pop x1, pop y1, pop x0, pop y0 | `[y0, x0, y1, x1] -> []` | Draws a Bresenham line from (x0,y0) to (x1,y1), color=1. Note the push order from BASIC: `y0, x0, y1, x1` (BASIC uses `pushOrder: [1,0,3,2]` to reorder `LINE x0,y0,x1,y1`). |
| `0x03` | RECT | pop h, pop w, pop y, pop x | `[x, y, w, h] -> []` | Draws a filled rectangle at (x,y) with dimensions w*h, color=1. |
| `0x04` | SPRITE (raw) | pop flags, pop y, pop x, pop height, pop width, pop addr | `[addr, width, height, x, y, flags] -> []` | Draws a 1-bit sprite from memory address `addr`. Bitmap is row-major, MSB-first, `ceil(width/8)` bytes per row. Flags: bit 0 = flip X, bit 1 = flip Y. |
| `0x05` | BLIT | pop h, pop w, pop y, pop x, pop srcAddr | `[srcAddr, x, y, w, h] -> []` | Blits a 1-bit bitmap from memory to the framebuffer. Format same as SPRITE. |
| `0x24` | TEXT_SM | pop y, pop x, pop strAddr | `[strAddr, x, y] -> []` | Draws a null-terminated ASCII string from memory address `strAddr` at (x,y) using the small 3x5 font, 4px advance. |
| `0x25` | TEXT_LG | pop y, pop x, pop strAddr | `[strAddr, x, y] -> []` | Draws text using the large 5x7 font, 6px advance. |
| `0x26` | TEXT_NUM | pop y, pop x, pop value | `[value, x, y] -> []` | Converts `value` to its decimal string representation and draws it at (x,y) using the small 3x5 font. |

#### 5.4.2 System Syscalls

| ID | Name | Args (pop order) | Stack Effect | Description |
|----|------|-------------------|-------------|-------------|
| `0x06` | YIELD | (none) | `[] -> []` | Signals the runtime to end the current frame. Sets `yieldRequested = true` in the syscall context. The runtime loop checks this flag after each step and breaks out of the per-frame cycle loop. |
| `0x10` | INPUT | (none) | `[] -> [bits]` | Pushes the current input bitfield (8 bits, see below). |
| `0x20` | RAND | (none) | `[] -> [value]` | Pushes a random 16-bit unsigned value (0–65535). |
| `0x21` | TIME | (none) | `[] -> [elapsed]` | Pushes elapsed milliseconds since program start, masked to 16 bits (`& 0xFFFF`). Wraps every ~65.5 seconds. |
| `0x22` | SIN | pop angle | `[angle] -> [result]` | Lookup table sin. `angle` is masked to 8 bits (0–255, where 256 = full circle). Returns `sin(angle * 2*PI/256) * 127`, stored as an unsigned byte in a 256-entry LUT. The result is a value 0–255 representing a signed quantity (use two's complement interpretation to get -127 to +127). |
| `0x23` | COS | pop angle | `[angle] -> [result]` | Same as SIN but looks up `(angle + 64) & 0xFF` in the same table (90-degree phase shift). |
| `0x27` | ASHR | pop bits, pop value | `[value, bits] -> [result]` | Arithmetic (signed) right shift. Interprets `value` as signed i16, shifts right by `bits`, result masked to 16 bits. Sign bit is preserved. |
| `0x28` | FX_MUL | pop q, pop b, pop a | `[a, b, q] -> [result]` | Fixed-point multiply. Interprets `a` and `b` as signed i16, computes `(a * b) >> q`, result masked to 16 bits. `q` is the number of fractional bits. |

#### 5.4.3 Tile Syscalls (Stubs)

These are defined but currently stubbed — they pop one argument and discard it:

| ID | Name | Stack Effect | Description |
|----|------|-------------|-------------|
| `0x07` | TILESET | `[arg] -> []` | Stub. |
| `0x08` | TILEMAP | `[arg] -> []` | Stub. |
| `0x09` | SCROLL | `[arg] -> []` | Stub. |
| `0x0A` | SPRITE_OVER | `[arg] -> []` | Stub. |

#### 5.4.4 Sprite Engine Syscalls

The sprite engine manages up to 32 sprite slots (indices 0–31) and 16 wall slots (indices 0–15). Sprites are updated once per frame by the runtime, not by the VM directly.

| ID | Name | Args (pop order) | Stack Effect | Description |
|----|------|-------------------|-------------|-------------|
| `0x40` | SPR_SET | pop edge, pop vy, pop vx, pop flags, pop y, pop x, pop height, pop width, pop addr, pop slot | `[slot, addr, width, height, x, y, flags, vx, vy, edge] -> []` | Configures sprite slot. Sets active=true, visible=true. `addr` = memory address of bitmap. `vx`/`vy` are signed (interpreted as i16). `edge` = edge behavior mode. `flags`: bit 0=flipX, bit 1=flipY, bit 2=vector sprite. |
| `0x41` | SPR_POS | pop y, pop x, pop slot | `[slot, x, y] -> []` | Sets sprite position. |
| `0x42` | SPR_VEL | pop vy, pop vx, pop slot | `[slot, vx, vy] -> []` | Sets sprite velocity (signed i16). |
| `0x43` | SPR_GET | pop slot | `[slot] -> [x, y]` | Returns sprite position. Pushes x first, then y. If sprite is not active, pushes 0, 0. |
| `0x44` | SPR_OFF | pop slot | `[slot] -> []` | Deactivates sprite (active=false). |
| `0x45` | SPR_EDGE | pop edge, pop slot | `[slot, edge] -> []` | Sets edge behavior mode for sprite. |
| `0x46` | SPR_WALL | pop wallMode, pop slot | `[slot, wallMode] -> []` | Sets wall collision mode for sprite. |
| `0x47` | SPR_COLL | pop spriteMode, pop slot | `[slot, spriteMode] -> []` | Sets sprite-sprite collision mode. |
| `0x48` | WALL_SET | pop h, pop w, pop y, pop x, pop slot | `[slot, x, y, w, h] -> []` | Configures wall slot. Sets active=true. |
| `0x49` | WALL_OFF | pop slot | `[slot] -> []` | Deactivates wall. |
| `0x4A` | SPR_HIT | pop slot | `[slot] -> [hitInfo]` | Returns hit information: `(hitIndex << 8) | hitFlags`. hitFlags: bit 0=border, bit 1=wall, bit 2=sprite. hitIndex = slot index of last wall or sprite collided with. Returns 0 if sprite is inactive. |
| `0x4B` | SPR_GROUP | pop mask, pop group, pop slot | `[slot, group, mask] -> []` | Sets collision group membership (`group`, 8-bit) and collision filter mask (`mask`, 8-bit). Two sprites only collide if `(a.collGroup & b.collMask) \|\| (b.collGroup & a.collMask)`. Default: both 0xFF. |
| `0x4C` | SPR_ON_HIT | pop addr, pop slot | `[slot, addr] -> []` | Registers a VM callback address to be called when sprite `slot` has a collision (hitFlags != 0). Set addr=0 to disable. |
| `0x4D` | SPR_ROT | pop rotSpeed, pop angle, pop slot | `[slot, angle, rotSpeed] -> []` | Sets sprite rotation. `angle` = 0–255 (0=none, 64=90deg, 128=180deg, 192=270deg). `rotSpeed` = signed angular velocity. |
| `0x4E` | SPR_GETROT | pop slot | `[slot] -> [angle]` | Returns current rotation angle (0–255), masked to 8 bits. Returns 0 if inactive. |
| `0x4F` | SPR_VIS | pop visible, pop slot | `[slot, visible] -> []` | Sets sprite visibility. 0=invisible, nonzero=visible. Invisible sprites still participate in collisions but are not drawn. |

#### 5.4.5 Audio Syscalls (Stubs)

Syscall IDs `0x30`–`0x3F` are reserved for audio. They are currently NOPs — the handler silently ignores them without popping any arguments.

#### 5.4.6 Unknown Syscalls

Any syscall ID not listed above logs a warning and does nothing (no stack effect).

### 5.5 Input Bitfield

The INPUT syscall (`0x10`) pushes a 16-bit value:

- Low 8 bits: button states.
- High 8 bits: signed encoder delta for the current frame (`+` CW / `-` CCW).

| Bit | Value | Button |
|-----|-------|--------|
| 0 | `0x01` | Up |
| 1 | `0x02` | Down |
| 2 | `0x04` | Left |
| 3 | `0x08` | Right |
| 4 | `0x10` | Button (joystick click / fire) |
| 5 | `0x20` | Encoder CW (clockwise) |
| 6 | `0x40` | Encoder CCW (counter-clockwise) |
| 7 | `0x80` | Encoder Button |

A bit is 1 when the button is currently held, 0 when released.

Encoder delta is stored as two's-complement `int8` in bits `15:8`. Games can extract it with arithmetic shift right by 8.

### 5.6 Edge / Collision Mode Constants

Used by SPR_SET, SPR_EDGE, SPR_WALL, SPR_COLL:

| Value | Name | Behavior |
|-------|------|----------|
| 0 | NONE | No automatic behavior. |
| 1 | WRAP (edge only) / DETECT (collision) | Edge: wrap around screen. Collision: set hitFlags only, no physics response. |
| 2 | BOUNCE | Reverse velocity on contact. |
| 3 | DESTROY | Deactivate sprite on contact. |
| 4 | STOP | Zero velocity and clamp position on contact. |

### 5.7 Sprite Velocity Fixed-Point Format

Sprite velocities (`vx`, `vy`) passed via SPR_SET and SPR_VEL are signed 16-bit integers interpreted as i16 (two's complement). The runtime divides velocity by 64 to get pixels per frame at 60fps:

```
pixels_per_frame = velocity / 64
```

So `vx=64` means 1 pixel per frame (60 pixels per second). `vx=32` means 0.5 pixels per frame. Negative values move in the opposite direction.

### 5.8 Vector Sprites

When `flags` bit 2 is set, the sprite is a **vector sprite** (line segments instead of a bitmap). The data format at `addr` in memory is:

```
[n]               -- 1 byte: number of line segments
[x1 y1 x2 y2]    -- 4 bytes per segment, repeated n times
```

Each coordinate byte is a signed 4.4 fixed-point value (two's complement over 8 bits). To decode: `signed_byte = byte >= 128 ? byte - 256 : byte`, then multiply by 16 to get a value scaled by 256 for fixed-point math. Line segments are drawn from (x1,y1) to (x2,y2) relative to the sprite center, rotated by the sprite's current angle.

### 5.9 Hit Callback Convention

When a sprite has `hitCallback != 0` and `hitFlags != 0` after the frame's sprite update:

1. The runtime saves the current PC.
2. Pushes the sprite slot index onto the stack.
3. Pushes the saved PC (as a return address) onto the stack.
4. Sets `pc = hitCallback`.
5. Runs up to 5,000 instructions, waiting for the PC to return to the saved value (via `RET`).
6. If the budget is exceeded, the runtime forces `pc` back to the saved value and warns.

The BASIC CALLBACK mechanism saves the return address to a memory variable (since the callback body may manipulate the stack), stores the slot from the stack into a named variable, executes the body, then reloads the return address and executes `RET`.

---

## 6. Arithmetic Details

### 6.1 Integer Width

All stack values and arithmetic results are **unsigned 16-bit** (0–65535). Every push masks the value with `& 0xFFFF`.

### 6.2 Signed Interpretation

Signed operations (NEG, LTS, GTS, and several syscalls) interpret 16-bit values as **signed two's complement i16** using:

```
toSigned(v) = v >= 0x8000 ? v - 0x10000 : v
```

This maps `0x0000`–`0x7FFF` to 0–32767 and `0x8000`–`0xFFFF` to -32768 to -1.

### 6.3 Overflow Behavior

- **ADD, SUB, MUL, NEG**: Wrap around via `& 0xFFFF`. No overflow trap.
- **DIV, MOD**: Division/modulo by zero halts the VM (throws error, sets `halted = true`).
- **SHL**: Shift amount is not bounded. Shifting by >= 16 produces 0 (after masking). Shifting by 0 is a no-op.
- **SHR**: Logical right shift. Shifting by >= 16 produces 0.

### 6.4 Division Semantics

`DIV` uses JavaScript's `(a / b) >>> 0` which performs floating-point division then truncates to an unsigned 32-bit integer. Since both `a` and `b` are in range 0–65535 (both unsigned), this is equivalent to unsigned truncating integer division. The result is then masked to 16 bits by the `push()`.

---

## 7. Execution Model

### 7.1 step() Function

```
step(vm, syscallHandler) -> bool:
    if vm.halted: return false
    opcode = fetchU8(vm)          // reads memory[pc], advances pc
    vm.cycles += 1
    dispatch opcode               // may fetch more bytes, push/pop stack
    return !vm.halted
```

Every call to `step()` executes exactly one instruction (including fetching its inline operands). The cycle count increments by exactly 1 per instruction regardless of the instruction type.

### 7.2 Runtime Frame Loop

The runtime uses a fixed-timestep game loop at 60 fps:

```
execGameFrame(rt):
    clearFB()                           // clear framebuffer
    rt.syscallCtx.yieldRequested = false
    cycles = 0

    while cycles < 50,000 AND NOT yieldRequested:
        if NOT step(vm, syscallHandler):
            // HALT — do final sprite update + render, return false
            updateSprites(dt=1/60)
            runHitCallbacks()
            drawSprites()
            render()
            return false
        cycles++

    updateSprites(dt=1/60)
    runHitCallbacks()
    drawSprites()
    render()
    return true
```

**Key points:**
- The framebuffer is cleared at the START of each frame (before any VM instructions run).
- The VM runs up to **50,000 instructions per frame** or until `YIELD` is called, whichever comes first.
- After VM execution, sprite positions are updated, hit callbacks run, sprites are drawn to the framebuffer, and the framebuffer is rendered to screen.
- If the VM halts (HALT instruction, error, etc.), `execGameFrame` returns false and the runtime stops.

### 7.3 YIELD Semantics

The `YIELD` syscall (`0x06`) sets `yieldRequested = true` in the syscall context. This does NOT halt the VM. It signals the runtime to:
1. Stop executing instructions for this frame.
2. Proceed to sprite update, hit callbacks, sprite drawing, and rendering.
3. On the next frame, resume execution from the instruction after the YIELD syscall.

A typical game loop pattern:

```assembly
game_loop:
  ; game logic, drawing
  SYSCALL 0x06    ; YIELD — end frame
  JMP game_loop   ; next frame starts here
```

### 7.4 HALT Semantics

The `HALT` instruction (`0x00`) sets `vm.halted = true` and causes `step()` to return `false`. Once halted, `step()` returns `false` immediately without executing any instructions. The runtime stops the animation loop.

The VM can also halt on:
- Stack overflow (push when sp >= 256)
- Stack underflow (pop when sp <= 0)
- Division by zero (DIV or MOD with b=0)
- Unknown opcode

All of these set `vm.halted = true` and throw an error.

### 7.5 Timing

- **Target frame rate**: 60 fps (16.67ms per frame).
- **Accumulator-based timing**: The runtime uses `requestAnimationFrame` with an accumulator. If real time exceeds one frame period, a game frame is executed. At most one game frame runs per rAF callback to keep rendering responsive. Excess time carries over.
- **Spiral-of-death clamp**: Accumulated time is clamped to 4 frame periods (~66.7ms) to prevent runaway catching-up after pauses.

---

## 8. Assembler Syntax

### 8.1 Source Format

The assembler operates on a plain text source string, split into lines. Each line is one of:

- **Empty line or comment-only line**: Ignored.
- **Label**: An identifier followed by a colon. Example: `my_label:`
- **Instruction**: A mnemonic optionally followed by an operand. Example: `PUSH8 42` or `ADD`
- **Data directive**: `.data` followed by comma/space-separated byte values. Example: `.data 0xFF, 0x00, 128`
- **Org directive**: `.org` followed by an address. Example: `.org 0x1000`

### 8.2 Comments

Semicolons (`;`) begin a comment. Everything from the semicolon to the end of the line is ignored.

```
  ADD        ; this is a comment
; this entire line is a comment
```

### 8.3 Mnemonics

Mnemonics are **case-insensitive** (converted to uppercase internally). Valid mnemonics are all the opcode names from Section 3: `HALT`, `NOP`, `PUSH8`, `PUSH16`, `POP`, `DUP`, `SWAP`, `OVER`, `ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `NEG`, `AND`, `OR`, `XOR`, `NOT`, `SHL`, `SHR`, `EQ`, `LT`, `GT`, `LTS`, `GTS`, `JMP`, `JZ`, `JNZ`, `CALL`, `RET`, `LOAD`, `STORE`, `LOAD8`, `STORE8`, `LOAD_IDX`, `STORE_IDX`, `LOAD8_IDX`, `STORE8_IDX`, `SYSCALL`.

### 8.4 Operands

Operands can be:
- **Decimal integers**: `42`, `255`, `65535`
- **Hexadecimal integers**: `0xFF`, `0x1234`
- **Octal integers**: `0777` (leading zero, parsed by JavaScript's `parseInt` with radix 0)
- **Label references**: An identifier that was defined as a label elsewhere. Resolved to the label's bytecode address.

Operand parsing uses JavaScript's `parseInt(str, 0)` which auto-detects the radix from the prefix.

### 8.5 Labels

Labels are identifiers ending with `:`. They record the current bytecode address at the point of definition. Labels can be referenced as operands in instructions.

```
loop:
  ; ... code ...
  JMP loop
```

Labels are case-sensitive. Duplicate labels are an error.

### 8.6 .data Directive

Emits raw bytes into the output. Values must be in range 0–255.

```
sprite_data:
  .data 0xFF, 0x81, 0x81, 0xFF    ; a 4-byte sprite
```

The `.data` directive is case-insensitive (`.data` or `.DATA`).

### 8.7 .org Directive

Sets the output address to the specified value. The assembler pads with zero bytes up to the target address. If the current output position is already past the target, behavior is that bytes continue to be emitted (the output array only grows).

```
.org 0x1000
; next instruction or data will be at address 0x1000
```

### 8.8 Two-Pass Assembly

The assembler uses two passes:

**Pass 1 — Address calculation:**
- Walk through all parsed lines, tracking the current address.
- Labels: record `labels[name] = currentAddress`. Error on duplicates.
- Instructions: advance address by `1 + operandSize` (looked up from the opcode).
- Data: advance address by the number of bytes.
- Org: set address to the directive's value.
- Empty lines: no effect.

**Pass 2 — Bytecode emission:**
- Walk through parsed lines again, emitting bytes into the output array.
- Instructions: emit the opcode byte. If it has an operand, resolve the operand (numeric literal or label reference), then emit it in the appropriate size (1 byte for PUSH8/SYSCALL, 2 bytes little-endian for everything else).
- Data: emit each byte literally.
- Org: pad with zero bytes up to the target address.
- Labels/empty: no output.

### 8.9 Assembler Output

The assembler produces:
- `bytecode`: A `Uint8Array` containing the assembled program.
- `labels`: A map of label name to address.
- `pcToLine`: A map of bytecode address to 1-based source line number (for debugging).

### 8.10 Error Handling

The assembler returns either a result or an error with the 1-based line number and message. Errors include: unknown mnemonic, duplicate label, undefined label reference, invalid operand, missing required operand, invalid byte value in `.data`.

---

## 9. Display

The display is a **128x64 pixel monochrome (1-bit) framebuffer**, matching the SH1106 OLED on the hardware.

- **Resolution**: 128 wide, 64 tall.
- **Pixel format**: Row-major, MSB-first within each byte. Total size: 1024 bytes.
- **Pixel addressing**: `bitIndex = y * 128 + x`, `byteIndex = bitIndex / 8`, `bitOffset = 7 - (bitIndex % 8)`.
- **Sprite format**: Same as framebuffer. Row-major, MSB-first, `ceil(width/8)` bytes per row.

---

## 10. Sprite & Collision Engine

The sprite engine runs once per frame during YIELD, outside the VM's instruction loop. It is not a syscall — it is a runtime subsystem that the VM configures via syscalls and that executes autonomously each frame.

### 10.1 Sprite Table

32 sprite slots (0-31). Each sprite has: position (x, y as floats), velocity (vx, vy as signed integers), dimensions (width, height 1-16 px), bitmap address, flags, edge mode, wall collision mode, sprite collision mode, collision group/mask, hit callback address, visibility flag, rotation angle (0-255), and rotation speed.

16 wall slots (0-15). Each wall is an invisible AABB: x, y, width, height.

### 10.2 Frame Update Phases

`updateSprites()` runs in 4 sequential phases every frame:

**Phase 1 — Velocity integration:**
For each active sprite:
- Clear `hitFlags` and `hitIndex` to 0
- Invalidate vector sprite rasterization cache
- `x += (vx / 64) * scale`, `y += (vy / 64) * scale`
- `angle = (angle + (rotSpeed / 64) * scale) mod 256`
- `scale = dt * 60` (1.0 at 60fps, compensates for frame drops)

Velocity is fixed-point: **64 = 1 pixel/frame at 60fps**.

**Phase 2 — Wall collisions:**
For each active sprite with `wallMode != 0`:
- Test AABB overlap against all active walls
- On overlap, compute penetration depths on all 4 sides
- Apply collision response based on wallMode (see below)
- Set `hitFlags |= 2` (wall bit), `hitIndex = wallSlotIndex`
- If mode=destroy, sprite is deactivated immediately

**Phase 3 — Sprite-sprite collisions:**
For each pair (i, j) where i < j, both active:
- Skip if both have `spriteMode == 0`
- **Group filter**: skip if `!(a.collGroup & b.collMask) && !(b.collGroup & a.collMask)`. Default group and mask are both `0xFF` (collide with everything).
- **Broad phase**: AABB overlap test. For rotated sprites, compute axis-aligned bounding box from the rotated corners.
- **Narrow phase** (rotated sprites only): Pixel-perfect overlap test. For each pixel in the AABB intersection, inverse-rotate into each sprite's local coordinates and test the bitmap bit. Vector sprites are rasterized into a temporary buffer first.
- **Non-rotated sprites**: AABB overlap alone is sufficient (no pixel-perfect test).
- On collision, compute penetration depths and apply response independently to each sprite based on its own `spriteMode`.
- Set `hitFlags |= 4` (sprite bit). `a.hitIndex = j`, `b.hitIndex = i`.

**Phase 4 — Edge behavior:**
For each active sprite, apply edge mode:

| Mode | Name | Behavior |
|------|------|----------|
| 0 | NONE | No edge handling. Sprite can leave the screen freely. |
| 1 | WRAP | `x = ((x % 128) + 128) % 128`, same for y with 64. Wraps position using modular arithmetic. |
| 2 | BOUNCE | If touching left/top edge (pos <= 0): clamp to 0, force velocity positive. If touching right/bottom edge (pos >= screenSize - spriteSize): clamp, force velocity negative. Sets `hitFlags |= 1`. |
| 3 | DESTROY | Deactivate sprite when **fully** off-screen (x <= -width, x >= 128, y <= -height, y >= 64). Sets `hitFlags |= 1`. |
| 4 | STOP | Clamp to edge and zero velocity on the clamped axis. Sets `hitFlags |= 1`. |

### 10.3 Collision Response

`applyCollisionMode()` resolves AABB penetration using minimum-penetration-axis separation:

1. Compute overlap on each side: `overlapLeft = (spr.x + spr.width) - other.x`, etc.
2. Find the minimum penetration axis: `minX = min(overlapLeft, overlapRight)`, `minY = min(overlapTop, overlapBottom)`.
3. Resolve along the **smaller** penetration axis (push the sprite out the shortest distance):
   - If `minX < minY`: shift sprite on X axis, then apply mode to X velocity.
   - Otherwise: shift sprite on Y axis, then apply mode to Y velocity.
4. Mode effects on the resolved axis:
   - **1 (DETECT)**: No physics response. `hitFlags` set only.
   - **2 (BOUNCE)**: Reverse velocity on the resolved axis.
   - **3 (DESTROY)**: Deactivate sprite.
   - **4 (STOP)**: Zero velocity on the resolved axis.

For sprite-sprite collisions, the overlap is computed once and each sprite applies its own response independently. Overlaps are inverted for sprite B's perspective.

### 10.4 Hit Flags and Callbacks

`hitFlags` is a 3-bit field set during the frame update:
- Bit 0 (0x01): Border hit (set by edge behavior phase)
- Bit 1 (0x02): Wall hit
- Bit 2 (0x04): Sprite hit

`hitIndex` stores the slot index of the last wall or sprite collided with.

`SPR_HIT(slot)` returns `(hitIndex << 8) | hitFlags`.

**Hit callbacks** run after all 4 phases complete, via `runHitCallbacks()`:
- For each sprite with `hitFlags != 0` and `hitCallback != 0`:
  - Push the sprite's slot index onto the operand stack
  - Push the saved PC (as a return address)
  - Set PC to the callback address
  - Execute VM instructions until RET restores the saved PC, or the **5,000 cycle budget** is exhausted
  - If budget exceeded, PC is forcibly restored and a warning is logged

Callbacks run in slot order (0, 1, 2, ...). A callback can modify any sprite state via syscalls.

### 10.5 Drawing

After `updateSprites()` and `runHitCallbacks()`, `drawSprites()` renders all active, visible sprites onto the framebuffer:

- **Bitmap sprites** (flags bit 2 = 0): Row-aligned, MSB-first, `ceil(width/8)` bytes per row. Drawn with rotation support via inverse-rotation sampling. Only set (white) pixels are drawn (OR mode).
- **Vector sprites** (flags bit 2 = 1): First byte at `addr` is the segment count N. Following N*4 bytes are line segments, each as 4 signed 4.4 fixed-point bytes: x1, y1, x2, y2. Coordinates are relative to sprite center. Segments are rotated by the sprite's angle and drawn with Bresenham line rasterization.

Sprites are drawn in slot order (0 first, 31 last). Higher slots draw on top of lower slots.

---

## 11. Opcode Quick Reference

| Value | Mnemonic | Size | Operand | Stack Effect |
|-------|----------|------|---------|-------------|
| `0x00` | HALT | 1 | — | `[] -> []` (halts) |
| `0x01` | NOP | 1 | — | `[] -> []` |
| `0x02` | PUSH8 | 2 | u8 | `[] -> [imm]` |
| `0x03` | PUSH16 | 3 | u16 LE | `[] -> [imm]` |
| `0x04` | POP | 1 | — | `[a] -> []` |
| `0x05` | DUP | 1 | — | `[a] -> [a, a]` |
| `0x06` | SWAP | 1 | — | `[a, b] -> [b, a]` |
| `0x07` | OVER | 1 | — | `[a, b] -> [a, b, a]` |
| `0x10` | ADD | 1 | — | `[a, b] -> [a+b]` |
| `0x11` | SUB | 1 | — | `[a, b] -> [a-b]` |
| `0x12` | MUL | 1 | — | `[a, b] -> [a*b]` |
| `0x13` | DIV | 1 | — | `[a, b] -> [a/b]` |
| `0x14` | MOD | 1 | — | `[a, b] -> [a%b]` |
| `0x15` | NEG | 1 | — | `[a] -> [-a]` |
| `0x20` | AND | 1 | — | `[a, b] -> [a&b]` |
| `0x21` | OR | 1 | — | `[a, b] -> [a\|b]` |
| `0x22` | XOR | 1 | — | `[a, b] -> [a^b]` |
| `0x23` | NOT | 1 | — | `[a] -> [~a]` |
| `0x24` | SHL | 1 | — | `[a, b] -> [a<<b]` |
| `0x25` | SHR | 1 | — | `[a, b] -> [a>>>b]` |
| `0x30` | EQ | 1 | — | `[a, b] -> [a==b]` |
| `0x31` | LT | 1 | — | `[a, b] -> [a<b]` (unsigned) |
| `0x32` | GT | 1 | — | `[a, b] -> [a>b]` (unsigned) |
| `0x33` | LTS | 1 | — | `[a, b] -> [a<b]` (signed) |
| `0x34` | GTS | 1 | — | `[a, b] -> [a>b]` (signed) |
| `0x40` | JMP | 3 | u16 addr | `[] -> []` |
| `0x41` | JZ | 3 | u16 addr | `[c] -> []` |
| `0x42` | JNZ | 3 | u16 addr | `[c] -> []` |
| `0x43` | CALL | 3 | u16 addr | `[] -> [ret]` |
| `0x44` | RET | 1 | — | `[ret] -> []` |
| `0x50` | LOAD | 3 | u16 addr | `[] -> [mem16[addr]]` |
| `0x51` | STORE | 3 | u16 addr | `[v] -> []` |
| `0x52` | LOAD8 | 3 | u16 addr | `[] -> [mem8[addr]]` |
| `0x53` | STORE8 | 3 | u16 addr | `[v] -> []` |
| `0x54` | LOAD_IDX | 1 | — | `[addr] -> [mem16[addr]]` |
| `0x55` | STORE_IDX | 1 | — | `[v, addr] -> []` |
| `0x56` | LOAD8_IDX | 1 | — | `[addr] -> [mem8[addr]]` |
| `0x57` | STORE8_IDX | 1 | — | `[v, addr] -> []` |
| `0x60` | SYSCALL | 2 | u8 id | varies |
