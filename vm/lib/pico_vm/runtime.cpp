#include "runtime.h"
#include "vm.h"
#include "display.h"
#include "sprites.h"
#include "particles.h"
#include "syscalls.h"

// Helper: extract viewport params with safe defaults
static void getViewportParams(const SyscallContext& ctx,
                              int16_t& world_w, int16_t& world_h,
                              int16_t& cam_x, int16_t& cam_y) {
    if (ctx.viewport) {
        world_w = ctx.viewport->world_w;
        world_h = ctx.viewport->world_h;
        cam_x = fpToPixel(ctx.viewport->cam_x_fp);
        cam_y = fpToPixel(ctx.viewport->cam_y_fp);
    } else {
        world_w = SCREEN_W;
        world_h = SCREEN_H;
        cam_x = 0;
        cam_y = 0;
    }
}

bool execGameFrame(VMState& vm, Framebuffer& fb, SyscallContext& ctx,
                   SpriteTable& sprites, WallTable& walls) {
    // 1. Clear back buffer
    clearFB(fb);

    // 2. Run VM instructions
    ctx.yieldRequested = false;
    uint32_t cycles = 0;

    int16_t ww, wh, cx, cy;

    while (cycles < CYCLES_PER_FRAME && !ctx.yieldRequested) {
        if (!step(vm, handleSyscall, &ctx)) {
            // VM halted — do final sprite update + draw
            updateSpriteAnimations(sprites);
            getViewportParams(ctx, ww, wh, cx, cy);
            updateSprites(sprites, walls, FP_SCALE, vm.memory, ww, wh);
            if (ctx.tilemap && ctx.tilemap->active) {
                resolveTileCollisions(sprites, *ctx.tilemap, vm.memory);
            }
            if (ctx.viewport) updateViewport(*ctx.viewport, sprites);
            getViewportParams(ctx, ww, wh, cx, cy);
            runHitCallbacks(sprites, vm, handleSyscall, &ctx);
            if (ctx.tilemap && ctx.tilemap->active) {
                drawTileMap(*ctx.tilemap, vm.memory, fb, cx, cy);
            }
            drawSprites(sprites, vm.memory, fb, cx, cy);
            if (ctx.particles) {
                updateParticles(*ctx.particles, ctx.rngState);
                drawParticles(*ctx.particles, fb, cx, cy);
            }
            swapBuffers(fb);
            return false;
        }
        cycles++;
    }

    // 3. Sprite animations
    updateSpriteAnimations(sprites);

    // 4. Update sprites (physics)
    getViewportParams(ctx, ww, wh, cx, cy);
    updateSprites(sprites, walls, FP_SCALE, vm.memory, ww, wh);

    // 5. Tile or wall collisions
    if (ctx.tilemap && ctx.tilemap->active) {
        resolveTileCollisions(sprites, *ctx.tilemap, vm.memory);
        ctx.tilemap->frameCount++;
    }

    // 6. Update viewport camera (after sprite physics, before drawing)
    if (ctx.viewport) updateViewport(*ctx.viewport, sprites);
    getViewportParams(ctx, ww, wh, cx, cy);

    // 7. Run hit callbacks
    runHitCallbacks(sprites, vm, handleSyscall, &ctx);

    // 8. Draw tilemap (behind sprites)
    if (ctx.tilemap && ctx.tilemap->active) {
        drawTileMap(*ctx.tilemap, vm.memory, fb, cx, cy);
    }

    // 9. Draw sprites
    drawSprites(sprites, vm.memory, fb, cx, cy);

    // 10. Update and draw particles
    if (ctx.particles) {
        updateParticles(*ctx.particles, ctx.rngState);
        drawParticles(*ctx.particles, fb, cx, cy);
    }

    // 8. Swap buffers
    swapBuffers(fb);

    return true;
}
