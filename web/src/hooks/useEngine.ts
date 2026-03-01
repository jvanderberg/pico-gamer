import { useRef, useState, useCallback, useEffect } from "react";
import { createEngine, type Engine, type EngineStatus, type StatusUpdate } from "../lib/engine.ts";

const INITIAL_STATUS: EngineStatus = {
  pc: "0000",
  sp: "0",
  tos: "\u2014",
  state: "idle",
  cycles: "0",
  fps: 0,
};

export function useEngine(canvasRef: React.RefObject<HTMLCanvasElement | null>, scale: number) {
  const engineRef = useRef<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus>(INITIAL_STATUS);
  const [stackText, setStackText] = useState("empty");
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = useCallback((update: StatusUpdate) => {
    setStatus(update.status);
    if (update.stackText) setStackText(update.stackText);
    setError(update.error);
  }, []);

  // Create engine once canvas is ready
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const engine = createEngine(ctx, scale, handleUpdate);
    engineRef.current = engine;

    return () => {
      engine.cleanup();
      engineRef.current = null;
    };
    // Only create once on mount — scale changes are handled via engine.setScale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, handleUpdate]);

  return { engineRef, status, stackText, error };
}
