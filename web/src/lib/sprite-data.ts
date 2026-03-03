/** Pure functions for parsing/serializing sprite DATA lines. */

export interface ParsedDataLine {
  label: string;
  bytes: number[];
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Parse a BASIC DATA line into a label and byte array.
 * Accepts: "DATA label, $HH, ..." or "DATA label, 0xHH, ..." or decimal.
 */
export function parseDataLine(text: string): ParsedDataLine | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^DATA\s+(\w+)\s*,\s*(.+)$/i);
  if (!match) return null;
  const label = match[1] ?? "";
  const rawValues = match[2] ?? "";
  const parts = rawValues.split(",").map((s) => s.trim());
  const bytes: number[] = [];
  for (const part of parts) {
    if (part === "") continue;
    let val: number;
    if (part.startsWith("$")) {
      val = parseInt(part.slice(1), 16);
    } else if (part.toLowerCase().startsWith("0x")) {
      val = parseInt(part.slice(2), 16);
    } else {
      val = parseInt(part, 10);
    }
    if (isNaN(val)) return null;
    bytes.push(val & 0xff);
  }
  return { label, bytes };
}

/**
 * Detect whether a byte array represents a vector sprite or bitmap.
 * Vector heuristic: bytes[0] = segment count, total length = 1 + count * 4.
 */
export function detectSpriteType(bytes: number[]): "bitmap" | "vector" {
  if (bytes.length < 1) return "bitmap";
  const count = bytes[0]!;
  if (count > 0 && bytes.length === 1 + count * 4) return "vector";
  return "bitmap";
}

/**
 * Unpack bytes into a 2D boolean pixel array (MSB-first, row-major).
 * ceil(width/8) bytes per row.
 */
export function bytesToBitmap(
  bytes: number[],
  width: number,
  height: number,
): boolean[][] {
  const bytesPerRow = Math.ceil(width / 8);
  const pixels: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const byteIdx = y * bytesPerRow + Math.floor(x / 8);
      const bitIdx = 7 - (x % 8);
      const b = bytes[byteIdx] ?? 0;
      row.push(((b >> bitIdx) & 1) === 1);
    }
    pixels.push(row);
  }
  return pixels;
}

/**
 * Pack a 2D boolean pixel array back to bytes (MSB-first, row-major).
 */
export function bitmapToBytes(
  pixels: boolean[][],
  width: number,
  height: number,
): number[] {
  const bytesPerRow = Math.ceil(width / 8);
  const bytes: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = pixels[y];
    for (let byteCol = 0; byteCol < bytesPerRow; byteCol++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteCol * 8 + bit;
        if (x < width && row?.[x]) {
          b |= 1 << (7 - bit);
        }
      }
      bytes.push(b);
    }
  }
  return bytes.slice(0, bytesPerRow * height);
}

/**
 * Decode a signed 4.4 fixed-point byte to its integer part (-8..+7).
 * The byte is treated as a signed int8; the high nibble is the integer part.
 */
function decodeCoord44(byte: number): number {
  const signed = byte >= 128 ? byte - 256 : byte;
  return signed >> 4; // arithmetic right-shift keeps sign
}

/**
 * Encode a signed integer coordinate (-8..+7) to a 4.4 fixed-point byte.
 * Integer goes into high nibble, fractional part is zero.
 */
function encodeCoord44(coord: number): number {
  return (coord << 4) & 0xff;
}

/**
 * Decode vector sprite bytes into line segments.
 * Format: [count, x1, y1, x2, y2, ...] where each coordinate byte is
 * signed 4.4 fixed-point. Coordinates range -8..+7 relative to sprite center.
 */
export function bytesToVectors(bytes: number[]): Segment[] {
  const count = bytes[0] ?? 0;
  const segments: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const base = 1 + i * 4;
    segments.push({
      x1: decodeCoord44(bytes[base] ?? 0),
      y1: decodeCoord44(bytes[base + 1] ?? 0),
      x2: decodeCoord44(bytes[base + 2] ?? 0),
      y2: decodeCoord44(bytes[base + 3] ?? 0),
    });
  }
  return segments;
}

/**
 * Encode line segments back to vector sprite bytes (signed 4.4 fixed-point).
 */
export function vectorsToBytes(segments: Segment[]): number[] {
  const bytes: number[] = [segments.length];
  for (const seg of segments) {
    bytes.push(encodeCoord44(seg.x1));
    bytes.push(encodeCoord44(seg.y1));
    bytes.push(encodeCoord44(seg.x2));
    bytes.push(encodeCoord44(seg.y2));
  }
  return bytes;
}

/**
 * Format a label and byte array back into a DATA line.
 * Output: "DATA label, $HH, $HH, ..."
 */
export function formatDataLine(label: string, bytes: number[]): string {
  const hexParts = bytes.map(
    (b) => "$" + (b & 0xff).toString(16).toUpperCase().padStart(2, "0"),
  );
  return `DATA ${label}, ${hexParts.join(", ")}`;
}

/**
 * Create an empty bitmap (all false) of the given dimensions.
 */
export function emptyBitmap(width: number, height: number): boolean[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => false),
  );
}
