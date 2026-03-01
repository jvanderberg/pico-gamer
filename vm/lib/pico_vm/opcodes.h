#pragma once
#include <cstdint>

enum Op : uint8_t {
    OP_HALT      = 0x00,
    OP_NOP       = 0x01,
    OP_PUSH8     = 0x02,
    OP_PUSH16    = 0x03,
    OP_POP       = 0x04,
    OP_DUP       = 0x05,
    OP_SWAP      = 0x06,
    OP_OVER      = 0x07,

    OP_ADD       = 0x10,
    OP_SUB       = 0x11,
    OP_MUL       = 0x12,
    OP_DIV       = 0x13,
    OP_MOD       = 0x14,
    OP_NEG       = 0x15,

    OP_AND       = 0x20,
    OP_OR        = 0x21,
    OP_XOR       = 0x22,
    OP_NOT       = 0x23,
    OP_SHL       = 0x24,
    OP_SHR       = 0x25,

    OP_EQ        = 0x30,
    OP_LT        = 0x31,
    OP_GT        = 0x32,
    OP_LTS       = 0x33,
    OP_GTS       = 0x34,

    OP_JMP       = 0x40,
    OP_JZ        = 0x41,
    OP_JNZ       = 0x42,
    OP_CALL      = 0x43,
    OP_RET       = 0x44,

    OP_LOAD      = 0x50,
    OP_STORE     = 0x51,
    OP_LOAD8     = 0x52,
    OP_STORE8    = 0x53,
    OP_LOAD_IDX  = 0x54,
    OP_STORE_IDX = 0x55,
    OP_LOAD8_IDX = 0x56,
    OP_STORE8_IDX= 0x57,

    OP_SYSCALL   = 0x60,
};

// Returns the number of inline operand bytes for a given opcode.
// Returns 0 for unknown opcodes (the VM will halt on unknown opcodes).
inline uint8_t operandSize(uint8_t op) {
    switch (op) {
        case OP_PUSH8:    return 1;
        case OP_SYSCALL:  return 1;
        case OP_PUSH16:   return 2;
        case OP_JMP:      return 2;
        case OP_JZ:       return 2;
        case OP_JNZ:      return 2;
        case OP_CALL:     return 2;
        case OP_LOAD:     return 2;
        case OP_STORE:    return 2;
        case OP_LOAD8:    return 2;
        case OP_STORE8:   return 2;
        default:          return 0;
    }
}
