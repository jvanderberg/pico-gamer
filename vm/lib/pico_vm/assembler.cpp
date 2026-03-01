#include "assembler.h"
#include "opcodes.h"
#include <cstdio>
#include <cstdlib>
#include <cctype>

// --- Mnemonic lookup table ---

struct MnemonicEntry {
    const char* name;
    uint8_t     opcode;
};

static const MnemonicEntry MNEMONICS[] = {
    {"HALT",       OP_HALT},
    {"NOP",        OP_NOP},
    {"PUSH8",      OP_PUSH8},
    {"PUSH16",     OP_PUSH16},
    {"POP",        OP_POP},
    {"DUP",        OP_DUP},
    {"SWAP",       OP_SWAP},
    {"OVER",       OP_OVER},
    {"ADD",        OP_ADD},
    {"SUB",        OP_SUB},
    {"MUL",        OP_MUL},
    {"DIV",        OP_DIV},
    {"MOD",        OP_MOD},
    {"NEG",        OP_NEG},
    {"AND",        OP_AND},
    {"OR",         OP_OR},
    {"XOR",        OP_XOR},
    {"NOT",        OP_NOT},
    {"SHL",        OP_SHL},
    {"SHR",        OP_SHR},
    {"EQ",         OP_EQ},
    {"LT",         OP_LT},
    {"GT",         OP_GT},
    {"LTS",        OP_LTS},
    {"GTS",        OP_GTS},
    {"JMP",        OP_JMP},
    {"JZ",         OP_JZ},
    {"JNZ",        OP_JNZ},
    {"CALL",       OP_CALL},
    {"RET",        OP_RET},
    {"LOAD",       OP_LOAD},
    {"STORE",      OP_STORE},
    {"LOAD8",      OP_LOAD8},
    {"STORE8",     OP_STORE8},
    {"LOAD_IDX",   OP_LOAD_IDX},
    {"STORE_IDX",  OP_STORE_IDX},
    {"LOAD8_IDX",  OP_LOAD8_IDX},
    {"STORE8_IDX", OP_STORE8_IDX},
    {"SYSCALL",    OP_SYSCALL},
    {nullptr, 0}
};

static bool lookupMnemonic(const char* name, uint8_t& out) {
    for (int i = 0; MNEMONICS[i].name; i++) {
        if (strcmp(name, MNEMONICS[i].name) == 0) {
            out = MNEMONICS[i].opcode;
            return true;
        }
    }
    return false;
}

// --- String helpers ---

static void toUpper(char* dst, const char* src, int maxLen) {
    int i = 0;
    for (; src[i] && i < maxLen - 1; i++) {
        dst[i] = (char)toupper((unsigned char)src[i]);
    }
    dst[i] = '\0';
}

static bool parseNumber(const char* str, int32_t& out) {
    if (!str || !str[0]) return false;

    char* end;
    long val;
    if (str[0] == '0' && (str[1] == 'x' || str[1] == 'X')) {
        val = strtol(str, &end, 16);
    } else if (str[0] == '0' && str[1] >= '0' && str[1] <= '7') {
        val = strtol(str, &end, 8);
    } else {
        val = strtol(str, &end, 10);
    }

    if (*end != '\0') return false;
    out = (int32_t)val;
    return true;
}

// --- Parsed line types ---

enum LineKind { LINE_EMPTY, LINE_LABEL, LINE_INSTRUCTION, LINE_DATA, LINE_ORG };

struct ParsedLine {
    LineKind kind;
    int      lineNum; // 1-based
    char     text[128]; // mnemonic or label name (upper-cased for mnemonics)
    char     operand[128]; // operand string (original case for label refs)
    int32_t  dataBytes[64];
    int      dataCount;
    uint16_t orgAddr;
};

// --- Line parsing ---

static bool parseLine(const char* raw, ParsedLine& out) {
    out.kind = LINE_EMPTY;
    out.text[0] = '\0';
    out.operand[0] = '\0';
    out.dataCount = 0;
    out.orgAddr = 0;

    // Strip comments
    char line[256];
    int lineLen = 0;
    for (int i = 0; raw[i]; i++) {
        if (raw[i] == ';') break;
        if (lineLen < 255) line[lineLen++] = raw[i];
    }
    line[lineLen] = '\0';

    // Trim whitespace
    int start = 0;
    while (line[start] == ' ' || line[start] == '\t') start++;
    int end = lineLen - 1;
    while (end >= start && (line[end] == ' ' || line[end] == '\t' || line[end] == '\r' || line[end] == '\n')) end--;

    if (end < start) {
        out.kind = LINE_EMPTY;
        return true;
    }

    // Check for label (ends with ':')
    if (line[end] == ':') {
        out.kind = LINE_LABEL;
        int len = end - start;
        if (len > ASM_LABEL_MAXLEN) len = ASM_LABEL_MAXLEN;
        memcpy(out.text, line + start, len);
        out.text[len] = '\0';
        return true;
    }

    // Extract first word
    char firstWord[128];
    int fw = 0;
    int pos = start;
    while (pos <= end && line[pos] != ' ' && line[pos] != '\t') {
        if (fw < 127) firstWord[fw++] = line[pos];
        pos++;
    }
    firstWord[fw] = '\0';

    // Check for .data directive
    char upper[128];
    toUpper(upper, firstWord, 128);
    if (strcmp(upper, ".DATA") == 0) {
        out.kind = LINE_DATA;
        // Parse comma/space-separated byte values
        while (pos <= end && (line[pos] == ' ' || line[pos] == '\t')) pos++;
        out.dataCount = 0;
        while (pos <= end) {
            // Skip separators
            while (pos <= end && (line[pos] == ' ' || line[pos] == '\t' || line[pos] == ',')) pos++;
            if (pos > end) break;
            // Extract token
            char token[32];
            int ti = 0;
            while (pos <= end && line[pos] != ' ' && line[pos] != '\t' && line[pos] != ',') {
                if (ti < 31) token[ti++] = line[pos];
                pos++;
            }
            token[ti] = '\0';
            if (ti == 0) break;
            int32_t val;
            if (!parseNumber(token, val)) {
                snprintf(out.text, sizeof(out.text), "Invalid byte: %s", token);
                return false;
            }
            if (val < 0 || val > 255) {
                snprintf(out.text, sizeof(out.text), "Invalid byte: %s", token);
                return false;
            }
            if (out.dataCount < 64) {
                out.dataBytes[out.dataCount++] = val;
            }
        }
        return true;
    }

    // Check for .org directive
    if (strcmp(upper, ".ORG") == 0) {
        out.kind = LINE_ORG;
        while (pos <= end && (line[pos] == ' ' || line[pos] == '\t')) pos++;
        char addrStr[32];
        int ai = 0;
        while (pos <= end && line[pos] != ' ' && line[pos] != '\t') {
            if (ai < 31) addrStr[ai++] = line[pos];
            pos++;
        }
        addrStr[ai] = '\0';
        int32_t addr;
        if (!parseNumber(addrStr, addr)) {
            snprintf(out.text, sizeof(out.text), "Invalid .org address");
            return false;
        }
        out.orgAddr = (uint16_t)addr;
        return true;
    }

    // Instruction
    out.kind = LINE_INSTRUCTION;
    toUpper(out.text, firstWord, sizeof(out.text));

    // Skip whitespace to operand
    while (pos <= end && (line[pos] == ' ' || line[pos] == '\t')) pos++;
    if (pos <= end) {
        int oi = 0;
        while (pos <= end) {
            // Trim trailing whitespace from operand
            if (oi < 127) out.operand[oi++] = line[pos];
            pos++;
        }
        out.operand[oi] = '\0';
        // Trim trailing whitespace
        while (oi > 0 && (out.operand[oi-1] == ' ' || out.operand[oi-1] == '\t')) {
            out.operand[--oi] = '\0';
        }
    }

    return true;
}

// --- Resolve operand: number or label ---

static bool resolveOperand(const char* operand, const AsmLabel* labels, int labelCount, int32_t& out) {
    // Try as number first
    if (parseNumber(operand, out)) return true;

    // Try as label
    for (int i = 0; i < labelCount; i++) {
        if (strcmp(labels[i].name, operand) == 0) {
            out = labels[i].addr;
            return true;
        }
    }

    return false;
}

// --- Two-pass assembler ---

AssemblerResult assemble(const char* source) {
    AssemblerResult result;
    memset(&result, 0, sizeof(result));

    // Split source into lines
    ParsedLine lines[ASM_MAX_LINES];
    int lineCount = 0;

    const char* p = source;
    int lineNum = 1;
    while (*p) {
        // Find end of line
        const char* lineStart = p;
        while (*p && *p != '\n') p++;

        int lineLen = (int)(p - lineStart);
        char lineBuf[256];
        if (lineLen > 255) lineLen = 255;
        memcpy(lineBuf, lineStart, lineLen);
        lineBuf[lineLen] = '\0';

        if (*p == '\n') p++;

        if (lineCount >= ASM_MAX_LINES) {
            result.error = true;
            result.errorLine = lineNum;
            snprintf(result.errorMsg, sizeof(result.errorMsg), "Too many lines");
            return result;
        }

        ParsedLine& pl = lines[lineCount];
        pl.lineNum = lineNum;
        if (!parseLine(lineBuf, pl)) {
            result.error = true;
            result.errorLine = lineNum;
            snprintf(result.errorMsg, sizeof(result.errorMsg), "%s", pl.text);
            return result;
        }
        lineCount++;
        lineNum++;
    }

    // Pass 1: collect labels and compute addresses
    uint16_t addr = 0;
    for (int i = 0; i < lineCount; i++) {
        ParsedLine& pl = lines[i];
        switch (pl.kind) {
            case LINE_LABEL:
                // Check for duplicate
                for (int j = 0; j < (int)result.labelCount; j++) {
                    if (strcmp(result.labels[j].name, pl.text) == 0) {
                        result.error = true;
                        result.errorLine = pl.lineNum;
                        snprintf(result.errorMsg, sizeof(result.errorMsg),
                                 "Duplicate label: \"%s\"", pl.text);
                        return result;
                    }
                }
                if (result.labelCount >= ASM_MAX_LABELS) {
                    result.error = true;
                    result.errorLine = pl.lineNum;
                    snprintf(result.errorMsg, sizeof(result.errorMsg), "Too many labels");
                    return result;
                }
                strncpy(result.labels[result.labelCount].name, pl.text, ASM_LABEL_MAXLEN);
                result.labels[result.labelCount].name[ASM_LABEL_MAXLEN] = '\0';
                result.labels[result.labelCount].addr = addr;
                result.labelCount++;
                break;

            case LINE_INSTRUCTION: {
                uint8_t op;
                if (!lookupMnemonic(pl.text, op)) {
                    result.error = true;
                    result.errorLine = pl.lineNum;
                    snprintf(result.errorMsg, sizeof(result.errorMsg),
                             "Unknown mnemonic: %s", pl.text);
                    return result;
                }
                addr += 1 + operandSize(op);
                break;
            }

            case LINE_DATA:
                addr += pl.dataCount;
                break;

            case LINE_ORG:
                addr = pl.orgAddr;
                break;

            case LINE_EMPTY:
                break;
        }
    }

    // Pass 2: emit bytecode
    uint32_t outPos = 0;
    for (int i = 0; i < lineCount; i++) {
        ParsedLine& pl = lines[i];
        switch (pl.kind) {
            case LINE_LABEL:
            case LINE_EMPTY:
                break;

            case LINE_ORG:
                while (outPos < pl.orgAddr) {
                    if (outPos < ASM_MAX_OUTPUT) {
                        result.bytecode[outPos] = 0;
                    }
                    outPos++;
                }
                break;

            case LINE_DATA:
                for (int j = 0; j < pl.dataCount; j++) {
                    if (outPos < ASM_MAX_OUTPUT) {
                        result.bytecode[outPos] = (uint8_t)pl.dataBytes[j];
                    }
                    outPos++;
                }
                break;

            case LINE_INSTRUCTION: {
                uint8_t op;
                lookupMnemonic(pl.text, op); // already validated in pass 1
                uint8_t opSz = operandSize(op);

                if (outPos < ASM_MAX_OUTPUT) {
                    result.bytecode[outPos] = op;
                }
                outPos++;

                if (opSz > 0) {
                    if (pl.operand[0] == '\0') {
                        result.error = true;
                        result.errorLine = pl.lineNum;
                        snprintf(result.errorMsg, sizeof(result.errorMsg),
                                 "%s requires an operand", pl.text);
                        return result;
                    }

                    if (opSz == 1) {
                        int32_t value;
                        if (!resolveOperand(pl.operand, result.labels, result.labelCount, value)) {
                            result.error = true;
                            result.errorLine = pl.lineNum;
                            snprintf(result.errorMsg, sizeof(result.errorMsg),
                                     "Undefined label or invalid operand: \"%s\"", pl.operand);
                            return result;
                        }
                        if (outPos < ASM_MAX_OUTPUT) {
                            result.bytecode[outPos] = (uint8_t)(value & 0xFF);
                        }
                        outPos++;
                    } else {
                        // 2-byte operand: try "lo hi" format first (two space-separated bytes)
                        const char* space = strchr(pl.operand, ' ');
                        if (space) {
                            // Parse as two separate byte values
                            char loPart[64], hiPart[64];
                            int loLen = (int)(space - pl.operand);
                            if (loLen > 63) loLen = 63;
                            memcpy(loPart, pl.operand, loLen);
                            loPart[loLen] = '\0';
                            const char* hiStart = space + 1;
                            while (*hiStart == ' ' || *hiStart == '\t') hiStart++;
                            strncpy(hiPart, hiStart, 63);
                            hiPart[63] = '\0';

                            int32_t lo, hi;
                            if (!parseNumber(loPart, lo) || !parseNumber(hiPart, hi)) {
                                result.error = true;
                                result.errorLine = pl.lineNum;
                                snprintf(result.errorMsg, sizeof(result.errorMsg),
                                         "Invalid PUSH16 operand: \"%s\"", pl.operand);
                                return result;
                            }
                            if (outPos < ASM_MAX_OUTPUT) {
                                result.bytecode[outPos] = (uint8_t)(lo & 0xFF);
                            }
                            outPos++;
                            if (outPos < ASM_MAX_OUTPUT) {
                                result.bytecode[outPos] = (uint8_t)(hi & 0xFF);
                            }
                            outPos++;
                        } else {
                            // Single value or label — emit little-endian
                            int32_t value;
                            if (!resolveOperand(pl.operand, result.labels, result.labelCount, value)) {
                                result.error = true;
                                result.errorLine = pl.lineNum;
                                snprintf(result.errorMsg, sizeof(result.errorMsg),
                                         "Undefined label or invalid operand: \"%s\"", pl.operand);
                                return result;
                            }
                            if (outPos < ASM_MAX_OUTPUT) {
                                result.bytecode[outPos] = (uint8_t)(value & 0xFF);
                            }
                            outPos++;
                            if (outPos < ASM_MAX_OUTPUT) {
                                result.bytecode[outPos] = (uint8_t)((value >> 8) & 0xFF);
                            }
                            outPos++;
                        }
                    }
                }
                break;
            }
        }
    }

    result.length = (uint16_t)outPos;
    return result;
}

int32_t findLabel(const AssemblerResult& result, const char* name) {
    for (int i = 0; i < (int)result.labelCount; i++) {
        if (strcmp(result.labels[i].name, name) == 0) {
            return result.labels[i].addr;
        }
    }
    return -1;
}
