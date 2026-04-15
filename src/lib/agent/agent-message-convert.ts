import type { ModelMessage } from "ai";
import type { ChatMessage } from "@/lib/types";

export function convertChatMessagesToModelMessages(
  messages: ChatMessage[]
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const m of messages) {
    if (m.role === "tool") {
      result.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: m.toolCallId!,
            toolName: m.toolName!,
            output: {
              type: "json",
              value: m.toolResult as import("@ai-sdk/provider").JSONValue,
            },
          },
        ],
      });
    } else if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const content: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
      > = [];
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      for (const tc of m.toolCalls) {
        content.push({
          type: "tool-call",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.args,
        });
      }
      result.push({ role: "assistant", content });
    } else if (m.role === "user" || m.role === "assistant") {
      result.push({ role: m.role, content: m.content });
    }
  }

  return result;
}

export function convertModelMessageToChatMessages(
  msg: ModelMessage,
  now: string
): ChatMessage[] {
  if (msg.role === "tool") {
    const content = Array.isArray(msg.content) ? msg.content : [];
    const toolMessages: ChatMessage[] = [];

    for (const part of content) {
      if (
        !(
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "tool-result"
        )
      ) {
        continue;
      }

      const tr = part as {
        toolCallId: string;
        toolName: string;
        output?: { type: string; value: unknown } | unknown;
        result?: unknown;
      };

      const outputContainer = tr.output ?? tr.result;
      const outputValue =
        typeof outputContainer === "object" &&
        outputContainer !== null &&
        "value" in outputContainer
          ? (outputContainer as { value: unknown }).value
          : outputContainer;

      toolMessages.push({
        id: crypto.randomUUID(),
        role: "tool",
        content:
          outputValue === undefined
            ? ""
            : typeof outputValue === "string"
              ? outputValue
              : JSON.stringify(outputValue),
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        toolResult: outputValue,
        createdAt: now,
      });
    }

    return toolMessages;
  }

  if (msg.role === "assistant") {
    const content = msg.content;
    if (Array.isArray(content)) {
      let textContent = "";
      const toolCalls: ChatMessage["toolCalls"] = [];

      for (const part of content) {
        if (typeof part === "object" && part !== null) {
          if ("type" in part && part.type === "text" && "text" in part) {
            textContent += (part as { text: string }).text;
          } else if ("type" in part && part.type === "tool-call") {
            const tc = part as { toolCallId: string; toolName: string; input: unknown };
            toolCalls.push({
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              args: tc.input as Record<string, unknown>,
            });
          }
        }
      }

      return [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          createdAt: now,
        },
      ];
    }
    return [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: typeof content === "string" ? content : "",
        createdAt: now,
      },
    ];
  }

  return [
    {
      id: crypto.randomUUID(),
      role: msg.role as "user" | "assistant" | "system" | "tool",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      createdAt: now,
    },
  ];
}
