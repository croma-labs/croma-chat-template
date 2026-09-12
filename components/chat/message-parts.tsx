"use client";

import type { UIMessage } from "ai";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { toolTitle } from "@/lib/sources";

function isToolPart(part: { type: string }): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

type ChatMessageProps = {
  message: UIMessage;
  isLast: boolean;
  isStreaming: boolean;
  // tool name → source label, from the live catalog
  sources: ReadonlyMap<string, string>;
};

export function ChatMessage({
  message,
  isLast,
  isStreaming,
  sources,
}: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent className="group-[.is-user]:rounded-none group-[.is-user]:border group-[.is-user]:border-line group-[.is-user]:bg-secondary/60">
          {message.parts
            .filter((p) => p.type === "text")
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("")}
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        {message.parts.map((part, i) => {
          const key = `${message.id}-${i}`;
          if (part.type === "text") {
            return <MessageResponse key={key}>{part.text}</MessageResponse>;
          }
          if (part.type === "reasoning") {
            return (
              <Reasoning
                className="w-full"
                isStreaming={part.state === "streaming" && isStreaming && isLast}
                key={key}
              >
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );
          }
          if (isToolPart(part)) {
            const toolName =
              part.type === "dynamic-tool"
                ? part.toolName
                : part.type.replace(/^tool-/, "");
            const title = toolTitle(toolName, sources.get(toolName));
            return (
              <Tool className="rounded-none border-line" key={key}>
                {part.type === "dynamic-tool" ? (
                  <ToolHeader
                    state={part.state}
                    title={title}
                    toolName={toolName}
                    type={part.type}
                  />
                ) : (
                  <ToolHeader state={part.state} title={title} type={part.type} />
                )}
                <ToolContent>
                  {part.input != null && <ToolInput input={part.input} />}
                  <ToolOutput errorText={part.errorText} output={part.output} />
                </ToolContent>
              </Tool>
            );
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}
