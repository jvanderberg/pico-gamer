import { forwardRef } from "react";
import { GameCanvas } from "./GameCanvas.tsx";
import { EncoderGroup } from "./EncoderGroup.tsx";
import { ControlBar } from "./ControlBar.tsx";
import { ErrorDisplay } from "./ErrorDisplay.tsx";
import type { Engine } from "../lib/engine.ts";

interface DisplayPanelProps {
  engine: Engine | null;
  scale: number;
  onScaleChange: (scale: number) => void;
  error: string | null;
  fps: number;
  onReset: () => void;
}

export const DisplayPanel = forwardRef<HTMLCanvasElement, DisplayPanelProps>(
  function DisplayPanel(
    {
      engine,
      scale,
      onScaleChange,
      error,
      fps,
      onReset,
    },
    canvasRef,
  ) {
    return (
      <div className="flex-1 min-h-0 min-w-0 flex flex-col" style={{ paddingLeft: 16 }}>
        <div className="flex items-center px-2 py-1 text-xs text-[var(--muted)] bg-[var(--card)]">
          <ControlBar
            onReset={onReset}
            scale={scale}
            onScaleChange={onScaleChange}
          />
        </div>
        <div className="flex flex-col items-start gap-4 pr-4 py-4 overflow-y-auto">
          <div className="flex items-center gap-4">
            <GameCanvas ref={canvasRef} scale={scale} />
            <EncoderGroup engine={engine} />
          </div>
          <span className="text-xs text-[var(--muted)]">
            {fps > 0 ? `${Math.round(fps)} fps` : ""}
          </span>
          <ErrorDisplay error={error} />
        </div>
      </div>
    );
  },
);
