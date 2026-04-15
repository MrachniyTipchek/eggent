import type { ModelMessage } from "ai";

export const LLM_LOG_BORDER = "═".repeat(60);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function logLLMRequest(options: {
  model: string;
  system: string;
  messages: ModelMessage[];
  toolNames: string[];
  temperature?: number;
  maxTokens?: number;
  label?: string;
}) {
  const {
    model,
    system,
    messages,
    toolNames,
    temperature,
    maxTokens,
    label = "LLM Request",
  } = options;
  console.log(`\n${LLM_LOG_BORDER}`);
  console.log(`  ${label}`);
  console.log(LLM_LOG_BORDER);
  console.log(`  Model: ${model}`);
  console.log(`  Temperature: ${temperature ?? "default"}`);
  console.log(`  Max tokens: ${maxTokens ?? "default"}`);
  console.log(`  Tools: ${toolNames.length ? toolNames.join(", ") : "none"}`);
  console.log(`  Messages: ${messages.length}`);
  console.log(LLM_LOG_BORDER);
  console.log("  --- SYSTEM ---\n");
  console.log(system);
  console.log("\n  --- MESSAGES ---");
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const role = m.role.toUpperCase();
    const content =
      typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    const preview = content.length > 500 ? content.slice(0, 500) + "…" : content;
    console.log(`  [${i + 1}] ${role}:\n${preview}`);
  }
  console.log(`\n${LLM_LOG_BORDER}\n`);
}

function extractAssistantText(msg: ModelMessage): string {
  if (msg.role !== "assistant") return "";
  const content = msg.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  let text = "";
  for (const part of content) {
    if (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      text += (part as { text: string }).text;
    }
  }
  return text;
}

export function getLastAssistantText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const text = extractAssistantText(msg).trim();
    if (text) return text;
  }
  return "";
}

function extractToolResultOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  const record = asRecord(output);
  if (!record) {
    if (output === null || output === undefined) {
      return "";
    }
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }

  const value = "value" in record ? record.value : undefined;
  if (typeof value === "string") {
    return value;
  }
  if (value !== undefined) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  try {
    return JSON.stringify(record);
  } catch {
    return String(record);
  }
}

export function getLastResponseToolText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];

    if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j -= 1) {
        const part = msg.content[j];
        if (!(typeof part === "object" && part !== null)) continue;
        if (!("type" in part) || part.type !== "tool-result") continue;
        const toolName =
          "toolName" in part && typeof (part as { toolName?: unknown }).toolName === "string"
            ? ((part as { toolName: string }).toolName as string)
            : "";
        if (toolName !== "response") continue;

        const output =
          "output" in part
            ? (part as { output?: unknown }).output
            : (part as { result?: unknown }).result;
        const text = extractToolResultOutputText(output).trim();
        if (text) return text;
      }
    }

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j -= 1) {
        const part = msg.content[j];
        if (!(typeof part === "object" && part !== null)) continue;
        if (!("type" in part) || part.type !== "tool-call") continue;
        const toolName =
          "toolName" in part && typeof (part as { toolName?: unknown }).toolName === "string"
            ? ((part as { toolName: string }).toolName as string)
            : "";
        if (toolName !== "response") continue;
        const input =
          "input" in part ? (part as { input?: unknown }).input : undefined;
        const inputRecord = asRecord(input);
        const message =
          typeof inputRecord?.message === "string" ? inputRecord.message.trim() : "";
        if (message) return message;
      }
    }
  }
  return "";
}

function getLastNonResponseToolResult(messages: ModelMessage[]): {
  toolName: string;
  text: string;
} | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "tool" || !Array.isArray(msg.content)) {
      continue;
    }

    for (let j = msg.content.length - 1; j >= 0; j -= 1) {
      const part = msg.content[j];
      if (!(typeof part === "object" && part !== null)) continue;
      if (!("type" in part) || part.type !== "tool-result") continue;

      const toolName =
        "toolName" in part && typeof (part as { toolName?: unknown }).toolName === "string"
          ? (part as { toolName: string }).toolName
          : "";
      if (!toolName || toolName === "response") continue;

      const output =
        "output" in part
          ? (part as { output?: unknown }).output
          : (part as { result?: unknown }).result;
      const text = extractToolResultOutputText(output).trim();
      return {
        toolName,
        text,
      };
    }
  }

  return null;
}

function truncateForFallback(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function formatStreamErrorForUser(errorMessage: string): string {
  const compact = errorMessage.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

function normalizeInvisibleChars(text: string): string {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}

export function hasVisibleText(text: string): boolean {
  return normalizeInvisibleChars(text).trim().length > 0;
}

export function buildMissingFinalResponseFallback(options: {
  responseMessages: ModelMessage[];
  streamErrorMessage: string;
}): string {
  const { responseMessages, streamErrorMessage } = options;
  const lastToolResult = getLastNonResponseToolResult(responseMessages);
  const streamErrorText = formatStreamErrorForUser(streamErrorMessage);
  const fallbackLines: string[] = [
    "Tool execution finished, but I could not produce a final response for this turn.",
  ];

  if (streamErrorText) {
    fallbackLines.push(`Reason: ${streamErrorText}`);
  }

  if (lastToolResult?.toolName) {
    fallbackLines.push(`Last tool: \`${lastToolResult.toolName}\``);
  }

  if (lastToolResult?.text) {
    fallbackLines.push(
      [
        "Last tool output (truncated):",
        "```text",
        truncateForFallback(lastToolResult.text, 1200),
        "```",
      ].join("\n")
    );
  }

  fallbackLines.push("Send `continue` and I will finish the answer.");
  return fallbackLines.join("\n\n");
}

export function shouldAutoContinueAssistant(
  text: string,
  finishReason?: string
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const reason = (finishReason || "").toLowerCase();
  if (reason === "length" || reason === "max_tokens") {
    return true;
  }

  if (/(?:here is (?:the )?prompt|вот (?:твой )?(?:промпт|prompt))[:：]?\s*$/i.test(trimmed)) {
    return true;
  }

  return false;
}
