import { useCallback } from "react";
import { INPUT_NAME_TO_BIT, type Engine } from "../lib/engine.ts";

interface EncoderGroupProps {
  engine: Engine | null;
}

function useInputButton(engine: Engine | null, name: string) {
  const bit = INPUT_NAME_TO_BIT[name]!;
  const press = useCallback(() => engine?.pressInput(bit), [engine, bit]);
  const release = useCallback(() => engine?.releaseInput(bit), [engine, bit]);
  return { press, release };
}

interface InputButtonProps {
  engine: Engine | null;
  name: string;
  className?: string;
  children: React.ReactNode;
}

function InputButton({ engine, name, className, children }: InputButtonProps) {
  const { press, release } = useInputButton(engine, name);
  return (
    <button
      className={className ?? "btn"}
      onMouseDown={press}
      onMouseUp={release}
      onMouseLeave={release}
      onTouchStart={(e) => { e.preventDefault(); press(); }}
      onTouchEnd={(e) => { e.preventDefault(); release(); }}
    >
      {children}
    </button>
  );
}

export function EncoderGroup({ engine }: EncoderGroupProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 select-none touch-none">
      <InputButton engine={engine} name="btn" className="btn enc-back">
        Back
      </InputButton>
      <div className="flex items-center gap-1.5">
        <InputButton engine={engine} name="enc_ccw" className="btn enc-arrow">
          &#9664;
        </InputButton>
        <InputButton engine={engine} name="enc_btn" className="btn enc-knob">
          {""}
        </InputButton>
        <InputButton engine={engine} name="enc_cw" className="btn enc-arrow">
          &#9654;
        </InputButton>
      </div>
      <InputButton engine={engine} name="btn" className="btn enc-confirm">
        OK
      </InputButton>
    </div>
  );
}
