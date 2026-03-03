import { useState, useRef, useEffect, useCallback } from "react";
import { BitmapGrid } from "./BitmapGrid.tsx";
import { VectorGrid } from "./VectorGrid.tsx";
import {
  parseDataLine,
  detectSpriteType,
  bytesToBitmap,
  bitmapToBytes,
  bytesToVectors,
  vectorsToBytes,
  formatDataLine,
  emptyBitmap,
  type Segment,
} from "../lib/sprite-data.ts";

interface SpriteEditorProps {
  open: boolean;
  onClose: () => void;
}

const SIZE_PRESETS = [
  { label: "8x8", w: 8, h: 8 },
  { label: "16x16", w: 16, h: 16 },
  { label: "8x16", w: 8, h: 16 },
  { label: "16x8", w: 16, h: 8 },
] as const;

export function SpriteEditor({ open, onClose }: SpriteEditorProps) {
  const [mode, setMode] = useState<"bitmap" | "vector">("bitmap");
  const [label, setLabel] = useState("sprite");
  const [width, setWidth] = useState(8);
  const [height, setHeight] = useState(8);
  const [pixels, setPixels] = useState<boolean[][]>(() => emptyBitmap(8, 8));
  const [segments, setSegments] = useState<Segment[]>([]);
  const [inputText, setInputText] = useState("");
  const [copied, setCopied] = useState(false);

  const backdropRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Compute output DATA line
  const outputBytes =
    mode === "bitmap"
      ? bitmapToBytes(pixels, width, height)
      : vectorsToBytes(segments);
  const outputLine = formatDataLine(label, outputBytes);



  // Draw 1:1 preview
  const drawPreview = useCallback(() => {
    const ctx = previewRef.current?.getContext("2d");
    if (!ctx) return;
    const canvas = previewRef.current!;

    if (mode === "bitmap") {
      const scale = Math.max(1, Math.floor(64 / Math.max(width, height)));
      canvas.width = width * scale;
      canvas.height = height * scale;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00ff88";
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (pixels[y]?.[x]) {
            ctx.fillRect(x * scale, y * scale, scale, scale);
          }
        }
      }
    } else {
      // Vector: 16x16 grid for signed 4.4 (-8..+7), scale to ~64px preview
      const gridCells = 16;
      const scale = 4;
      canvas.width = gridCells * scale;
      canvas.height = gridCells * scale;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 1;
      for (const seg of segments) {
        // Map signed coord to pixel: (coord + 8) * scale + scale/2
        ctx.beginPath();
        ctx.moveTo(
          (seg.x1 + 8) * scale + scale / 2,
          (seg.y1 + 8) * scale + scale / 2,
        );
        ctx.lineTo(
          (seg.x2 + 8) * scale + scale / 2,
          (seg.y2 + 8) * scale + scale / 2,
        );
        ctx.stroke();
      }
    }
  }, [mode, pixels, segments, width, height]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  function handleParse() {
    const parsed = parseDataLine(inputText);
    if (!parsed) return;
    setLabel(parsed.label);
    const detected = detectSpriteType(parsed.bytes);
    setMode(detected);
    if (detected === "vector") {
      setSegments(bytesToVectors(parsed.bytes));
    } else {
      const bm = bytesToBitmap(parsed.bytes, width, height);
      setPixels(bm);
    }
  }

  function handleSizePreset(w: number, h: number) {
    setWidth(w);
    setHeight(h);
    setPixels(resizeBitmap(pixels, w, h));
  }

  function handleWidthChange(w: number) {
    if (w < 1 || w > 64) return;
    setWidth(w);
    setPixels(resizeBitmap(pixels, w, height));
  }

  function handleHeightChange(h: number) {
    if (h < 1 || h > 64) return;
    setHeight(h);
    setPixels(resizeBitmap(pixels, width, h));
  }

  function handleClear() {
    if (mode === "bitmap") {
      setPixels(emptyBitmap(width, height));
    } else {
      setSegments([]);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(outputLine).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col max-w-[760px] max-h-[90vh] overflow-hidden m-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[var(--card)] border-b border-[var(--border)]">
          <span className="text-sm font-bold text-[var(--foreground)] tracking-wide">
            Sprite Editor
          </span>
          <button className="btn text-[11px] px-3 py-1 rounded" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex flex-col gap-5 p-6 overflow-y-auto">
          {/* Import section */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Import
            </span>
            <div className="flex gap-3">
              <input
                type="text"
                className="flex-1 bg-[var(--code-bg)] border border-[var(--border)] rounded text-[var(--foreground)] text-xs px-3 py-2 font-mono focus:border-[var(--secondary)] focus:outline-none"
                placeholder="Paste DATA line here..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleParse();
                }}
              />
              <button
                className="btn text-[11px] px-4 py-2 rounded"
                onClick={handleParse}
              >
                Parse
              </button>
            </div>
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-3 px-5 bg-[var(--card)] rounded-lg border border-[var(--border)]">
            {/* Mode */}
            <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
              <span className="font-bold text-[var(--foreground)]">Mode</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="sprite-mode"
                  checked={mode === "bitmap"}
                  onChange={() => setMode("bitmap")}
                  className="accent-[var(--accent)]"
                />
                Bitmap
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="sprite-mode"
                  checked={mode === "vector"}
                  onChange={() => setMode("vector")}
                  className="accent-[var(--accent)]"
                />
                Vector
              </label>
            </div>

            {/* Divider */}
            <div className="w-px h-5 bg-[var(--border)]" />

            {/* Label */}
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span className="font-bold text-[var(--foreground)]">Label</span>
              <input
                type="text"
                className="w-28 bg-[var(--code-bg)] border border-[var(--border)] rounded text-[var(--foreground)] text-xs px-2 py-1.5 focus:border-[var(--secondary)] focus:outline-none"
                value={label}
                onChange={(e) => setLabel(e.target.value || "sprite")}
              />
            </div>

            {/* Divider */}
            <div className="w-px h-5 bg-[var(--border)]" />

            {/* Size / format info */}
            {mode === "bitmap" ? (
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                {SIZE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={`btn text-[10px] px-2.5 py-1 rounded ${
                      width === p.w && height === p.h
                        ? "bg-[var(--secondary)] border-[var(--secondary)]"
                        : ""
                    }`}
                    onClick={() => handleSizePreset(p.w, p.h)}
                  >
                    {p.label}
                  </button>
                ))}
                <span className="ml-1 text-[var(--foreground)]">W</span>
                <input
                  type="number"
                  className="w-12 bg-[var(--code-bg)] border border-[var(--border)] rounded text-[var(--foreground)] text-xs px-1.5 py-1 text-center focus:border-[var(--secondary)] focus:outline-none"
                  value={width}
                  min={1}
                  max={64}
                  onChange={(e) =>
                    handleWidthChange(parseInt(e.target.value) || 1)
                  }
                />
                <span className="text-[var(--foreground)]">H</span>
                <input
                  type="number"
                  className="w-12 bg-[var(--code-bg)] border border-[var(--border)] rounded text-[var(--foreground)] text-xs px-1.5 py-1 text-center focus:border-[var(--secondary)] focus:outline-none"
                  value={height}
                  min={1}
                  max={64}
                  onChange={(e) =>
                    handleHeightChange(parseInt(e.target.value) || 1)
                  }
                />
              </div>
            ) : (
              <span className="text-[10px] text-[var(--muted)]">
                4.4 signed (-8..+7) &mdash; click start, click end; Del
                removes
              </span>
            )}
          </div>

          {/* Grid + Preview */}
          <div className="flex gap-6 items-start">
            <div className="overflow-auto max-w-[540px] max-h-[440px] rounded-lg border border-[var(--border)] bg-[var(--code-bg)] p-3">
              {mode === "bitmap" ? (
                <BitmapGrid
                  pixels={pixels}
                  width={width}
                  height={height}
                  onChange={setPixels}
                />
              ) : (
                <VectorGrid segments={segments} onChange={setSegments} />
              )}
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Preview
              </span>
              <div className="border border-[var(--border)] rounded-lg bg-[var(--code-bg)] p-3">
                <canvas
                  ref={previewRef}
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
            </div>
          </div>

          {/* Output section */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Output
            </span>
            <div className="flex gap-3 items-center">
              <code className="flex-1 bg-[var(--code-bg)] border border-[var(--border)] rounded text-[var(--accent)] text-xs px-4 py-2.5 font-mono overflow-x-auto whitespace-nowrap select-all">
                {outputLine}
              </code>
              <button
                className="btn text-[11px] px-4 py-2 rounded"
                onClick={handleCopy}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 bg-[var(--card)] border-t border-[var(--border)]">
          <button
            className="btn text-[11px] px-4 py-2 rounded"
            onClick={handleClear}
          >
            Clear
          </button>
          <button
            className="btn text-[11px] px-4 py-2 rounded bg-[var(--secondary)]"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Resize a bitmap, preserving existing pixels where possible. */
function resizeBitmap(
  old: boolean[][],
  newW: number,
  newH: number,
): boolean[][] {
  return Array.from({ length: newH }, (_, y) =>
    Array.from({ length: newW }, (_, x) => old[y]?.[x] ?? false),
  );
}
