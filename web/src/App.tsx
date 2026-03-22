import { useState, useRef, useCallback, useEffect, type MouseEvent } from "react";
import { Header } from "./components/Header.tsx";
import { EditorPanel } from "./components/EditorPanel.tsx";
import { DisplayPanel } from "./components/DisplayPanel.tsx";
import { MobileGameView } from "./components/MobileGameView.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { useEngine } from "./hooks/useEngine.ts";
import { DEMOS, detectLang, SCREEN_W, SCREEN_H } from "./lib/engine.ts";

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return mobile;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState("");
  const [scale, setScale] = useState(4);
  const breakAtStart = false;
  const [selectedDemo, setSelectedDemo] = useState("");
  const [language, setLanguage] = useState<"asm" | "basic">("asm");
  const isMobile = useIsMobile();
  const [mobileShowEditor, setMobileShowEditor] = useState(false);

  const [editorWidth, setEditorWidth] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const { engineRef, status, error, loading } = useEngine(canvasRef, scale);

  const handleDividerMouseDown = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const onMouseMove = (ev: globalThis.MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        setEditorWidth(Math.min(80, Math.max(20, pct)));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [],
  );

  // Load first demo on engine init
  const initDone = useRef(false);
  useEffect(() => {
    if (loading || initDone.current) return;
    const engine = engineRef.current;
    if (!engine) return;
    if (DEMOS.length > 0) {
      const src = engine.loadDemo(0);
      if (src) {
        setSource(src);
        setLanguage(detectLang(src));
        setSelectedDemo("0");
        engine.assemble(src);
        engine.run(false);
      }
    }
    initDone.current = true;
  }, [engineRef, loading]);

  const handleSourceChange = useCallback((newSource: string) => {
    setSource(newSource);
    setLanguage(detectLang(newSource));
  }, []);

  const handleDemoChange = useCallback(
    (value: string) => {
      setSelectedDemo(value);
      if (value === "") return;
      const engine = engineRef.current;
      if (!engine) return;
      const src = engine.loadDemo(parseInt(value, 10));
      if (src) {
        setSource(src);
        setLanguage(detectLang(src));
        engine.assemble(src);
        engine.run(false);
      }
    },
    [engineRef],
  );

  const handleLoadFile = useCallback(
    (text: string) => {
      setSource(text);
      setLanguage(detectLang(text));
      setSelectedDemo("");
      const engine = engineRef.current;
      if (engine) {
        engine.assemble(text);
        engine.run(false);
      }
    },
    [engineRef],
  );

  const handleScaleChange = useCallback(
    (newScale: number) => {
      setScale(newScale);
      engineRef.current?.setScale(newScale);
    },
    [engineRef],
  );

  const handleReset = useCallback(() => {
    engineRef.current?.assemble(source);
    engineRef.current?.run(breakAtStart);
  }, [engineRef, source, breakAtStart]);

  const handleMobileDemoChange = useCallback(
    (value: string) => {
      handleDemoChange(value);
      setMobileShowEditor(false);
    },
    [handleDemoChange],
  );

  // The canvas wrapper is always mounted so the engine keeps its reference.
  // On mobile, MobileGameView reparents it into its game area.
  const canvasEl = (
    <div ref={canvasWrapRef}>
      <canvas
        ref={canvasRef}
        width={SCREEN_W * scale}
        height={SCREEN_H * scale}
        className="border-2 border-[var(--border)] bg-black"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );

  if (isMobile && !mobileShowEditor) {
    return (
      <div className="font-mono text-[var(--foreground)] bg-[var(--background)]">
        {/* Hidden portal source — MobileGameView will reparent it */}
        <div style={{ display: "none" }}>{canvasEl}</div>
        <MobileGameView
          engine={engineRef.current}
          demos={DEMOS}
          selectedDemo={selectedDemo}
          onDemoChange={handleMobileDemoChange}
          onShowEditor={() => setMobileShowEditor(true)}
          canvasPortalRef={canvasWrapRef}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden font-mono text-[var(--foreground)] bg-[var(--background)]">
      <Header />
      <div ref={containerRef} className="flex flex-1 min-h-0">
        <EditorPanel
          source={source}
          onSourceChange={handleSourceChange}
          language={language}
          demos={DEMOS}
          selectedDemo={selectedDemo}
          onDemoChange={handleDemoChange}
          onLoadFile={handleLoadFile}
          style={{ width: `${editorWidth}%` }}
        />
        <div
          className="divider"
          onMouseDown={handleDividerMouseDown}
        />
        <DisplayPanel
          ref={canvasRef}
          engine={engineRef.current}
          scale={scale}
          onScaleChange={handleScaleChange}
          error={error}
          fps={status.fps}
          onReset={handleReset}
        />
      </div>
      {isMobile && (
        <button
          className="btn w-full py-2 text-sm"
          onClick={() => setMobileShowEditor(false)}
        >
          Back to Game
        </button>
      )}
      <StatusBar status={status} />
    </div>
  );
}
