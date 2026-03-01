#pragma once
#include <cstdint>
#include <cstring>

inline uint8_t readU8(const uint8_t* mem, uint16_t addr) {
    return mem[addr & 0xFFFF];
}

inline void writeU8(uint8_t* mem, uint16_t addr, uint8_t value) {
    mem[addr & 0xFFFF] = value;
}

inline uint16_t readU16(const uint8_t* mem, uint16_t addr) {
    uint8_t lo = mem[addr & 0xFFFF];
    uint8_t hi = mem[(addr + 1) & 0xFFFF];
    return (uint16_t)(lo | (hi << 8));
}

inline void writeU16(uint8_t* mem, uint16_t addr, uint16_t value) {
    mem[addr & 0xFFFF] = (uint8_t)(value & 0xFF);
    mem[(addr + 1) & 0xFFFF] = (uint8_t)((value >> 8) & 0xFF);
}

inline void loadProgram(uint8_t* mem, const uint8_t* program, uint16_t len, uint16_t baseAddr = 0) {
    memcpy(mem + baseAddr, program, len);
}
