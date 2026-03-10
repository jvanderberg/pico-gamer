#include "particles.h"
#include "display.h"
#include "sin_table.h"
#include "syscalls.h"  // for xorshift16

ParticleTable createParticleTable() {
    ParticleTable table;
    resetParticleTable(table);
    return table;
}

void resetParticleTable(ParticleTable& table) {
    for (int i = 0; i < MAX_EMITTERS; i++) {
        Emitter& e = table.emitters[i];
        e.x_fp = 0;
        e.y_fp = 0;
        e.speed = 0;
        e.life = 0;
        e.spread = 0;
        e.direction = 0;
        e.gravity = 0;
        e.rate = 0;
        e.flags = 0;
        e._pad = 0;
    }
    for (int i = 0; i < MAX_PARTICLES; i++) {
        table.particles[i].life = 0;
    }
}

// Find a dead particle slot, return index or -1 if pool exhausted.
static int findFreeParticle(const ParticleTable& table) {
    for (int i = 0; i < MAX_PARTICLES; i++) {
        if (table.particles[i].life == 0) return i;
    }
    return -1;
}

// Spawn a single particle from an emitter.
static void spawnOne(ParticleTable& table, int emitterIdx, uint16_t& rngState) {
    int idx = findFreeParticle(table);
    if (idx < 0) return;

    const Emitter& e = table.emitters[emitterIdx];
    Particle& p = table.particles[idx];

    p.x_fp = e.x_fp;
    p.y_fp = e.y_fp;

    // Compute angle: direction +/- spread
    int angle = e.direction;
    if (e.spread > 0) {
        uint16_t r = xorshift16(rngState);
        // Random offset in [-spread, +spread]
        int offset = (int)(r % (2 * (uint16_t)e.spread + 1)) - (int)e.spread;
        angle = (angle + offset) & 0xFF;
    }

    // Compute speed with optional variance
    int speed = e.speed;
    if (e.flags & EMITTER_SPEED_VAR) {
        uint16_t r = xorshift16(rngState);
        // +/- 25%: multiply by [192..320]/256 => [0.75..1.25]
        int scale = 192 + (int)(r % 129);  // 192 to 320
        speed = (speed * scale) / 256;
        if (speed > 255) speed = 255;
    }

    // Convert polar to cartesian velocity
    // sin256/cos256 return [-256, +256], VEL_DIVISOR = 64
    // vx = (speed * cos256(angle)) / 64
    p.vx = (int16_t)((speed * cos256(angle)) / 64);
    p.vy = (int16_t)((speed * sin256(angle)) / 64);

    // Life with optional variance
    int life = e.life;
    if (e.flags & EMITTER_LIFE_VAR) {
        uint16_t r = xorshift16(rngState);
        int scale = 192 + (int)(r % 129);
        life = (life * scale) / 256;
        if (life > 255) life = 255;
        if (life < 1) life = 1;
    }
    p.life = (uint8_t)life;

    p.gravity = e.gravity;

    // Build particle flags from emitter flags
    p.flags = 0;
    if (e.flags & EMITTER_2X2)   p.flags |= PFX_FLAG_2X2;
    if (e.flags & EMITTER_BLACK) p.flags |= PFX_FLAG_BLACK;
    p.flags |= (uint8_t)((emitterIdx & 0x03) << 6);
}

void burstParticles(ParticleTable& table, int slot, int count, uint16_t& rngState) {
    if (slot < 0 || slot >= MAX_EMITTERS) return;
    for (int i = 0; i < count; i++) {
        spawnOne(table, slot, rngState);
    }
}

void updateParticles(ParticleTable& table, uint16_t& rngState) {
    // Continuous emitters: spawn rate particles/frame
    for (int i = 0; i < MAX_EMITTERS; i++) {
        Emitter& e = table.emitters[i];
        if ((e.flags & EMITTER_ACTIVE) && e.rate > 0) {
            for (int j = 0; j < e.rate; j++) {
                spawnOne(table, i, rngState);
            }
        }
    }

    // Update all live particles
    for (int i = 0; i < MAX_PARTICLES; i++) {
        Particle& p = table.particles[i];
        if (p.life == 0) continue;

        p.life--;
        if (p.life == 0) continue;  // just died

        // Apply velocity (same convention as sprites: /64 for px/frame, but
        // particles store velocity already in the right units for 8.8 FP)
        // vx is in sprite velocity units where 64 = 1px/frame
        // For 8.8 fixed-point: 1px = 256, so we multiply by 256/64 = 4
        p.x_fp += p.vx * 4;
        p.y_fp += p.vy * 4;

        // Apply gravity to vy
        p.vy += (int16_t)p.gravity;
    }
}

void drawParticles(const ParticleTable& table, Framebuffer& fb,
                   int16_t cam_x, int16_t cam_y) {
    for (int i = 0; i < MAX_PARTICLES; i++) {
        const Particle& p = table.particles[i];
        if (p.life == 0) continue;

        // Flicker effect in last 3 frames of life
        if (p.life <= 3 && (p.life & 1) == 0) continue;

        int px = (p.x_fp >> 8) - cam_x;
        int py = (p.y_fp >> 8) - cam_y;

        int color = (p.flags & PFX_FLAG_BLACK) ? 0 : 1;

        if (p.flags & PFX_FLAG_2X2) {
            setPixel(fb, px,     py,     color);
            setPixel(fb, px + 1, py,     color);
            setPixel(fb, px,     py + 1, color);
            setPixel(fb, px + 1, py + 1, color);
        } else {
            setPixel(fb, px, py, color);
        }
    }
}

void clearParticles(ParticleTable& table, int slot) {
    if (slot == 255) {
        // Clear everything
        resetParticleTable(table);
        return;
    }
    if (slot < 0 || slot >= MAX_EMITTERS) return;

    // Reset this emitter
    Emitter& e = table.emitters[slot];
    e.x_fp = 0;
    e.y_fp = 0;
    e.speed = 0;
    e.life = 0;
    e.spread = 0;
    e.direction = 0;
    e.gravity = 0;
    e.rate = 0;
    e.flags = 0;

    // Kill particles belonging to this emitter
    uint8_t emitterBits = (uint8_t)((slot & 0x03) << 6);
    for (int i = 0; i < MAX_PARTICLES; i++) {
        if (table.particles[i].life > 0 &&
            (table.particles[i].flags & 0xC0) == emitterBits) {
            table.particles[i].life = 0;
        }
    }
}
