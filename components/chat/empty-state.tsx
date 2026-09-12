"use client";

import Image from "next/image";
import { SUGGESTIONS } from "@/lib/sources";

// Corner-tick frame: an inset hairline square with four bracket marks
// straddling it — the "crafted" focal point of the empty screen.
function SymbolFrame() {
  return (
    <div className="relative flex size-24 items-center justify-center">
      <span aria-hidden className="absolute inset-2 border border-line" />
      <span
        aria-hidden
        className="absolute top-2 left-2 size-2 -translate-x-1/2 -translate-y-1/2 border-t border-l border-foreground/40"
      />
      <span
        aria-hidden
        className="absolute top-2 right-2 size-2 translate-x-1/2 -translate-y-1/2 border-t border-r border-foreground/40"
      />
      <span
        aria-hidden
        className="absolute bottom-2 left-2 size-2 -translate-x-1/2 translate-y-1/2 border-b border-l border-foreground/40"
      />
      <span
        aria-hidden
        className="absolute right-2 bottom-2 size-2 translate-x-1/2 translate-y-1/2 border-b border-r border-foreground/40"
      />
      <Image
        alt=""
        className="size-9 dark:invert"
        height={36}
        src="/croma_symbol_black.svg"
        width={36}
      />
    </div>
  );
}

type EmptyStateProps = {
  onSuggestion: (text: string) => void;
};

export function EmptyState({ onSuggestion }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <SymbolFrame />
      <div className="space-y-3">
        <p className="eyebrow">Croma MCP — Datos en vivo</p>
        <h1 className="text-balance text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
          Datos públicos de LatAm,
          <br />
          consultados en tiempo real.
        </h1>
        <p className="mx-auto max-w-md text-balance text-sm leading-relaxed text-muted-foreground">
          Fuentes judiciales, tributarias y registrales de Colombia, Perú,
          México, Brasil y Estados Unidos — detrás del mismo servidor MCP que
          puedes conectar a Claude, ChatGPT o Cursor.
        </p>
      </div>
      <div className="flex max-w-xl flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((suggestion, i) => (
          <button
            className="group flex cursor-pointer items-center gap-2 border border-line px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-foreground/40 hover:text-foreground active:scale-[0.97]"
            key={suggestion}
            onClick={() => onSuggestion(suggestion)}
            type="button"
          >
            <span className="font-mono text-[9px] text-agent">
              [{String(i + 1).padStart(2, "0")}]
            </span>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
