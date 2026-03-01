/** 128x64 1-bit framebuffer. Pixel-packed: 1 bit per pixel, 1024 bytes total. */

export const SCREEN_W = 128;
export const SCREEN_H = 64;
export const FB_BYTES = (SCREEN_W * SCREEN_H) / 8; // 1024

export interface Framebuffer {
  /** 1024 bytes, row-major, MSB-first within each byte. */
  data: Uint8Array;
}

export function createFramebuffer(): Framebuffer {
  return { data: new Uint8Array(FB_BYTES) };
}

export function clearFB(fb: Framebuffer): void {
  fb.data.fill(0);
}

export function getPixel(fb: Framebuffer, x: number, y: number): number {
  if (x < 0 || x >= SCREEN_W || y < 0 || y >= SCREEN_H) return 0;
  const bitIndex = y * SCREEN_W + x;
  const byteIndex = bitIndex >>> 3;
  const bitOffset = 7 - (bitIndex & 7);
  return (fb.data[byteIndex]! >>> bitOffset) & 1;
}

export function setPixel(
  fb: Framebuffer,
  x: number,
  y: number,
  color: number,
): void {
  if (x < 0 || x >= SCREEN_W || y < 0 || y >= SCREEN_H) return;
  const bitIndex = y * SCREEN_W + x;
  const byteIndex = bitIndex >>> 3;
  const bitOffset = 7 - (bitIndex & 7);
  if (color) {
    fb.data[byteIndex]! |= 1 << bitOffset;
  } else {
    fb.data[byteIndex]! &= ~(1 << bitOffset);
  }
}

/** Bresenham line. */
export function drawLine(
  fb: Framebuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color = 1,
): void {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    setPixel(fb, x0, y0, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Filled rectangle. */
export function drawRect(
  fb: Framebuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  color = 1,
): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      setPixel(fb, col, row, color);
    }
  }
}

/** Draw a variable-size 1-bit sprite from VM memory. flags bit 0 = flip X, bit 1 = flip Y. */
export function drawSprite(
  fb: Framebuffer,
  spriteData: Uint8Array,
  x: number,
  y: number,
  flags: number,
  width = 8,
  height = 8,
): void {
  const flipX = (flags & 1) !== 0;
  const flipY = (flags & 2) !== 0;
  const bytesPerRow = Math.ceil(width / 8);
  for (let row = 0; row < height; row++) {
    const srcRow = flipY ? height - 1 - row : row;
    for (let col = 0; col < width; col++) {
      const srcCol = flipX ? width - 1 - col : col;
      const byteIdx = srcRow * bytesPerRow + (srcCol >>> 3);
      const bitOff = 7 - (srcCol & 7);
      const bit = (spriteData[byteIdx]! >>> bitOff) & 1;
      if (bit) {
        setPixel(fb, x + col, y + row, 1);
      }
    }
  }
}

// 65-entry quarter-wave sin table: sin(i * 90/64 degrees) * 256, for i=0..64
// Entry 64 = sin(90°) = 256 (1.0 in fixed-point), needed for boundary lookups.
const QUARTER_SIN = new Int16Array(65);
for (let i = 0; i <= 64; i++) {
  QUARTER_SIN[i] = Math.round(Math.sin((i * Math.PI) / 128) * 256);
}

/** Look up sin for angle 0–255 (256 steps = 360°). Returns fixed-point ×256. */
export function sin256(angle: number): number {
  angle = ((angle % 256) + 256) % 256;
  if (angle < 64) return QUARTER_SIN[angle]!;
  if (angle < 128) return QUARTER_SIN[128 - angle]!;
  if (angle < 192) return -QUARTER_SIN[angle - 128]!;
  return -QUARTER_SIN[256 - angle]!;
}

/** Look up cos for angle 0–255. Returns fixed-point ×256. */
export function cos256(angle: number): number {
  return sin256(angle + 64);
}

/**
 * Draw a rotated 1-bit sprite. angle is 0–255 (0=no rotation, 64=90°, etc).
 * Uses inverse rotation to sample source bitmap for each destination pixel.
 */
export function drawSpriteRotated(
  fb: Framebuffer,
  spriteData: Uint8Array,
  x: number,
  y: number,
  flags: number,
  width: number,
  height: number,
  angle: number,
): void {
  // Fast path: no rotation
  if ((angle & 0xff) === 0) {
    drawSprite(fb, spriteData, x, y, flags, width, height);
    return;
  }

  const flipX = (flags & 1) !== 0;
  const flipY = (flags & 2) !== 0;
  const bytesPerRow = Math.ceil(width / 8);

  // Center of sprite in source coordinates (fixed-point ×256)
  const cx = ((width - 1) * 256) >> 1;
  const cy = ((height - 1) * 256) >> 1;

  // Precompute sin/cos for inverse rotation (negate angle to map dst→src)
  const sinA = sin256(angle);
  const cosA = cos256(angle);

  // Compute rotated bounding box to know destination extent
  // Check all four corners of the source sprite
  const halfW = (width * 256) >> 1;
  const halfH = (height * 256) >> 1;
  let minDx = Infinity, maxDx = -Infinity;
  let minDy = Infinity, maxDy = -Infinity;
  for (const ox of [-halfW, halfW]) {
    for (const oy of [-halfH, halfH]) {
      const dx = (ox * cosA - oy * sinA) >> 8;
      const dy = (ox * sinA + oy * cosA) >> 8;
      if (dx < minDx) minDx = dx;
      if (dx > maxDx) maxDx = dx;
      if (dy < minDy) minDy = dy;
      if (dy > maxDy) maxDy = dy;
    }
  }

  // Destination center is placed at x + (width-1)/2, y + (height-1)/2
  const dstCx = x + (width - 1) / 2;
  const dstCy = y + (height - 1) / 2;

  const startX = Math.floor(dstCx + minDx / 256);
  const endX = Math.ceil(dstCx + maxDx / 256);
  const startY = Math.floor(dstCy + minDy / 256);
  const endY = Math.ceil(dstCy + maxDy / 256);

  for (let dy = startY; dy <= endY; dy++) {
    for (let dx = startX; dx <= endX; dx++) {
      // Offset from destination center, in fixed-point ×256
      const offX = (dx - dstCx) * 256;
      const offY = (dy - dstCy) * 256;

      // Inverse rotation: dst offset → src offset (centered)
      const srcX256 = (offX * cosA + offY * sinA + cx * 256) >> 8;
      const srcY256 = (-offX * sinA + offY * cosA + cy * 256) >> 8;

      // Round to nearest source pixel
      const srcX = (srcX256 + 128) >> 8;
      const srcY = (srcY256 + 128) >> 8;

      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;

      // Apply flip flags to source coordinates
      const sampX = flipX ? width - 1 - srcX : srcX;
      const sampY = flipY ? height - 1 - srcY : srcY;

      const byteIdx = sampY * bytesPerRow + (sampX >>> 3);
      const bitOff = 7 - (sampX & 7);
      const bit = (spriteData[byteIdx]! >>> bitOff) & 1;
      if (bit) {
        setPixel(fb, dx, dy, 1);
      }
    }
  }
}

/** Blit an arbitrary w×h 1-bit region from VM memory. */
export function blit(
  fb: Framebuffer,
  srcData: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  let bitIdx = 0;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const byteIdx = bitIdx >>> 3;
      const bitOff = 7 - (bitIdx & 7);
      const bit = (srcData[byteIdx]! >>> bitOff) & 1;
      if (bit) {
        setPixel(fb, x + col, y + row, 1);
      }
      bitIdx++;
    }
  }
}

/** Render framebuffer onto an HTML canvas, scaling each pixel to scale×scale. */
export function renderToCanvas(
  fb: Framebuffer,
  ctx: CanvasRenderingContext2D,
  scale: number,
): void {
  const imgData = ctx.createImageData(SCREEN_W * scale, SCREEN_H * scale);
  const pixels = imgData.data;

  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) {
      const on = getPixel(fb, x, y);
      const brightness = on ? 255 : 0;

      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = x * scale + sx;
          const py = y * scale + sy;
          const i = (py * SCREEN_W * scale + px) * 4;
          pixels[i] = brightness;
          pixels[i + 1] = brightness;
          pixels[i + 2] = brightness;
          pixels[i + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}
