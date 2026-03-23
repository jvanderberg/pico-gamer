import { useEffect, useRef } from "react";
import { EncoderGroup } from "./EncoderGroup.tsx";
import { ControlBar } from "./ControlBar.tsx";
import { ErrorDisplay } from "./ErrorDisplay.tsx";
import type { Engine } from "../lib/engine.ts";

interface DisplayPanelProps {
  canvasPortalRef: React.RefObject<HTMLDivElement | null>;
  engine: Engine | null;
  scale: number;
  onScaleChange: (scale: number) => void;
  onFullscreen: () => void;
  error: string | null;
  fps: number;
  onReset: () => void;
}

export function DisplayPanel({
  canvasPortalRef,
  engine,
  scale,
  onScaleChange,
  onFullscreen,
  error,
  fps,
  onReset,
}: DisplayPanelProps) {
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const portal = canvasPortalRef.current;
    const target = targetRef.current;
    if (!portal || !target) return;
    target.appendChild(portal);
    portal.style.display = "";
    return () => {
      document.body.appendChild(portal);
      portal.style.display = "none";
    };
  }, [canvasPortalRef]);

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col" style={{ paddingLeft: 16 }}>
      <div className="flex items-center px-2 py-1 text-xs text-[var(--muted)] bg-[var(--card)]">
        <ControlBar
          onReset={onReset}
          scale={scale}
          onScaleChange={onScaleChange}
          onFullscreen={onFullscreen}
        />
      </div>
      <div className="flex flex-col items-start gap-4 pr-4 py-4 overflow-y-auto">
        <div className="flex items-center gap-4">
          <div ref={targetRef} />
          <EncoderGroup engine={engine} />
        </div>
        <span className="text-xs text-[var(--muted)]">
          {fps > 0 ? `${Math.round(fps)} fps` : ""}
        </span>
        <ErrorDisplay error={error} />
      </div>
    </div>
  );
}
