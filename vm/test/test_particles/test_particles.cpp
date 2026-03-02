#include <unity.h>
#include "particles.h"
#include "display.h"

static ParticleTable pt;
static Framebuffer fb;
static uint16_t rng;

void setUp(void) {
    pt = createParticleTable();
    fb = createFramebuffer();
    rng = 1;  // deterministic seed
}
void tearDown(void) {}

// --- Helpers ---

static void setupEmitter(int slot, int x, int y, uint8_t speed, uint8_t life,
                          uint8_t spread, uint8_t dir, int8_t gravity, uint8_t flags) {
    Emitter& e = pt.emitters[slot];
    e.x_fp = (int16_t)(x << 8);
    e.y_fp = (int16_t)(y << 8);
    e.speed = speed;
    e.life = life;
    e.spread = spread;
    e.direction = dir;
    e.gravity = gravity;
    e.rate = 0;
    e.flags = flags;
}

static int countLiveParticles(void) {
    int count = 0;
    for (int i = 0; i < MAX_PARTICLES; i++) {
        if (pt.particles[i].life > 0) count++;
    }
    return count;
}

// --- Tests ---

void test_burst_spawns_particles(void) {
    setupEmitter(0, 64, 32, 100, 30, 0, 0, 0, 0);
    burstParticles(pt, 0, 10, rng);
    TEST_ASSERT_EQUAL_INT(10, countLiveParticles());
}

void test_burst_respects_pool_limit(void) {
    setupEmitter(0, 64, 32, 100, 30, 0, 0, 0, 0);
    burstParticles(pt, 0, 200, rng);  // request 200, only 128 available
    TEST_ASSERT_EQUAL_INT(MAX_PARTICLES, countLiveParticles());
}

void test_particle_position_from_emitter(void) {
    setupEmitter(0, 50, 25, 0, 30, 0, 0, 0, 0);
    burstParticles(pt, 0, 1, rng);

    // Find the spawned particle
    int idx = -1;
    for (int i = 0; i < MAX_PARTICLES; i++) {
        if (pt.particles[i].life > 0) { idx = i; break; }
    }
    TEST_ASSERT_TRUE(idx >= 0);
    TEST_ASSERT_EQUAL_INT16(50 << 8, pt.particles[idx].x_fp);
    TEST_ASSERT_EQUAL_INT16(25 << 8, pt.particles[idx].y_fp);
}

void test_lifetime_decays(void) {
    setupEmitter(0, 64, 32, 0, 10, 0, 0, 0, 0);  // speed=0 so no movement
    burstParticles(pt, 0, 1, rng);

    // Find the particle
    int idx = -1;
    for (int i = 0; i < MAX_PARTICLES; i++) {
        if (pt.particles[i].life > 0) { idx = i; break; }
    }
    TEST_ASSERT_TRUE(idx >= 0);
    TEST_ASSERT_EQUAL_UINT8(10, pt.particles[idx].life);

    updateParticles(pt, rng);
    TEST_ASSERT_EQUAL_UINT8(9, pt.particles[idx].life);

    // Run 9 more frames — particle should die
    for (int i = 0; i < 9; i++) {
        updateParticles(pt, rng);
    }
    TEST_ASSERT_EQUAL_UINT8(0, pt.particles[idx].life);
    TEST_ASSERT_EQUAL_INT(0, countLiveParticles());
}

void test_gravity_accelerates_vy(void) {
    setupEmitter(0, 64, 32, 0, 60, 0, 0, 2, 0);  // gravity=2, speed=0
    burstParticles(pt, 0, 1, rng);

    int idx = -1;
    for (int i = 0; i < MAX_PARTICLES; i++) {
        if (pt.particles[i].life > 0) { idx = i; break; }
    }
    TEST_ASSERT_TRUE(idx >= 0);
    TEST_ASSERT_EQUAL_INT16(0, pt.particles[idx].vy);

    updateParticles(pt, rng);
    TEST_ASSERT_EQUAL_INT16(2, pt.particles[idx].vy);

    updateParticles(pt, rng);
    TEST_ASSERT_EQUAL_INT16(4, pt.particles[idx].vy);
}

void test_velocity_moves_particle(void) {
    // Direction 0 = right (cos256(0) = 256), speed=64
    // vx = (64 * 256) / 64 = 256 velocity units
    // Per frame: x_fp += vx * 4 = 1024 = 4 pixels in 8.8
    setupEmitter(0, 10, 10, 64, 60, 0, 0, 0, 0);
    burstParticles(pt, 0, 1, rng);

    int idx = -1;
    for (int i = 0; i < MAX_PARTICLES; i++) {
        if (pt.particles[i].life > 0) { idx = i; break; }
    }
    TEST_ASSERT_TRUE(idx >= 0);

    int16_t startX = pt.particles[idx].x_fp;
    updateParticles(pt, rng);
    int16_t endX = pt.particles[idx].x_fp;

    // Particle should have moved right
    TEST_ASSERT_TRUE(endX > startX);
}

void test_draw_sets_pixels(void) {
    clearFB(fb);
    setupEmitter(0, 10, 10, 0, 30, 0, 0, 0, 0);
    burstParticles(pt, 0, 1, rng);

    drawParticles(pt, fb);

    // Pixel at (10, 10) should be set
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 10, 10));
}

void test_draw_2x2_sets_four_pixels(void) {
    clearFB(fb);
    setupEmitter(0, 20, 20, 0, 30, 0, 0, 0, EMITTER_2X2);
    burstParticles(pt, 0, 1, rng);

    drawParticles(pt, fb);

    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 20, 20));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 21, 20));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 20, 21));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 21, 21));
}

void test_draw_black_clears_pixel(void) {
    // Set pixel first, then draw black particle on top
    clearFB(fb);
    setPixel(fb, 15, 15, 1);
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 15, 15));

    setupEmitter(0, 15, 15, 0, 30, 0, 0, 0, EMITTER_BLACK);
    burstParticles(pt, 0, 1, rng);
    drawParticles(pt, fb);

    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 15, 15));
}

void test_clear_specific_emitter(void) {
    setupEmitter(0, 10, 10, 0, 60, 0, 0, 0, 0);
    setupEmitter(1, 50, 50, 0, 60, 0, 0, 0, 0);
    burstParticles(pt, 0, 5, rng);
    burstParticles(pt, 1, 3, rng);
    TEST_ASSERT_EQUAL_INT(8, countLiveParticles());

    clearParticles(pt, 0);
    // Only emitter 1's particles should remain
    TEST_ASSERT_EQUAL_INT(3, countLiveParticles());
}

void test_clear_all(void) {
    setupEmitter(0, 10, 10, 0, 60, 0, 0, 0, 0);
    setupEmitter(1, 50, 50, 0, 60, 0, 0, 0, 0);
    burstParticles(pt, 0, 5, rng);
    burstParticles(pt, 1, 3, rng);
    TEST_ASSERT_EQUAL_INT(8, countLiveParticles());

    clearParticles(pt, 255);
    TEST_ASSERT_EQUAL_INT(0, countLiveParticles());
}

void test_continuous_emitter_spawns(void) {
    setupEmitter(0, 64, 32, 50, 30, 128, 64, 0, EMITTER_ACTIVE);
    pt.emitters[0].rate = 3;

    updateParticles(pt, rng);
    TEST_ASSERT_EQUAL_INT(3, countLiveParticles());

    updateParticles(pt, rng);
    TEST_ASSERT_EQUAL_INT(6, countLiveParticles());
}

void test_continuous_emitter_off_when_inactive(void) {
    setupEmitter(0, 64, 32, 50, 30, 128, 64, 0, 0);  // flags=0, not active
    pt.emitters[0].rate = 3;

    updateParticles(pt, rng);
    TEST_ASSERT_EQUAL_INT(0, countLiveParticles());
}

void test_flicker_hides_at_life_2(void) {
    clearFB(fb);
    setupEmitter(0, 30, 30, 0, 2, 0, 0, 0, 0);  // life=2
    burstParticles(pt, 0, 1, rng);

    // life=2, even, should flicker off (life <= 3 && life%2 == 0)
    drawParticles(pt, fb);
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 30, 30));
}

void test_flicker_shows_at_life_3(void) {
    clearFB(fb);
    setupEmitter(0, 30, 30, 0, 3, 0, 0, 0, 0);  // life=3
    burstParticles(pt, 0, 1, rng);

    // life=3, odd, should be visible
    drawParticles(pt, fb);
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 30, 30));
}

void test_invalid_slot_ignored(void) {
    burstParticles(pt, -1, 10, rng);
    TEST_ASSERT_EQUAL_INT(0, countLiveParticles());

    burstParticles(pt, 5, 10, rng);
    TEST_ASSERT_EQUAL_INT(0, countLiveParticles());

    clearParticles(pt, 99);  // should not crash
}

void test_spread_varies_direction(void) {
    setupEmitter(0, 64, 32, 100, 60, 128, 0, 0, 0);  // spread=128 (full circle)
    burstParticles(pt, 0, 20, rng);

    // With full circle spread, particles should have varying velocities
    bool hasPositiveVx = false, hasNegativeVx = false;
    for (int i = 0; i < MAX_PARTICLES; i++) {
        if (pt.particles[i].life == 0) continue;
        if (pt.particles[i].vx > 0) hasPositiveVx = true;
        if (pt.particles[i].vx < 0) hasNegativeVx = true;
    }
    // With 20 particles and full circle, we should see both directions
    TEST_ASSERT_TRUE(hasPositiveVx);
    TEST_ASSERT_TRUE(hasNegativeVx);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_burst_spawns_particles);
    RUN_TEST(test_burst_respects_pool_limit);
    RUN_TEST(test_particle_position_from_emitter);
    RUN_TEST(test_lifetime_decays);
    RUN_TEST(test_gravity_accelerates_vy);
    RUN_TEST(test_velocity_moves_particle);
    RUN_TEST(test_draw_sets_pixels);
    RUN_TEST(test_draw_2x2_sets_four_pixels);
    RUN_TEST(test_draw_black_clears_pixel);
    RUN_TEST(test_clear_specific_emitter);
    RUN_TEST(test_clear_all);
    RUN_TEST(test_continuous_emitter_spawns);
    RUN_TEST(test_continuous_emitter_off_when_inactive);
    RUN_TEST(test_flicker_hides_at_life_2);
    RUN_TEST(test_flicker_shows_at_life_3);
    RUN_TEST(test_invalid_slot_ignored);
    RUN_TEST(test_spread_varies_direction);
    return UNITY_END();
}
