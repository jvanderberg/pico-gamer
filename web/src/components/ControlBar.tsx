import { Cog, Play, Pause, StepForward, RotateCcw } from "lucide-react";

interface ControlBarProps {
  onAssemble: () => void;
  onRun: () => void;
  onStop: () => void;
  onStep: () => void;
  onReset: () => void;
  breakAtStart: boolean;
  onBreakAtStartChange: (checked: boolean) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
}

export function ControlBar({
  onAssemble,
  onRun,
  onStop,
  onStep,
  onReset,
  breakAtStart,
  onBreakAtStartChange,
  scale,
  onScaleChange,
}: ControlBarProps) {
  const iconSize = 16;
  return (
    <div className="flex gap-2 flex-wrap justify-center">
      <button className="btn" onClick={onAssemble} title="Compile / Assemble">
        <Cog size={iconSize} />
      </button>
      <button className="btn" onClick={onRun} title="Run">
        <Play size={iconSize} />
      </button>
      <button className="btn" onClick={onStop} title="Pause">
        <Pause size={iconSize} />
      </button>
      <button className="btn" onClick={onStep} title="Step">
        <StepForward size={iconSize} />
      </button>
      <button className="btn" onClick={onReset} title="Reset">
        <RotateCcw size={iconSize} />
      </button>
      <label className="flex items-center gap-1 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={breakAtStart}
          onChange={(e) => onBreakAtStartChange(e.target.checked)}
        />
        Break at start
      </label>
      <label className="flex items-center gap-1 text-xs">
        Scale:
        <select
          className="sel"
          value={scale}
          onChange={(e) => onScaleChange(parseInt(e.target.value, 10))}
        >
          <option value="1">1x</option>
          <option value="2">2x</option>
          <option value="3">3x</option>
          <option value="4">4x</option>
        </select>
      </label>
    </div>
  );
}
