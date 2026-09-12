"use client";

import { CheckIcon, ChevronDownIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type CatalogTool,
  categoryOf,
  countriesOf,
  countryMeta,
} from "@/lib/sources";

type ToolPickerProps = {
  tools: CatalogTool[];
  selected: CatalogTool[];
  onToggle: (tool: CatalogTool) => void;
  onClear: () => void;
};

// Multi-select: toggling keeps the popover open so several sources can be
// pinned in one pass. Selection applies to the next message, not the past.
export function ToolPicker({
  tools,
  selected,
  onToggle,
  onClear,
}: ToolPickerProps) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState("Todas");

  const selectedNames = useMemo(
    () => new Set(selected.map((t) => t.name)),
    [selected],
  );

  // Tabs follow the live catalog, so new countries appear on their own.
  const countries = useMemo(() => countriesOf(tools), [tools]);

  // country filter → { groupHeading: tools[] }, countries in tab order
  const groups = useMemo(() => {
    const filtered =
      country === "Todas"
        ? [...tools].sort(
            (a, b) =>
              countries.indexOf(a.country) - countries.indexOf(b.country),
          )
        : tools.filter((t) => t.country === country);
    const byGroup = new Map<string, CatalogTool[]>();
    for (const tool of filtered) {
      const { flag, label } = countryMeta(tool.country);
      const heading =
        country === "Todas" ? `${flag} ${label}` : categoryOf(tool.name);
      byGroup.set(heading, [...(byGroup.get(heading) ?? []), tool]);
    }
    return byGroup;
  }, [tools, countries, country]);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            className={cn(
              "h-7 gap-1.5 rounded-none border-line px-2.5 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-foreground/40 active:scale-[0.97]",
              selected.length > 0 && "border-agent/50 text-foreground",
            )}
            disabled={tools.length === 0}
            size="sm"
            variant="outline"
          />
        }
      >
        <SlidersHorizontalIcon
          className={cn(
            "size-3",
            selected.length > 0 ? "text-agent" : "text-muted-foreground",
          )}
        />
        Fuentes
        {selected.length > 0 ? (
          <>
            <span className="text-agent">
              {String(selected.length).padStart(2, "0")}
            </span>
            {/* Clear all without reopening the popover */}
            <span
              aria-label="Quitar todas las fuentes"
              className="-mr-1 p-0.5 hover:bg-muted"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              role="button"
            >
              <XIcon className="size-3" />
            </span>
          </>
        ) : (
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-88 p-0" sideOffset={8}>
        <div className="flex items-stretch divide-x divide-line overflow-x-auto border-b border-line">
          {["Todas", ...countries].map((option) => (
            <button
              className={cn(
                "flex-1 shrink-0 cursor-pointer whitespace-nowrap px-1.5 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150",
                country === option
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
              key={option}
              onClick={() => setCountry(option)}
              type="button"
            >
              {option === "Todas"
                ? "Todas"
                : `${countryMeta(option).flag} ${countryMeta(option).short}`}
            </button>
          ))}
        </div>
        <Command>
          <CommandInput placeholder="Buscar fuente o herramienta…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {[...groups.entries()].map(([heading, groupTools]) => (
              <CommandGroup heading={heading} key={heading}>
                {groupTools.map((tool) => {
                  const active = selectedNames.has(tool.name);
                  return (
                    <CommandItem
                      key={tool.name}
                      onSelect={() => onToggle(tool)}
                      value={`${tool.name} ${tool.title} ${tool.source} ${categoryOf(tool.name)}`}
                    >
                      <span
                        className={cn(
                          "flex size-3.5 shrink-0 items-center justify-center border border-line",
                          active && "border-agent bg-agent text-background",
                        )}
                      >
                        {active && <CheckIcon className="size-2.5" />}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{tool.title}</span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {tool.name}
                        </span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <div className="flex items-center justify-between border-t border-line px-3 py-2">
          <span className="eyebrow-sm">
            {selected.length === 0
              ? "Todas las fuentes activas"
              : `${selected.length} ${selected.length === 1 ? "fuente fijada" : "fuentes fijadas"}`}
          </span>
          {selected.length > 0 && (
            <button
              className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
              onClick={onClear}
              type="button"
            >
              Limpiar
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
