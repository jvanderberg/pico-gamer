/** 64KB flat memory — just typed read/write helpers over a Uint8Array. */

export function createMemory(sizeBytes = 65536): Uint8Array {
  return new Uint8Array(sizeBytes);
}

export function readU8(mem: Uint8Array, addr: number): number {
  return mem[addr & 0xffff]!;
}

export function writeU8(mem: Uint8Array, addr: number, value: number): void {
  mem[addr & 0xffff] = value & 0xff;
}

/** Read little-endian u16. */
export function readU16(mem: Uint8Array, addr: number): number {
  const lo = mem[addr & 0xffff]!;
  const hi = mem[(addr + 1) & 0xffff]!;
  return lo | (hi << 8);
}

/** Write little-endian u16. */
export function writeU16(mem: Uint8Array, addr: number, value: number): void {
  mem[addr & 0xffff] = value & 0xff;
  mem[(addr + 1) & 0xffff] = (value >> 8) & 0xff;
}

/** Load a program into memory at baseAddr. */
export function loadProgram(
  mem: Uint8Array,
  program: Uint8Array,
  baseAddr = 0,
): void {
  mem.set(program, baseAddr);
}
