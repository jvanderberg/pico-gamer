import { useEffect, useRef, useCallback, useState } from "react";
import { type Engine } from "../lib/engine.ts";
import { INPUT_ENC_BTN, INPUT_ENC_CW, INPUT_ENC_CCW } from "../input/input.ts";

interface MobileGameViewProps {
  engine: Engine | null;
  demos: { name: string }[];
  selectedDemo: string;
  onDemoChange: (value: string) => void;
  onShowEditor: () => void;
  /** Portal target — the canvas is reparented into this div */
  canvasPortalRef: React.RefObject<HTMLDivElement | null>;
}

export function MobileGameView({
  engine,
  demos,
  selectedDemo,
  onDemoChange,
  onShowEditor,
  canvasPortalRef,
}: MobileGameViewProps) {
  const tiltRef = useRef({ active: false, baseGamma: 0 });
  const [tiltEnabled, setTiltEnabled] = useState(false);
  const gameAreaRef = useRef<HTMLDivElement>(null);

  // Reparent the canvas into the game area on mount
  useEffect(() => {
    const portal = canvasPortalRef.current;
    const target = gameAreaRef.current;
    if (!portal || !target) return;
    target.appendChild(portal);
    portal.style.display = "";
    return () => {
      // Move it back to body so it's not destroyed
      document.body.appendChild(portal);
      portal.style.display = "none";
    };
  }, [canvasPortalRef]);

  // Request orientation permission (required on iOS 13+)
  const requestTilt = useCallback(() => {
    if (typeof DeviceOrientationEvent === "undefined") return;
    const doe = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof doe.requestPermission === "function") {
      doe.requestPermission().then((state: string) => {
        if (state === "granted") setTiltEnabled(true);
      }).catch(() => {});
    } else {
      setTiltEnabled(true);
    }
  }, []);

  // Auto-request on non-iOS
  useEffect(() => {
    if (typeof DeviceOrientationEvent === "undefined") return;
    const doe = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof doe.requestPermission !== "function") {
      setTiltEnabled(true);
    }
  }, []);

  // Tilt → encoder delta
  useEffect(() => {
    if (!engine || !tiltEnabled) return;

    const eng = engine;
    tiltRef.current = { active: false, baseGamma: 0 };

    function handleOrientation(e: DeviceOrientationEvent) {
      const gamma = e.gamma ?? 0;
      const tilt = tiltRef.current;

      if (!tilt.active) {
        tilt.baseGamma = gamma;
        tilt.active = true;
        return;
      }

      const delta = gamma - tilt.baseGamma;
      const threshold = 8;

      if (delta > threshold) {
        eng.pressInput(INPUT_ENC_CW);
        eng.releaseInput(INPUT_ENC_CCW);
      } else if (delta < -threshold) {
        eng.pressInput(INPUT_ENC_CCW);
        eng.releaseInput(INPUT_ENC_CW);
      } else {
        eng.releaseInput(INPUT_ENC_CW);
        eng.releaseInput(INPUT_ENC_CCW);
      }
    }

    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      eng.releaseInput(INPUT_ENC_CW);
      eng.releaseInput(INPUT_ENC_CCW);
    };
  }, [engine, tiltEnabled]);

  // Touch → encoder button (fire/action)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (!tiltEnabled) requestTilt();
      engine?.pressInput(INPUT_ENC_BTN);
    },
    [engine, tiltEnabled, requestTilt],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      engine?.releaseInput(INPUT_ENC_BTN);
    },
    [engine],
  );

  return (
    <div className="flex flex-col h-screen bg-black">
      <div className="flex items-center gap-2 px-2 py-1 bg-[var(--card)] text-xs">
        <select
          className="sel flex-1"
          value={selectedDemo}
          onChange={(e) => onDemoChange(e.target.value)}
        >
          <option value="">— Select demo —</option>
          {demos.map((d, i) => (
            <option key={i} value={String(i)}>
              {d.name}
            </option>
          ))}
        </select>
        <button className="btn text-[11px] px-2 py-0.5" onClick={onShowEditor}>
          Edit
        </button>
      </div>

      <div
        ref={gameAreaRef}
        className="flex-1 flex items-center justify-center [&_canvas]:max-w-full [&_canvas]:max-h-full [&_canvas]:object-contain"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      />

      <div className="text-center text-xs text-[var(--muted)] py-1 bg-[var(--card)]">
        {tiltEnabled ? "Tilt to steer · Tap to fire" : "Tap to enable tilt controls"}
      </div>
    </div>
  );
}
