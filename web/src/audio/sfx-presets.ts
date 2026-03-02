/**
 * SFX preset table — 16 canned sound effects.
 * Each preset is an array of SfxStep executed by the synth's SFX engine.
 * Terminated by a step with waveform=0 (silence).
 *
 * delaySamples is relative to the previous step (samples at 44.1kHz).
 * filterCutoff of 0 means "don't change filter".
 */

export interface SfxStep {
  delaySamples: number;
  waveform: number;
  freqHz: number;
  pulseWidth: number;
  volume: number;
  filterCutoff: number;
}

// Waveform shorthand
const OFF   = 0;
const PULSE = 1;
const SAW   = 2;
const TRI   = 3;
const NOISE = 4;

// Helper: milliseconds to samples at 44.1kHz
const ms = (t: number) => Math.round(t * 44.1);

export const SFX_PRESETS: SfxStep[][] = [
  // 0: LASER — pulse wave, fast pitch sweep down
  [
    { delaySamples: 0,      waveform: PULSE, freqHz: 1000, pulseWidth: 128, volume: 255, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: PULSE, freqHz: 800,  pulseWidth: 128, volume: 255, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: PULSE, freqHz: 600,  pulseWidth: 128, volume: 200, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: PULSE, freqHz: 400,  pulseWidth: 128, volume: 150, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: PULSE, freqHz: 200,  pulseWidth: 128, volume: 80,  filterCutoff: 0 },
    { delaySamples: ms(3),  waveform: OFF,   freqHz: 0,    pulseWidth: 0,   volume: 0,   filterCutoff: 0 },
  ],

  // 1: EXPLODE — noise, fast attack, long decay, filter sweep down
  [
    { delaySamples: 0,       waveform: NOISE, freqHz: 200,  pulseWidth: 0, volume: 255, filterCutoff: 220 },
    { delaySamples: ms(30),  waveform: NOISE, freqHz: 150,  pulseWidth: 0, volume: 200, filterCutoff: 180 },
    { delaySamples: ms(60),  waveform: NOISE, freqHz: 100,  pulseWidth: 0, volume: 140, filterCutoff: 120 },
    { delaySamples: ms(80),  waveform: NOISE, freqHz: 80,   pulseWidth: 0, volume: 80,  filterCutoff: 60 },
    { delaySamples: ms(100), waveform: NOISE, freqHz: 60,   pulseWidth: 0, volume: 30,  filterCutoff: 30 },
    { delaySamples: ms(60),  waveform: OFF,   freqHz: 0,    pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 2: PICKUP — triangle, fast rising arpeggio C5→E5→G5→C6
  [
    { delaySamples: 0,      waveform: TRI, freqHz: 523, pulseWidth: 0, volume: 230, filterCutoff: 0 },
    { delaySamples: ms(4),  waveform: TRI, freqHz: 659, pulseWidth: 0, volume: 230, filterCutoff: 0 },
    { delaySamples: ms(4),  waveform: TRI, freqHz: 784, pulseWidth: 0, volume: 230, filterCutoff: 0 },
    { delaySamples: ms(4),  waveform: TRI, freqHz: 1047, pulseWidth: 0, volume: 255, filterCutoff: 0 },
    { delaySamples: ms(8),  waveform: TRI, freqHz: 1047, pulseWidth: 0, volume: 120, filterCutoff: 0 },
    { delaySamples: ms(6),  waveform: OFF, freqHz: 0,    pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 3: JUMP — triangle, quick pitch rise 200Hz→600Hz
  [
    { delaySamples: 0,      waveform: TRI, freqHz: 200, pulseWidth: 0, volume: 220, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: TRI, freqHz: 300, pulseWidth: 0, volume: 230, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: TRI, freqHz: 450, pulseWidth: 0, volume: 240, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: TRI, freqHz: 600, pulseWidth: 0, volume: 200, filterCutoff: 0 },
    { delaySamples: ms(8),  waveform: TRI, freqHz: 600, pulseWidth: 0, volume: 80,  filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: OFF, freqHz: 0,   pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 4: HIT — noise burst, very short decay
  [
    { delaySamples: 0,      waveform: NOISE, freqHz: 400, pulseWidth: 0, volume: 255, filterCutoff: 0 },
    { delaySamples: ms(3),  waveform: NOISE, freqHz: 400, pulseWidth: 0, volume: 120, filterCutoff: 0 },
    { delaySamples: ms(3),  waveform: NOISE, freqHz: 400, pulseWidth: 0, volume: 40,  filterCutoff: 0 },
    { delaySamples: ms(2),  waveform: OFF,   freqHz: 0,   pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 5: BOUNCE — pulse, short pitch dip and return
  [
    { delaySamples: 0,      waveform: PULSE, freqHz: 400, pulseWidth: 128, volume: 200, filterCutoff: 0 },
    { delaySamples: ms(4),  waveform: PULSE, freqHz: 250, pulseWidth: 128, volume: 220, filterCutoff: 0 },
    { delaySamples: ms(4),  waveform: PULSE, freqHz: 500, pulseWidth: 128, volume: 200, filterCutoff: 0 },
    { delaySamples: ms(6),  waveform: PULSE, freqHz: 500, pulseWidth: 128, volume: 80,  filterCutoff: 0 },
    { delaySamples: ms(4),  waveform: OFF,   freqHz: 0,   pulseWidth: 0,   volume: 0,   filterCutoff: 0 },
  ],

  // 6: POWERUP — saw, slow rising sweep with resonant filter
  [
    { delaySamples: 0,       waveform: SAW, freqHz: 100, pulseWidth: 0, volume: 200, filterCutoff: 40 },
    { delaySamples: ms(40),  waveform: SAW, freqHz: 150, pulseWidth: 0, volume: 210, filterCutoff: 80 },
    { delaySamples: ms(40),  waveform: SAW, freqHz: 220, pulseWidth: 0, volume: 220, filterCutoff: 120 },
    { delaySamples: ms(40),  waveform: SAW, freqHz: 330, pulseWidth: 0, volume: 235, filterCutoff: 170 },
    { delaySamples: ms(40),  waveform: SAW, freqHz: 500, pulseWidth: 0, volume: 255, filterCutoff: 220 },
    { delaySamples: ms(60),  waveform: SAW, freqHz: 500, pulseWidth: 0, volume: 80,  filterCutoff: 0 },
    { delaySamples: ms(30),  waveform: OFF, freqHz: 0,   pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 7: DEATH — noise + pulse, descending pitch, long release
  [
    { delaySamples: 0,       waveform: NOISE, freqHz: 300, pulseWidth: 0,   volume: 255, filterCutoff: 0 },
    { delaySamples: ms(30),  waveform: PULSE, freqHz: 400, pulseWidth: 100, volume: 220, filterCutoff: 0 },
    { delaySamples: ms(40),  waveform: PULSE, freqHz: 300, pulseWidth: 100, volume: 180, filterCutoff: 0 },
    { delaySamples: ms(50),  waveform: PULSE, freqHz: 200, pulseWidth: 100, volume: 130, filterCutoff: 0 },
    { delaySamples: ms(60),  waveform: PULSE, freqHz: 100, pulseWidth: 100, volume: 60,  filterCutoff: 0 },
    { delaySamples: ms(80),  waveform: OFF,   freqHz: 0,   pulseWidth: 0,   volume: 0,   filterCutoff: 0 },
  ],

  // 8: COIN — pulse, two quick high notes E6→B6
  [
    { delaySamples: 0,      waveform: PULSE, freqHz: 1319, pulseWidth: 128, volume: 230, filterCutoff: 0 },
    { delaySamples: ms(6),  waveform: PULSE, freqHz: 1976, pulseWidth: 128, volume: 255, filterCutoff: 0 },
    { delaySamples: ms(10), waveform: PULSE, freqHz: 1976, pulseWidth: 128, volume: 100, filterCutoff: 0 },
    { delaySamples: ms(6),  waveform: OFF,   freqHz: 0,    pulseWidth: 0,   volume: 0,   filterCutoff: 0 },
  ],

  // 9: BEEP — pulse, single short tone
  [
    { delaySamples: 0,      waveform: PULSE, freqHz: 880, pulseWidth: 128, volume: 220, filterCutoff: 0 },
    { delaySamples: ms(10), waveform: PULSE, freqHz: 880, pulseWidth: 128, volume: 100, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: OFF,   freqHz: 0,   pulseWidth: 0,   volume: 0,   filterCutoff: 0 },
  ],

  // 10: THUD — noise, low-pass filtered, very short
  [
    { delaySamples: 0,       waveform: NOISE, freqHz: 3000, pulseWidth: 0, volume: 255, filterCutoff: 60 },
    { delaySamples: ms(15),  waveform: NOISE, freqHz: 2000, pulseWidth: 0, volume: 160, filterCutoff: 40 },
    { delaySamples: ms(15),  waveform: NOISE, freqHz: 1500, pulseWidth: 0, volume: 60,  filterCutoff: 25 },
    { delaySamples: ms(10),  waveform: OFF,   freqHz: 0,    pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 11: ZAP — saw, resonant filter sweep, fast decay
  [
    { delaySamples: 0,      waveform: SAW, freqHz: 600, pulseWidth: 0, volume: 255, filterCutoff: 240 },
    { delaySamples: ms(4),  waveform: SAW, freqHz: 600, pulseWidth: 0, volume: 200, filterCutoff: 160 },
    { delaySamples: ms(4),  waveform: SAW, freqHz: 600, pulseWidth: 0, volume: 140, filterCutoff: 80 },
    { delaySamples: ms(4),  waveform: SAW, freqHz: 600, pulseWidth: 0, volume: 60,  filterCutoff: 30 },
    { delaySamples: ms(3),  waveform: OFF, freqHz: 0,   pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 12: ALARM — pulse, alternating two tones
  [
    { delaySamples: 0,      waveform: PULSE, freqHz: 800,  pulseWidth: 128, volume: 220, filterCutoff: 0 },
    { delaySamples: ms(8),  waveform: PULSE, freqHz: 600,  pulseWidth: 128, volume: 220, filterCutoff: 0 },
    { delaySamples: ms(8),  waveform: PULSE, freqHz: 800,  pulseWidth: 128, volume: 220, filterCutoff: 0 },
    { delaySamples: ms(8),  waveform: PULSE, freqHz: 600,  pulseWidth: 128, volume: 200, filterCutoff: 0 },
    { delaySamples: ms(8),  waveform: PULSE, freqHz: 800,  pulseWidth: 128, volume: 150, filterCutoff: 0 },
    { delaySamples: ms(8),  waveform: OFF,   freqHz: 0,    pulseWidth: 0,   volume: 0,   filterCutoff: 0 },
  ],

  // 13: CLICK — noise, short burst
  [
    { delaySamples: 0,      waveform: NOISE, freqHz: 8000, pulseWidth: 0, volume: 255, filterCutoff: 0 },
    { delaySamples: ms(4),  waveform: OFF,   freqHz: 0,    pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 14: WHOOSH — noise, band-pass filter sweep up
  [
    { delaySamples: 0,       waveform: NOISE, freqHz: 200, pulseWidth: 0, volume: 180, filterCutoff: 20 },
    { delaySamples: ms(20),  waveform: NOISE, freqHz: 200, pulseWidth: 0, volume: 200, filterCutoff: 60 },
    { delaySamples: ms(20),  waveform: NOISE, freqHz: 200, pulseWidth: 0, volume: 220, filterCutoff: 120 },
    { delaySamples: ms(20),  waveform: NOISE, freqHz: 200, pulseWidth: 0, volume: 240, filterCutoff: 200 },
    { delaySamples: ms(20),  waveform: NOISE, freqHz: 200, pulseWidth: 0, volume: 150, filterCutoff: 240 },
    { delaySamples: ms(20),  waveform: OFF,   freqHz: 0,   pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],

  // 15: BLIP — triangle, quick pitch down 800Hz→400Hz
  [
    { delaySamples: 0,      waveform: TRI, freqHz: 800, pulseWidth: 0, volume: 220, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: TRI, freqHz: 600, pulseWidth: 0, volume: 200, filterCutoff: 0 },
    { delaySamples: ms(5),  waveform: TRI, freqHz: 400, pulseWidth: 0, volume: 140, filterCutoff: 0 },
    { delaySamples: ms(4),  waveform: OFF, freqHz: 0,   pulseWidth: 0, volume: 0,   filterCutoff: 0 },
  ],
];
