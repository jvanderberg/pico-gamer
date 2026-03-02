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
  const [loading, setLoading] = useState(true);

  const handleUpdate = useCallback((update: StatusUpdate) => {
    setStatus(update.status);
    if (update.stackText) setStackText(update.stackText);
    setError(update.error);
  }, []);

  // Create engine once canvas is ready (async for WASM loading)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;

    createEngine(ctx, scale, handleUpdate)
      .then((engine) => {
        if (cancelled) {
          engine.cleanup();
          return;
        }
        engineRef.current = engine;
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to load WASM VM:", err);
          setError(`Failed to load WASM VM: ${(err as Error).message}`);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (engineRef.current) {
        engineRef.current.cleanup();
        engineRef.current = null;
      }
    };
    // Only create once on mount — scale changes are handled via engine.setScale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, handleUpdate]);

  return { engineRef, status, stackText, error, loading };
}
