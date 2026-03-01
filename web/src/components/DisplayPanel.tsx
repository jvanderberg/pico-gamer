import { forwardRef } from "react";
import { GameCanvas } from "./GameCanvas.tsx";
import { EncoderGroup } from "./EncoderGroup.tsx";
import { ControlBar } from "./ControlBar.tsx";
import { ErrorDisplay } from "./ErrorDisplay.tsx";
import { StackView } from "./StackView.tsx";
import { MemoryMonitor } from "./MemoryMonitor.tsx";
import type { Engine } from "../lib/engine.ts";

interface DisplayPanelProps {
  engine: Engine | null;
  scale: number;
  onScaleChange: (scale: number) => void;
  breakAtStart: boolean;
  onBreakAtStartChange: (checked: boolean) => void;
  error: string | null;
  stackText: string;
  fps: number;
  onAssemble: () => void;
  onRun: () => void;
  onStop: () => void;
  onStep: () => void;
  onReset: () => void;
  onMemCommand: (cmd: string) => string;
}

export const DisplayPanel = forwardRef<HTMLCanvasElement, DisplayPanelProps>(
  function DisplayPanel(
    {
      engine,
      scale,
      onScaleChange,
      breakAtStart,
      onBreakAtStartChange,
      error,
      stackText,
      fps,
      onAssemble,
      onRun,
      onStop,
      onStep,
      onReset,
      onMemCommand,
    },
    canvasRef,
  ) {
    return (
      <div className="flex-1 min-h-0 min-w-0 flex flex-col" style={{ paddingLeft: 16 }}>
        <div className="flex items-center px-2 py-1 text-xs text-[var(--muted)] bg-[var(--card)]">
          <ControlBar
            onAssemble={onAssemble}
            onRun={onRun}
            onStop={onStop}
            onStep={onStep}
            onReset={onReset}
            breakAtStart={breakAtStart}
            onBreakAtStartChange={onBreakAtStartChange}
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
          <MemoryMonitor onCommand={onMemCommand} />
          <div className="flex gap-2 w-full max-w-[540px]">
            <StackView stackText={stackText} />
          </div>
        </div>
      </div>
    );
  },
);
