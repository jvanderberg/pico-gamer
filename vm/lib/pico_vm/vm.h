#pragma once
#include <cstdint>

struct VMState {
    uint8_t  memory[65536];
    uint16_t stack[256];
    uint16_t pc;
    uint16_t sp;
    bool     halted;
    uint32_t cycles;
};

// Callback type for syscall dispatch
using SyscallHandler = void (*)(uint8_t id, VMState& vm, void* ctx);

VMState createVM();
void    resetVM(VMState& vm);
void    push(VMState& vm, uint16_t value);
uint16_t pop(VMState& vm);
uint16_t peek(const VMState& vm);
bool    step(VMState& vm, SyscallHandler handler, void* ctx);

// Helpers
inline int16_t toSigned(uint16_t v) {
    return (v >= 0x8000) ? (int16_t)(v - 0x10000) : (int16_t)v;
}
