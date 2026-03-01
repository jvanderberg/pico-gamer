#pragma once
#include <cstdint>
#include <cstring>

static const int ASM_MAX_OUTPUT  = 65536;
static const int ASM_MAX_LABELS  = 256;
static const int ASM_MAX_LINES   = 4096;
static const int ASM_LABEL_MAXLEN = 63;

struct AsmLabel {
    char     name[ASM_LABEL_MAXLEN + 1];
    uint16_t addr;
};

struct AssemblerResult {
    uint8_t  bytecode[ASM_MAX_OUTPUT];
    uint16_t length;
    AsmLabel labels[ASM_MAX_LABELS];
    uint16_t labelCount;
    bool     error;
    int      errorLine;     // 1-based
    char     errorMsg[128];
};

// Assemble source text into bytecode.
// Returns result with bytecode or error information.
AssemblerResult assemble(const char* source);

// Find a label's address by name. Returns -1 if not found.
int32_t findLabel(const AssemblerResult& result, const char* name);
