import { Op } from "./opcodes.ts";
import { readU8, readU16, writeU16, writeU8 } from "./memory.ts";
import type { SyscallHandler } from "../syscalls/interface.ts";

export interface VMState {
  memory: Uint8Array;
  stack: Uint16Array;
  pc: number;
  sp: number; // index into stack array; grows upward (0 = empty)
  halted: boolean;
  cycles: number;
}

export function createVM(memorySize = 65536, stackSize = 256): VMState {
  return {
    memory: new Uint8Array(memorySize),
    stack: new Uint16Array(stackSize),
    pc: 0,
    sp: 0,
    halted: false,
    cycles: 0,
  };
}

export function resetVM(vm: VMState): void {
  vm.memory.fill(0);
  vm.stack.fill(0);
  vm.pc = 0;
  vm.sp = 0;
  vm.halted = false;
  vm.cycles = 0;
}

export function push(vm: VMState, value: number): void {
  if (vm.sp >= vm.stack.length) {
    vm.halted = true;
    throw new Error(`Stack overflow at PC=0x${vm.pc.toString(16)}`);
  }
  vm.stack[vm.sp] = value & 0xffff;
  vm.sp++;
}

export function pop(vm: VMState): number {
  if (vm.sp <= 0) {
    vm.halted = true;
    throw new Error(`Stack underflow at PC=0x${vm.pc.toString(16)}`);
  }
  vm.sp--;
  return vm.stack[vm.sp]!;
}

export function peek(vm: VMState): number {
  if (vm.sp <= 0) return 0;
  return vm.stack[vm.sp - 1]!;
}

function fetchU8(vm: VMState): number {
  const v = readU8(vm.memory, vm.pc);
  vm.pc = (vm.pc + 1) & 0xffff;
  return v;
}

function fetchU16(vm: VMState): number {
  const v = readU16(vm.memory, vm.pc);
  vm.pc = (vm.pc + 2) & 0xffff;
  return v;
}

/** Interpret top-of-stack as signed i16. */
function toSigned(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

/**
 * Execute one instruction. Returns false if halted.
 * The syscall handler is passed in — no hidden state.
 */
export function step(vm: VMState, syscallHandler: SyscallHandler): boolean {
  if (vm.halted) return false;

  const opcode = fetchU8(vm);
  vm.cycles++;

  switch (opcode) {
    case Op.HALT:
      vm.halted = true;
      return false;

    case Op.NOP:
      break;

    case Op.PUSH8:
      push(vm, fetchU8(vm));
      break;

    case Op.PUSH16:
      push(vm, fetchU16(vm));
      break;

    case Op.POP:
      pop(vm);
      break;

    case Op.DUP:
      push(vm, peek(vm));
      break;

    case Op.SWAP: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, b);
      push(vm, a);
      break;
    }

    case Op.OVER: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, a);
      push(vm, b);
      push(vm, a);
      break;
    }

    // Arithmetic
    case Op.ADD: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, (a + b) & 0xffff);
      break;
    }
    case Op.SUB: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, (a - b) & 0xffff);
      break;
    }
    case Op.MUL: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, (a * b) & 0xffff);
      break;
    }
    case Op.DIV: {
      const b = pop(vm);
      const a = pop(vm);
      if (b === 0) {
        vm.halted = true;
        throw new Error(`Division by zero at PC=0x${(vm.pc - 1).toString(16)}`);
      }
      push(vm, (a / b) >>> 0);
      break;
    }
    case Op.MOD: {
      const b = pop(vm);
      const a = pop(vm);
      if (b === 0) {
        vm.halted = true;
        throw new Error(`Modulo by zero at PC=0x${(vm.pc - 1).toString(16)}`);
      }
      push(vm, a % b);
      break;
    }
    case Op.NEG: {
      const a = pop(vm);
      push(vm, (-a) & 0xffff);
      break;
    }

    // Bitwise
    case Op.AND: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, a & b);
      break;
    }
    case Op.OR: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, a | b);
      break;
    }
    case Op.XOR: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, a ^ b);
      break;
    }
    case Op.NOT: {
      const a = pop(vm);
      push(vm, (~a) & 0xffff);
      break;
    }
    case Op.SHL: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, (a << b) & 0xffff);
      break;
    }
    case Op.SHR: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, (a >>> b) & 0xffff);
      break;
    }

    // Comparison
    case Op.EQ: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, a === b ? 1 : 0);
      break;
    }
    case Op.LT: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, a < b ? 1 : 0);
      break;
    }
    case Op.GT: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, a > b ? 1 : 0);
      break;
    }
    case Op.LTS: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, toSigned(a) < toSigned(b) ? 1 : 0);
      break;
    }
    case Op.GTS: {
      const b = pop(vm);
      const a = pop(vm);
      push(vm, toSigned(a) > toSigned(b) ? 1 : 0);
      break;
    }

    // Control flow
    case Op.JMP:
      vm.pc = fetchU16(vm);
      break;

    case Op.JZ: {
      const addr = fetchU16(vm);
      if (pop(vm) === 0) vm.pc = addr;
      break;
    }
    case Op.JNZ: {
      const addr = fetchU16(vm);
      if (pop(vm) !== 0) vm.pc = addr;
      break;
    }
    case Op.CALL: {
      const addr = fetchU16(vm);
      push(vm, vm.pc);
      vm.pc = addr;
      break;
    }
    case Op.RET:
      vm.pc = pop(vm);
      break;

    // Memory (absolute address operand)
    case Op.LOAD: {
      const addr = fetchU16(vm);
      push(vm, readU16(vm.memory, addr));
      break;
    }
    case Op.STORE: {
      const addr = fetchU16(vm);
      writeU16(vm.memory, addr, pop(vm));
      break;
    }
    case Op.LOAD8: {
      const addr = fetchU16(vm);
      push(vm, readU8(vm.memory, addr));
      break;
    }
    case Op.STORE8: {
      const addr = fetchU16(vm);
      writeU8(vm.memory, addr, pop(vm));
      break;
    }

    // Memory (indexed — address on stack)
    case Op.LOAD_IDX: {
      const addr = pop(vm);
      push(vm, readU16(vm.memory, addr));
      break;
    }
    case Op.STORE_IDX: {
      const addr = pop(vm);
      const val = pop(vm);
      writeU16(vm.memory, addr, val);
      break;
    }
    case Op.LOAD8_IDX: {
      const addr = pop(vm);
      push(vm, readU8(vm.memory, addr));
      break;
    }
    case Op.STORE8_IDX: {
      const addr = pop(vm);
      const val = pop(vm);
      writeU8(vm.memory, addr, val);
      break;
    }

    // Syscall
    case Op.SYSCALL: {
      const id = fetchU8(vm);
      syscallHandler(id, vm);
      break;
    }

    default: {
      const bad: number = opcode;
      vm.halted = true;
      throw new Error(
        `Unknown opcode 0x${bad.toString(16)} at PC=0x${(vm.pc - 1).toString(16)}`,
      );
    }
  }

  return !vm.halted;
}
