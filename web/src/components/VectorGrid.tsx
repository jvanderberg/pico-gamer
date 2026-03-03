import { useRef, useEffect, useCallback, useState } from "react";
import type { Segment } from "../lib/sprite-data.ts";

interface VectorGridProps {
  segments: Segment[];
  onChange: (segments: Segment[]) => void;
}

/** Signed 4.4 coordinate range: -8..+7, 16 integer positions per axis. */
const COORD_MIN = -8;
const COORD_MAX = 7;
const GRID_CELLS = COORD_MAX - COORD_MIN + 1; // 16

const CELL_SIZE = 24;
const GRID_LINE = 1;
const HIT_RADIUS = 6;
const LABEL_PAD = 20; // space for axis labels

export function VectorGrid({ segments, onChange }: VectorGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [startPoint, setStartPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const step = CELL_SIZE + GRID_LINE;
  const gridPx = GRID_CELLS * step + GRID_LINE;
  const canvasW = LABEL_PAD + gridPx;
  const canvasH = LABEL_PAD + gridPx;

  /** Convert a signed coordinate (-8..+7) to canvas pixel position. */
  function coordToCanvas(
    coord: number,
  ): number {
    const idx = coord - COORD_MIN; // 0..15
    return LABEL_PAD + GRID_LINE + idx * step + CELL_SIZE / 2;
  }

  function gridToCanvas(
    gx: number,
    gy: number,
  ): { px: number; py: number } {
    return { px: coordToCanvas(gx), py: coordToCanvas(gy) };
  }

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_CELLS; i++) {
      const px = LABEL_PAD + i * step + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, LABEL_PAD);
      ctx.lineTo(px, canvasH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(LABEL_PAD, px - LABEL_PAD + LABEL_PAD);
      ctx.lineTo(canvasW, px - LABEL_PAD + LABEL_PAD);
      ctx.stroke();
    }
    // Horizontal grid lines
    for (let i = 0; i <= GRID_CELLS; i++) {
      const py = LABEL_PAD + i * step + 0.5;
      ctx.beginPath();
      ctx.moveTo(LABEL_PAD, py);
      ctx.lineTo(canvasW, py);
      ctx.stroke();
    }

    // Center crosshair (coordinate 0,0) — brighter lines
    const cx0 = coordToCanvas(0);
    const cy0 = coordToCanvas(0);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx0, LABEL_PAD);
    ctx.lineTo(cx0, canvasH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(LABEL_PAD, cy0);
    ctx.lineTo(canvasW, cy0);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let c = COORD_MIN; c <= COORD_MAX; c += 2) {
      const px = coordToCanvas(c);
      ctx.fillText(String(c), px, 2);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let c = COORD_MIN; c <= COORD_MAX; c += 2) {
      const py = coordToCanvas(c);
      ctx.fillText(String(c), LABEL_PAD - 3, py);
    }

    // Grid dots at intersections
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    for (let c = COORD_MIN; c <= COORD_MAX; c++) {
      for (let r = COORD_MIN; r <= COORD_MAX; r++) {
        const { px, py } = gridToCanvas(c, r);
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Center dot
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(cx0, cy0, 3, 0, Math.PI * 2);
    ctx.fill();

    // Existing segments — lines first, then endpoints on top
    segments.forEach((seg, i) => {
      const from = gridToCanvas(seg.x1, seg.y1);
      const to = gridToCanvas(seg.x2, seg.y2);
      ctx.strokeStyle = i === selectedIdx ? "#e94560" : "#00ff88";
      ctx.lineWidth = i === selectedIdx ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(from.px, from.py);
      ctx.lineTo(to.px, to.py);
      ctx.stroke();
    });

    // Draw all endpoints as larger dots (snap targets)
    const drawnEndpoints = new Set<string>();
    for (const seg of segments) {
      for (const [ex, ey] of [
        [seg.x1, seg.y1],
        [seg.x2, seg.y2],
      ] as const) {
        const key = `${ex},${ey}`;
        if (drawnEndpoints.has(key)) continue;
        drawnEndpoints.add(key);
        const { px: epx, py: epy } = gridToCanvas(ex, ey);
        // Bright ring + filled center to indicate snap target
        ctx.strokeStyle = "#00ff88";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(epx, epy, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#00ff88";
        ctx.beginPath();
        ctx.arc(epx, epy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Start point indicator
    if (startPoint) {
      const { px, py } = gridToCanvas(startPoint.x, startPoint.y);
      ctx.fillStyle = "#e94560";
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();

      // Preview line to hover
      if (hoverPoint) {
        const hp = gridToCanvas(hoverPoint.x, hoverPoint.y);
        ctx.strokeStyle = "rgba(233,69,96,0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(hp.px, hp.py);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, startPoint, hoverPoint, selectedIdx, canvasW, canvasH]);

  useEffect(() => {
    draw();
  }, [draw]);

  /** Convert mouse position to nearest signed grid coordinate. */
  function gridFromEvent(
    e: React.MouseEvent<HTMLCanvasElement>,
  ): { x: number; y: number } | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Pixel offset within the grid area
    const relX = mx - LABEL_PAD - GRID_LINE - CELL_SIZE / 2;
    const relY = my - LABEL_PAD - GRID_LINE - CELL_SIZE / 2;
    const gx = Math.round(relX / step) + COORD_MIN;
    const gy = Math.round(relY / step) + COORD_MIN;
    if (gx < COORD_MIN || gx > COORD_MAX || gy < COORD_MIN || gy > COORD_MAX)
      return null;
    return { x: gx, y: gy };
  }

  /** Returns distance to segment and the t parameter (0=start, 1=end). */
  function segmentHitTest(
    px: number,
    py: number,
    seg: Segment,
  ): { dist: number; t: number } {
    const a = gridToCanvas(seg.x1, seg.y1);
    const b = gridToCanvas(seg.x2, seg.y2);
    const dx = b.px - a.px;
    const dy = b.py - a.py;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ex = px - a.px;
      const ey = py - a.py;
      return { dist: Math.sqrt(ex * ex + ey * ey), t: 0 };
    }
    const t = Math.max(0, Math.min(1, ((px - a.px) * dx + (py - a.py) * dy) / lenSq));
    const cx = a.px + t * dx;
    const cy = a.py + t * dy;
    const ex = px - cx;
    const ey = py - cy;
    return { dist: Math.sqrt(ex * ex + ey * ey), t };
  }

  /** Check whether a grid point coincides with any existing segment endpoint. */
  function isEndpoint(pt: { x: number; y: number }): boolean {
    return segments.some(
      (seg) =>
        (seg.x1 === pt.x && seg.y1 === pt.y) ||
        (seg.x2 === pt.x && seg.y2 === pt.y),
    );
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const pt = gridFromEvent(e);
    if (!pt) return;

    // If already drawing, complete the line — always allow joining endpoints.
    if (startPoint) {
      if (pt.x !== startPoint.x || pt.y !== startPoint.y) {
        onChange([
          ...segments,
          { x1: startPoint.x, y1: startPoint.y, x2: pt.x, y2: pt.y },
        ]);
      }
      setStartPoint(null);
      setHoverPoint(null);
      setSelectedIdx(null);
      return;
    }

    // Not drawing yet. Use pixel-level hit-testing to decide between
    // selecting a segment body vs starting a new line from an endpoint.
    const rect = canvasRef.current?.getBoundingClientRect();
    const mx = rect ? e.clientX - rect.left : 0;
    const my = rect ? e.clientY - rect.top : 0;

    // Find the nearest segment whose body (t: 0.15–0.85, away from
    // endpoints) is within hit radius — this handles short segments
    // that can't be clicked any other way.
    let bodyIdx = -1;
    let bodyDist = Infinity;
    if (rect) {
      for (let i = 0; i < segments.length; i++) {
        const { dist, t } = segmentHitTest(mx, my, segments[i]!);
        if (dist < HIT_RADIUS && t > 0.15 && t < 0.85 && dist < bodyDist) {
          bodyDist = dist;
          bodyIdx = i;
        }
      }
    }

    if (bodyIdx >= 0) {
      setSelectedIdx(bodyIdx);
      return;
    }

    // If the snapped grid point is on an existing endpoint, start
    // drawing from there (allows joining segments at shared vertices).
    if (isEndpoint(pt)) {
      setStartPoint(pt);
      setSelectedIdx(null);
      return;
    }

    // Check for any segment hit (including near-endpoint zones) for
    // selection of longer segments.
    if (rect) {
      for (let i = 0; i < segments.length; i++) {
        const { dist } = segmentHitTest(mx, my, segments[i]!);
        if (dist < HIT_RADIUS) {
          setSelectedIdx(i);
          return;
        }
      }
    }

    // No hit — start drawing from this grid point.
    setSelectedIdx(null);
    setStartPoint(pt);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (startPoint) {
      setHoverPoint(gridFromEvent(e));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      selectedIdx !== null
    ) {
      e.preventDefault();
      const next = segments.filter((_, i) => i !== selectedIdx);
      onChange(next);
      setSelectedIdx(null);
    }
    if (e.key === "Escape") {
      setStartPoint(null);
      setHoverPoint(null);
      setSelectedIdx(null);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      width={canvasW}
      height={canvasH}
      tabIndex={0}
      style={{ cursor: "crosshair", outline: "none" }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onKeyDown={handleKeyDown}
    />
  );
}
