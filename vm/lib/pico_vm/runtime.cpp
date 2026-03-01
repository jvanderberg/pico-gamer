#include "runtime.h"
#include "vm.h"
#include "display.h"
#include "sprites.h"
#include "syscalls.h"

bool execGameFrame(VMState& vm, Framebuffer& fb, SyscallContext& ctx,
                   SpriteTable& sprites, WallTable& walls) {
    // 1. Clear back buffer
    clearFB(fb);

    // 2. Run VM instructions
    ctx.yieldRequested = false;
    uint32_t cycles = 0;

    while (cycles < CYCLES_PER_FRAME && !ctx.yieldRequested) {
        if (!step(vm, handleSyscall, &ctx)) {
            // VM halted — do final sprite update + draw
            updateSprites(sprites, walls, FP_SCALE, vm.memory);
            runHitCallbacks(sprites, vm, handleSyscall, &ctx);
            drawSprites(sprites, vm.memory, fb);
            swapBuffers(fb);
            return false;
        }
        cycles++;
    }

    // 3. Update sprites (FP_SCALE = 1.0x speed at 60fps)
    updateSprites(sprites, walls, FP_SCALE, vm.memory);

    // 4. Run hit callbacks
    runHitCallbacks(sprites, vm, handleSyscall, &ctx);

    // 5. Draw sprites
    drawSprites(sprites, vm.memory, fb);

    // 6. Swap buffers
    swapBuffers(fb);

    return true;
}
