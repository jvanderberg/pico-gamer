import { useState, useRef, useCallback, useEffect, type MouseEvent } from "react";
import { Header } from "./components/Header.tsx";
import { EditorPanel } from "./components/EditorPanel.tsx";
import { DisplayPanel } from "./components/DisplayPanel.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { useEngine } from "./hooks/useEngine.ts";
import { DEMOS, detectLang } from "./lib/engine.ts";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState("");
  const [scale, setScale] = useState(4);
  const [breakAtStart, setBreakAtStart] = useState(false);
  const [selectedDemo, setSelectedDemo] = useState("");
  const [language, setLanguage] = useState<"asm" | "basic">("asm");

  const [editorWidth, setEditorWidth] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const { engineRef, status, stackText, error, loading } = useEngine(canvasRef, scale);

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
      }
    }
    initDone.current = true;
  }, [engineRef, loading]); // loading=false signals engine is ready

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
      }
    },
    [engineRef],
  );

  const handleLoadFile = useCallback(
    (text: string) => {
      setSource(text);
      setLanguage(detectLang(text));
      setSelectedDemo("");
      engineRef.current?.loadSource();
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

  const handleAssemble = useCallback(() => {
    engineRef.current?.assemble(source);
  }, [engineRef, source]);

  const handleRun = useCallback(() => {
    // Auto-assemble if needed
    engineRef.current?.assemble(source);
    engineRef.current?.run(breakAtStart);
  }, [engineRef, source, breakAtStart]);

  const handleStop = useCallback(() => {
    engineRef.current?.stop();
  }, [engineRef]);

  const handleStep = useCallback(() => {
    engineRef.current?.step(source);
  }, [engineRef, source]);

  const handleReset = useCallback(() => {
    engineRef.current?.reset();
  }, [engineRef]);

  const handleMemCommand = useCallback(
    (cmd: string): string => {
      return engineRef.current?.handleMemCommand(cmd) ?? "";
    },
    [engineRef],
  );

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
          breakAtStart={breakAtStart}
          onBreakAtStartChange={setBreakAtStart}
          error={error}
          stackText={stackText}
          fps={status.fps}
          onAssemble={handleAssemble}
          onRun={handleRun}
          onStop={handleStop}
          onStep={handleStep}
          onReset={handleReset}
          onMemCommand={handleMemCommand}
        />
      </div>
      <StatusBar status={status} />
    </div>
  );
}
