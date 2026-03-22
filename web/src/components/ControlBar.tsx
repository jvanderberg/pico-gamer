import { RotateCcw } from "lucide-react";

interface ControlBarProps {
  onReset: () => void;
  scale: number;
  onScaleChange: (scale: number) => void;
}

export function ControlBar({
  onReset,
  scale,
  onScaleChange,
}: ControlBarProps) {
  const iconSize = 16;
  return (
    <div className="flex gap-2 flex-wrap justify-center">
      <button className="btn" onClick={onReset} title="Restart">
        <RotateCcw size={iconSize} />
      </button>
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
