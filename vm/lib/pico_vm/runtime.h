#pragma once
#include <cstdint>

struct VMState;
struct Framebuffer;
struct SpriteTable;
struct WallTable;
struct SyscallContext;

static const uint32_t CYCLES_PER_FRAME = 50000;

// Execute one game frame:
// 1. Clear back buffer
// 2. Run VM instructions (up to CYCLES_PER_FRAME or YIELD)
// 3. Update sprites
// 4. Run hit callbacks
// 5. Draw sprites
// 6. Swap front/back buffers
// Returns true if VM is still running, false if halted.
bool execGameFrame(VMState& vm, Framebuffer& fb, SyscallContext& ctx,
                   SpriteTable& sprites, WallTable& walls);
