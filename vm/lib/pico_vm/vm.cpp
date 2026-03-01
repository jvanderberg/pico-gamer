#include "vm.h"
#include "opcodes.h"
#include "memory.h"

VMState createVM() {
    VMState vm;
    memset(vm.memory, 0, sizeof(vm.memory));
    memset(vm.stack, 0, sizeof(vm.stack));
    vm.pc = 0;
    vm.sp = 0;
    vm.halted = false;
    vm.cycles = 0;
    return vm;
}

void resetVM(VMState& vm) {
    memset(vm.memory, 0, sizeof(vm.memory));
    memset(vm.stack, 0, sizeof(vm.stack));
    vm.pc = 0;
    vm.sp = 0;
    vm.halted = false;
    vm.cycles = 0;
}

void push(VMState& vm, uint16_t value) {
    if (vm.sp >= 256) {
        vm.halted = true;
        return;
    }
    vm.stack[vm.sp] = value & 0xFFFF;
    vm.sp++;
}

uint16_t pop(VMState& vm) {
    if (vm.sp <= 0) {
        vm.halted = true;
        return 0;
    }
    vm.sp--;
    return vm.stack[vm.sp];
}

uint16_t peek(const VMState& vm) {
    if (vm.sp <= 0) return 0;
    return vm.stack[vm.sp - 1];
}

static inline uint8_t fetchU8(VMState& vm) {
    uint8_t val = vm.memory[vm.pc & 0xFFFF];
    vm.pc = (vm.pc + 1) & 0xFFFF;
    return val;
}

static inline uint16_t fetchU16(VMState& vm) {
    uint8_t lo = vm.memory[vm.pc & 0xFFFF];
    uint8_t hi = vm.memory[(vm.pc + 1) & 0xFFFF];
    vm.pc = (vm.pc + 2) & 0xFFFF;
    return (uint16_t)(lo | (hi << 8));
}

bool step(VMState& vm, SyscallHandler handler, void* ctx) {
    if (vm.halted) return false;

    uint8_t opcode = fetchU8(vm);
    vm.cycles++;

    switch (opcode) {
        case OP_HALT:
            vm.halted = true;
            return false;

        case OP_NOP:
            break;

        case OP_PUSH8:
            push(vm, fetchU8(vm));
            break;

        case OP_PUSH16:
            push(vm, fetchU16(vm));
            break;

        case OP_POP:
            pop(vm);
            break;

        case OP_DUP:
            push(vm, peek(vm));
            break;

        case OP_SWAP: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, b);
            push(vm, a);
            break;
        }

        case OP_OVER: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, a);
            push(vm, b);
            push(vm, a);
            break;
        }

        case OP_ADD: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (a + b) & 0xFFFF);
            break;
        }

        case OP_SUB: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (a - b) & 0xFFFF);
            break;
        }

        case OP_MUL: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (uint16_t)((uint32_t)a * b));
            break;
        }

        case OP_DIV: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            if (b == 0) {
                vm.halted = true;
                return false;
            }
            push(vm, a / b);
            break;
        }

        case OP_MOD: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            if (b == 0) {
                vm.halted = true;
                return false;
            }
            push(vm, a % b);
            break;
        }

        case OP_NEG: {
            uint16_t a = pop(vm);
            push(vm, (uint16_t)((-((int32_t)a)) & 0xFFFF));
            break;
        }

        case OP_AND: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, a & b);
            break;
        }

        case OP_OR: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, a | b);
            break;
        }

        case OP_XOR: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, a ^ b);
            break;
        }

        case OP_NOT: {
            uint16_t a = pop(vm);
            push(vm, (~a) & 0xFFFF);
            break;
        }

        case OP_SHL: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (uint16_t)((a << b) & 0xFFFF));
            break;
        }

        case OP_SHR: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (uint16_t)(a >> b));
            break;
        }

        case OP_EQ: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (a == b) ? 1 : 0);
            break;
        }

        case OP_LT: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (a < b) ? 1 : 0);
            break;
        }

        case OP_GT: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (a > b) ? 1 : 0);
            break;
        }

        case OP_LTS: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (toSigned(a) < toSigned(b)) ? 1 : 0);
            break;
        }

        case OP_GTS: {
            uint16_t b = pop(vm);
            uint16_t a = pop(vm);
            push(vm, (toSigned(a) > toSigned(b)) ? 1 : 0);
            break;
        }

        case OP_JMP:
            vm.pc = fetchU16(vm);
            break;

        case OP_JZ: {
            uint16_t addr = fetchU16(vm);
            if (pop(vm) == 0) vm.pc = addr;
            break;
        }

        case OP_JNZ: {
            uint16_t addr = fetchU16(vm);
            if (pop(vm) != 0) vm.pc = addr;
            break;
        }

        case OP_CALL: {
            uint16_t addr = fetchU16(vm);
            push(vm, vm.pc);
            vm.pc = addr;
            break;
        }

        case OP_RET:
            vm.pc = pop(vm);
            break;

        case OP_LOAD: {
            uint16_t addr = fetchU16(vm);
            push(vm, readU16(vm.memory, addr));
            break;
        }

        case OP_STORE: {
            uint16_t addr = fetchU16(vm);
            writeU16(vm.memory, addr, pop(vm));
            break;
        }

        case OP_LOAD8: {
            uint16_t addr = fetchU16(vm);
            push(vm, readU8(vm.memory, addr));
            break;
        }

        case OP_STORE8: {
            uint16_t addr = fetchU16(vm);
            writeU8(vm.memory, addr, (uint8_t)pop(vm));
            break;
        }

        case OP_LOAD_IDX: {
            uint16_t addr = pop(vm);
            push(vm, readU16(vm.memory, addr));
            break;
        }

        case OP_STORE_IDX: {
            uint16_t addr = pop(vm);
            uint16_t val = pop(vm);
            writeU16(vm.memory, addr, val);
            break;
        }

        case OP_LOAD8_IDX: {
            uint16_t addr = pop(vm);
            push(vm, readU8(vm.memory, addr));
            break;
        }

        case OP_STORE8_IDX: {
            uint16_t addr = pop(vm);
            uint16_t val = pop(vm);
            writeU8(vm.memory, addr, (uint8_t)val);
            break;
        }

        case OP_SYSCALL: {
            uint8_t id = fetchU8(vm);
            if (handler) handler(id, vm, ctx);
            break;
        }

        default:
            vm.halted = true;
            return false;
    }

    return !vm.halted;
}
