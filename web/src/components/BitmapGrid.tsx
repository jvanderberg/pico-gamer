import { useRef, useEffect, useCallback } from "react";

interface BitmapGridProps {
  pixels: boolean[][];
  width: number;
  height: number;
  onChange: (pixels: boolean[][]) => void;
}

const CELL_SIZE = 20;
const GRID_LINE = 1;
const BYTE_LINE_ALPHA = 0.4;
const GRID_LINE_ALPHA = 0.15;

export function BitmapGrid({
  pixels,
  width,
  height,
  onChange,
}: BitmapGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef<{ active: boolean; value: boolean }>({
    active: false,
    value: false,
  });

  const canvasW = width * (CELL_SIZE + GRID_LINE) + GRID_LINE;
  const canvasH = height * (CELL_SIZE + GRID_LINE) + GRID_LINE;

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw pixels
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = GRID_LINE + x * (CELL_SIZE + GRID_LINE);
        const py = GRID_LINE + y * (CELL_SIZE + GRID_LINE);
        ctx.fillStyle = pixels[y]?.[x] ? "#00ff88" : "#1a1a2e";
        ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
      }
    }

    // Draw grid lines
    ctx.fillStyle = `rgba(255,255,255,${GRID_LINE_ALPHA})`;
    for (let x = 0; x <= width; x++) {
      const px = x * (CELL_SIZE + GRID_LINE);
      ctx.fillRect(px, 0, GRID_LINE, canvasH);
    }
    for (let y = 0; y <= height; y++) {
      const py = y * (CELL_SIZE + GRID_LINE);
      ctx.fillRect(0, py, canvasW, GRID_LINE);
    }

    // Draw byte boundary lines (every 8 pixels) brighter
    ctx.fillStyle = `rgba(255,255,255,${BYTE_LINE_ALPHA})`;
    for (let x = 0; x <= width; x += 8) {
      const px = x * (CELL_SIZE + GRID_LINE);
      ctx.fillRect(px, 0, GRID_LINE, canvasH);
    }
  }, [pixels, width, height, canvasW, canvasH]);

  useEffect(() => {
    draw();
  }, [draw]);

  function cellFromEvent(
    e: React.MouseEvent<HTMLCanvasElement>,
  ): { cx: number; cy: number } | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = Math.floor(mx / (CELL_SIZE + GRID_LINE));
    const cy = Math.floor(my / (CELL_SIZE + GRID_LINE));
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) return null;
    return { cx, cy };
  }

  function togglePixel(cx: number, cy: number, value: boolean) {
    const next = pixels.map((row) => [...row]);
    const row = next[cy];
    if (row) row[cx] = value;
    onChange(next);
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const cell = cellFromEvent(e);
    if (!cell) return;
    const current = pixels[cell.cy]?.[cell.cx] ?? false;
    const value = !current;
    paintingRef.current = { active: true, value };
    togglePixel(cell.cx, cell.cy, value);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!paintingRef.current.active) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    const current = pixels[cell.cy]?.[cell.cx] ?? false;
    if (current !== paintingRef.current.value) {
      togglePixel(cell.cx, cell.cy, paintingRef.current.value);
    }
  }

  function handleMouseUp() {
    paintingRef.current.active = false;
  }

  return (
    <canvas
      ref={canvasRef}
      width={canvasW}
      height={canvasH}
      style={{ cursor: "crosshair" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}
