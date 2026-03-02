#pragma once
#include <cstdint>

struct Framebuffer;

static const int MAX_EMITTERS  = 4;
static const int MAX_PARTICLES = 128;

// Particle flags:
//   bit 0: color (0=white, 1=black)
//   bit 1: 2x2 size
//   bits 6-7: emitter index (for internal tracking)
static const uint8_t PFX_FLAG_BLACK = 0x01;
static const uint8_t PFX_FLAG_2X2   = 0x02;

// Emitter flags:
//   bit 0: active (emitting continuously)
//   bit 2: 2x2 particles
//   bit 3: black particles
//   bit 4: speed variance (+/- 25%)
//   bit 5: life variance (+/- 25%)
static const uint8_t EMITTER_ACTIVE    = 0x01;
static const uint8_t EMITTER_2X2      = 0x04;
static const uint8_t EMITTER_BLACK    = 0x08;
static const uint8_t EMITTER_SPEED_VAR = 0x10;
static const uint8_t EMITTER_LIFE_VAR  = 0x20;

struct Particle {        // 12 bytes
    int16_t x_fp, y_fp;  // 8.8 fixed-point position
    int16_t vx, vy;      // velocity (same convention as sprites: 64 = 1px/frame)
    uint8_t life;         // remaining frames (0 = dead)
    int8_t  gravity;      // Y accel per frame (copied from emitter at spawn)
    uint8_t flags;        // bit 0: color, bit 1: 2x2, bits 6-7: emitter index
    uint8_t _pad;
};

struct Emitter {         // 12 bytes
    int16_t x_fp, y_fp;  // 8.8 source position
    uint8_t speed;        // particle speed (0-255, velocity units)
    uint8_t life;         // particle lifetime in frames
    uint8_t spread;       // cone half-angle (0=focused, 128=full circle)
    uint8_t direction;    // center angle (0-255, like sprite rotation)
    int8_t  gravity;      // Y acceleration (signed, +down)
    uint8_t rate;         // particles/frame for continuous mode (0=off)
    uint8_t flags;        // bit 0: active, bit 2: 2x2, bit 3: black, bit 4: speed var, bit 5: life var
    uint8_t _pad;
};

struct ParticleTable {
    Emitter  emitters[MAX_EMITTERS];
    Particle particles[MAX_PARTICLES];
};

ParticleTable createParticleTable();
void resetParticleTable(ParticleTable& table);

// Spawn a burst of count particles from emitter slot.
void burstParticles(ParticleTable& table, int slot, int count, uint16_t& rngState);

// Update all live particles (decrement life, apply velocity, apply gravity).
// Also spawn particles from continuous emitters.
void updateParticles(ParticleTable& table, uint16_t& rngState);

// Draw all live particles to the framebuffer.
void drawParticles(const ParticleTable& table, Framebuffer& fb);

// Clear particles: slot 0-3 clears that emitter + its particles; 255 clears all.
void clearParticles(ParticleTable& table, int slot);
