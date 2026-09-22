import type { LanguageModelMiddleware } from "ai";

// Groq validates tool calls against their schemas on its side and rejects the
// whole step when one does not fit ("Tool call validation failed: … expected
// integer, but got null", or a tool name that is not active). Without this the
// chat turn ends in an error; with it, the step runs once more with the
// rejection spelled out, which the model almost always fixes.

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type StreamResult = Awaited<ReturnType<WrapStream>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRejectedToolCall(error: unknown): boolean {
  return /tool call validation failed/i.test(messageOf(error));
}

function repairNote(error: unknown) {
  return {
    role: "system" as const,
    content: `The provider rejected your last tool call: ${messageOf(error).slice(0, 400)}. Call only tools that are available right now, with arguments that match their schema; leave optional fields out instead of sending null.`,
  };
}

export const retryRejectedToolCall: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate, params, model }) => {
    try {
      return await doGenerate();
    } catch (error) {
      if (!isRejectedToolCall(error)) throw error;
      console.warn("[croma-chat] tool call rejected, retrying once:", messageOf(error));
      return model.doGenerate({ ...params, prompt: [...params.prompt, repairNote(error)] });
    }
  },

  wrapStream: async ({ doStream, params, model }) => {
    const retry = (error: unknown) => {
      console.warn("[croma-chat] tool call rejected, retrying once:", messageOf(error));
      return model.doStream({ ...params, prompt: [...params.prompt, repairNote(error)] });
    };

    let first: StreamResult;
    try {
      first = await doStream();
    } catch (error) {
      if (!isRejectedToolCall(error)) throw error;
      return retry(error);
    }

    const stream = new ReadableStream<StreamPart>({
      async start(controller) {
        const reader = first.stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === "error" && isRejectedToolCall(value.error)) {
              await reader.cancel().catch(() => undefined);
              const again = (await retry(value.error)).stream.getReader();
              for (;;) {
                const next = await again.read();
                if (next.done) break;
                if (next.value.type !== "stream-start") controller.enqueue(next.value);
              }
              break;
            }
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return { ...first, stream };
  },
};
