import { anthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { retryRejectedToolCall } from "@/lib/tool-call-retry";

// Claude first (claude-opus-5) when an Anthropic key is configured; otherwise
// fall back to the same Groq model the Croma marketing agent runs on, so the
// sample works with the keys the reference project already uses.

export type ResolvedModel = {
  model: LanguageModel;
  id: string;
};

export function resolveModel(): ResolvedModel | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return { model: anthropic("claude-opus-5"), id: "claude-opus-5" };
  }
  if (process.env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return {
      // Groq checks tool calls against their schemas and rejects the step on
      // a mismatch; retry that step once instead of failing the turn.
      model: wrapLanguageModel({
        model: groq("openai/gpt-oss-120b"),
        middleware: retryRejectedToolCall,
      }),
      id: "openai/gpt-oss-120b",
    };
  }
  return null;
}
