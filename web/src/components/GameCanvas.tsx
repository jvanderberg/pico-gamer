import { forwardRef } from "react";
import { SCREEN_W, SCREEN_H } from "../lib/engine.ts";

interface GameCanvasProps {
  scale: number;
}

export const GameCanvas = forwardRef<HTMLCanvasElement, GameCanvasProps>(
  function GameCanvas({ scale }, ref) {
    return (
      <canvas
        ref={ref}
        width={SCREEN_W * scale}
        height={SCREEN_H * scale}
        className="border-2 border-[var(--border)] bg-black"
        style={{ imageRendering: "pixelated" }}
      />
    );
  },
);
