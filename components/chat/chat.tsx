"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { CircleAlertIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { EmptyState } from "@/components/chat/empty-state";
import { ChatMessage } from "@/components/chat/message-parts";
import { SiteHeader } from "@/components/chat/site-header";
import { ToolPicker } from "@/components/chat/tool-picker";
import { Button } from "@/components/ui/button";
import type { CatalogTool } from "@/lib/sources";

function useToolCatalog() {
  const [catalog, setCatalog] = useState<CatalogTool[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tools", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { tools: [] }))
      .then((data: { tools?: CatalogTool[] }) => setCatalog(data.tools ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return catalog;
}

// Agent-blue ping: the "live" signal used while tools are running.
function LiveDot() {
  return (
    <span className="relative flex size-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-60" />
      <span className="relative inline-flex size-1.5 rounded-full bg-agent" />
    </span>
  );
}

export function Chat() {
  const [input, setInput] = useState("");
  // Pinned sources scope the *next* message only — switch, add, or clear
  // mid-conversation and the new selection applies from the next question on.
  const [pinnedTools, setPinnedTools] = useState<CatalogTool[]>([]);
  const catalog = useToolCatalog();
  const sources = useMemo(
    () => new Map(catalog.map((t) => [t.name, t.source])),
    [catalog],
  );

  const togglePinnedTool = (tool: CatalogTool) =>
    setPinnedTools((prev) =>
      prev.some((t) => t.name === tool.name)
        ? prev.filter((t) => t.name !== tool.name)
        : [...prev, tool],
    );

  const [transport] = useState(
    () => new DefaultChatTransport({ api: "/api/chat" }),
  );
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    transport,
  });

  const busy = status === "submitted" || status === "streaming";
  const started = messages.length > 0;
  const lastMessage = messages[messages.length - 1];

  const awaitingResponse =
    status === "submitted" ||
    (status === "streaming" &&
      (lastMessage?.role !== "assistant" ||
        !lastMessage.parts.some(
          (p) => p.type === "text" && p.text.length > 0,
        )));

  const submit = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    void sendMessage(
      { text: question },
      {
        body: {
          tools:
            pinnedTools.length > 0
              ? pinnedTools.map((t) => t.name)
              : undefined,
        },
      },
    );
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => submit(message.text);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <SiteHeader />

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col border-x border-line">
        <Conversation className="flex-1">
          <ConversationContent className="gap-6 px-4 py-6">
            {!started && <EmptyState onSuggestion={submit} />}

            {messages.map((message) => (
              <ChatMessage
                isLast={message.id === lastMessage?.id}
                isStreaming={status === "streaming"}
                key={message.id}
                message={message}
                sources={sources}
              />
            ))}

            {awaitingResponse && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <LiveDot />
                <Shimmer as="span">Consultando fuentes públicas…</Shimmer>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-between gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3">
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
                  <span>Algo falló al consultar el agente.</span>
                </div>
                <Button onClick={() => regenerate()} size="sm" variant="outline">
                  <RotateCcwIcon className="size-3.5" />
                  Reintentar
                </Button>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t border-line">
          <div className="p-4 pb-3">
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputBody>
                <PromptInputTextarea
                  autoFocus
                  onChange={(e) => setInput(e.currentTarget.value)}
                  placeholder="Pregunta por procesos, RUC, DOF, jurisprudencia…"
                  value={input}
                />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools className="flex-wrap gap-1.5">
                  <ToolPicker
                    onClear={() => setPinnedTools([])}
                    onToggle={togglePinnedTool}
                    selected={pinnedTools}
                    tools={catalog}
                  />
                  {pinnedTools.map((tool) => (
                    <button
                      aria-label={`Quitar ${tool.source}`}
                      className="group/chip flex h-7 cursor-pointer items-center gap-1.5 border border-agent/40 bg-agent/5 px-2 font-mono text-[10px] transition-colors duration-150 hover:border-agent/70 active:scale-[0.97]"
                      key={tool.name}
                      onClick={() => togglePinnedTool(tool)}
                      type="button"
                    >
                      <span className="max-w-36 truncate">{tool.source}</span>
                      <XIcon className="size-3 text-muted-foreground transition-colors group-hover/chip:text-foreground" />
                    </button>
                  ))}
                </PromptInputTools>
                <PromptInputSubmit
                  disabled={!busy && !input.trim()}
                  onStop={stop}
                  status={status}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-2">
            <span className="eyebrow-sm flex items-center gap-2">
              <LiveDot />
              MCP en vivo
            </span>
            <span className="eyebrow-sm text-right">
              Datos informativos · no es asesoría legal
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
