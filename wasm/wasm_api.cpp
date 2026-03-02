#include <emscripten/emscripten.h>
#include <cstring>
#include "vm.h"
#include "memory.h"
#include "display.h"
#include "sprites.h"
#include "particles.h"
#include "syscalls.h"
#include "runtime.h"

// File-scope globals — single VM instance
static VMState        vm;
static Framebuffer    fb;
static SpriteTable    sprites;
static WallTable      walls;
static ParticleTable  particles;
static SyscallContext ctx;

extern "C" {

EMSCRIPTEN_KEEPALIVE
void vm_init() {
    vm = createVM();
    fb = createFramebuffer();
    sprites = createSpriteTable();
    walls = createWallTable();
    particles = createParticleTable();
    ctx = createSyscallContext(&fb, &sprites, &walls, &particles);
}

EMSCRIPTEN_KEEPALIVE
void vm_reset() {
    resetVM(vm);
    fb = createFramebuffer();
    resetSpriteTable(sprites);
    resetWallTable(walls);
    resetParticleTable(particles);
    ctx = createSyscallContext(&fb, &sprites, &walls, &particles);
}

EMSCRIPTEN_KEEPALIVE
void vm_load_program(uint8_t* data, uint32_t len) {
    loadProgram(vm.memory, data, (uint16_t)len);
}

EMSCRIPTEN_KEEPALIVE
void vm_set_input(uint16_t bits) {
    ctx.inputBits = bits;
}

EMSCRIPTEN_KEEPALIVE
void vm_set_elapsed_ms(uint16_t ms) {
    ctx.elapsed_ms = ms;
}

EMSCRIPTEN_KEEPALIVE
bool vm_exec_frame() {
    return execGameFrame(vm, fb, ctx, sprites, walls);
}

EMSCRIPTEN_KEEPALIVE
bool vm_step() {
    return step(vm, handleSyscall, &ctx);
}

EMSCRIPTEN_KEEPALIVE
bool vm_is_yielded() {
    return ctx.yieldRequested;
}

EMSCRIPTEN_KEEPALIVE
void vm_do_sprite_update() {
    updateSprites(sprites, walls, FP_SCALE, vm.memory);
    runHitCallbacks(sprites, vm, handleSyscall, &ctx);
    drawSprites(sprites, vm.memory, fb);
    swapBuffers(fb);
}

EMSCRIPTEN_KEEPALIVE
void vm_clear_fb() {
    clearFB(fb);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* vm_get_framebuffer() {
    return const_cast<uint8_t*>(frontBuf(fb));
}

EMSCRIPTEN_KEEPALIVE
uint16_t vm_get_pc() {
    return vm.pc;
}

EMSCRIPTEN_KEEPALIVE
uint16_t vm_get_sp() {
    return vm.sp;
}

EMSCRIPTEN_KEEPALIVE
uint16_t vm_get_tos() {
    return (vm.sp > 0) ? vm.stack[vm.sp - 1] : 0;
}

EMSCRIPTEN_KEEPALIVE
uint32_t vm_get_cycles() {
    return vm.cycles;
}

EMSCRIPTEN_KEEPALIVE
bool vm_is_halted() {
    return vm.halted;
}

EMSCRIPTEN_KEEPALIVE
uint16_t vm_get_stack_value(uint16_t idx) {
    return (idx < 256) ? vm.stack[idx] : 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t vm_read_mem(uint16_t addr) {
    return readU8(vm.memory, addr);
}

EMSCRIPTEN_KEEPALIVE
void vm_write_mem(uint16_t addr, uint8_t val) {
    writeU8(vm.memory, addr, val);
}

EMSCRIPTEN_KEEPALIVE
uint16_t vm_read_mem16(uint16_t addr) {
    return readU16(vm.memory, addr);
}

EMSCRIPTEN_KEEPALIVE
int vm_get_pixel_front(int x, int y) {
    return getPixelFront(fb, x, y);
}

// --- Audio command buffer ---

EMSCRIPTEN_KEEPALIVE
int vm_audio_cmd_count() {
    return ctx.audio.count;
}

EMSCRIPTEN_KEEPALIVE
uint8_t vm_audio_cmd_id(int i) {
    return (i >= 0 && i < ctx.audio.count) ? ctx.audio.cmds[i].id : 0;
}

EMSCRIPTEN_KEEPALIVE
uint16_t vm_audio_cmd_arg(int i, int j) {
    if (i >= 0 && i < ctx.audio.count && j >= 0 && j < ctx.audio.cmds[i].argCount)
        return ctx.audio.cmds[i].args[j];
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void vm_audio_cmd_clear() {
    ctx.audio.count = 0;
}

// --- Sprite introspection (getters) ---

EMSCRIPTEN_KEEPALIVE bool vm_spr_active(uint16_t slot) {
    return (slot < MAX_SPRITES) && sprites.sprites[slot].active;
}
EMSCRIPTEN_KEEPALIVE int16_t vm_spr_x(uint16_t slot) {
    return (slot < MAX_SPRITES) ? fpToPixel(sprites.sprites[slot].x_fp) : 0;
}
EMSCRIPTEN_KEEPALIVE int16_t vm_spr_y(uint16_t slot) {
    return (slot < MAX_SPRITES) ? fpToPixel(sprites.sprites[slot].y_fp) : 0;
}
EMSCRIPTEN_KEEPALIVE int16_t vm_spr_vx(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].vx : 0;
}
EMSCRIPTEN_KEEPALIVE int16_t vm_spr_vy(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].vy : 0;
}
EMSCRIPTEN_KEEPALIVE uint8_t vm_spr_width(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].width : 0;
}
EMSCRIPTEN_KEEPALIVE uint8_t vm_spr_height(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].height : 0;
}
EMSCRIPTEN_KEEPALIVE uint8_t vm_spr_flags(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].flags : 0;
}
EMSCRIPTEN_KEEPALIVE uint8_t vm_spr_edge(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].edge : 0;
}
EMSCRIPTEN_KEEPALIVE uint16_t vm_spr_angle(uint16_t slot) {
    return (slot < MAX_SPRITES) ? (uint16_t)((sprites.sprites[slot].angle_fp >> FP_SHIFT) & 0xFF) : 0;
}
EMSCRIPTEN_KEEPALIVE int16_t vm_spr_rot_speed(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].rotSpeed : 0;
}
EMSCRIPTEN_KEEPALIVE uint8_t vm_spr_coll_group(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].collGroup : 0;
}
EMSCRIPTEN_KEEPALIVE uint8_t vm_spr_coll_mask(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].collMask : 0;
}
EMSCRIPTEN_KEEPALIVE uint8_t vm_spr_sprite_mode(uint16_t slot) {
    return (slot < MAX_SPRITES) ? sprites.sprites[slot].spriteMode : 0;
}

// --- Sprite introspection (setters) ---

EMSCRIPTEN_KEEPALIVE void vm_spr_set_active(uint16_t slot, bool active) {
    if (slot < MAX_SPRITES) { sprites.sprites[slot].active = active; sprites.sprites[slot].visible = active; }
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_x(uint16_t slot, int16_t x) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].x_fp = pixelToFp(x);
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_y(uint16_t slot, int16_t y) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].y_fp = pixelToFp(y);
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_vx(uint16_t slot, int16_t vx) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].vx = vx;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_vy(uint16_t slot, int16_t vy) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].vy = vy;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_angle(uint16_t slot, uint16_t angle) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].angle_fp = ((int32_t)(angle & 0xFF)) << FP_SHIFT;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_rot_speed(uint16_t slot, int16_t rs) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].rotSpeed = rs;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_addr(uint16_t slot, uint16_t addr) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].addr = addr;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_width(uint16_t slot, uint8_t w) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].width = w;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_height(uint16_t slot, uint8_t h) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].height = h;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_flags(uint16_t slot, uint8_t flags) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].flags = flags;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_edge(uint16_t slot, uint8_t edge) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].edge = edge;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_coll_group(uint16_t slot, uint8_t g) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].collGroup = g;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_coll_mask(uint16_t slot, uint8_t m) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].collMask = m;
}
EMSCRIPTEN_KEEPALIVE void vm_spr_set_sprite_mode(uint16_t slot, uint8_t m) {
    if (slot < MAX_SPRITES) sprites.sprites[slot].spriteMode = m;
}

} // extern "C"
