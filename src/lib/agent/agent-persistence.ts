import {
  streamText,
  generateText,
  stepCountIs,
  hasToolCall,
  type ModelMessage,
} from "ai";
import { createModel } from "@/lib/providers/llm-provider";
import { buildSystemPrompt } from "@/lib/agent/prompts";
import { getSettings } from "@/lib/storage/settings-store";
import { getChat, saveChat } from "@/lib/storage/chat-store";
import { createAgentTools } from "@/lib/tools/tool";
import { getProjectMcpTools } from "@/lib/mcp/client";
import type { AgentContext } from "@/lib/agent/types";
import { History } from "@/lib/agent/history";
import type { ChatMessage } from "@/lib/types";
import { publishUiSyncEvent } from "@/lib/realtime/event-bus";
import { applyGlobalToolLoopGuard } from "@/lib/agent/agent-recovery-loop";
import {
  convertChatMessagesToModelMessages,
  convertModelMessageToChatMessages,
} from "@/lib/agent/agent-message-convert";
import {
  buildMissingFinalResponseFallback,
  getLastAssistantText,
  getLastResponseToolText,
  hasVisibleText,
  logLLMRequest,
  shouldAutoContinueAssistant,
} from "@/lib/agent/agent-llm-helpers";

const MAX_TOOL_STEPS_PER_TURN = 30;
const MAX_TOOL_STEPS_SUBORDINATE = 15;

function resolveModelProviderOptions(provider: string) {
  if (provider === "codex-cli") {
    return {
      openai: {
        store: false as const,
        instructions: "You are Eggent, an AI coding assistant.",
      },
    };
  }
  return undefined;
}

export async function runAgent(options: {
  chatId: string;
  userMessage: string;
  projectId?: string;
  currentPath?: string;
  agentNumber?: number;
}) {
  const settings = await getSettings();
  const providerOptions = resolveModelProviderOptions(settings.chatModel.provider);
  const model = createModel(settings.chatModel, {
    projectId: options.projectId,
    currentPath: options.currentPath,
  });

  const context: AgentContext = {
    chatId: options.chatId,
    projectId: options.projectId,
    currentPath: options.currentPath,
    memorySubdir: options.projectId ? `${options.projectId}` : "main",
    knowledgeSubdirs: options.projectId
      ? [`${options.projectId}`, "main"]
      : ["main"],
    history: [],
    agentNumber: options.agentNumber ?? 0,
    data: {
      currentUserMessage: options.userMessage,
    },
  };

  const chat = await getChat(options.chatId);
  if (chat) {
    const allMessages = convertChatMessagesToModelMessages(chat.messages);
    const history = new History(80);
    history.addMany(allMessages);
    context.history = history.getAll();
  }

  const baseTools = createAgentTools(context, settings);
  let mcpCleanup: (() => Promise<void>) | undefined;
  let tools = baseTools;
  if (options.projectId) {
    const mcp = await getProjectMcpTools(options.projectId);
    if (mcp) {
      tools = { ...baseTools, ...mcp.tools };
      mcpCleanup = mcp.cleanup;
    }
  }
  tools = applyGlobalToolLoopGuard(tools);
  const toolNames = Object.keys(tools);

  const systemPrompt = await buildSystemPrompt({
    projectId: options.projectId,
    chatId: options.chatId,
    agentNumber: options.agentNumber,
    tools: toolNames,
  });

  const messages: ModelMessage[] = [
    ...context.history,
    { role: "user", content: options.userMessage },
  ];

  logLLMRequest({
    model: `${settings.chatModel.provider}/${settings.chatModel.model}`,
    system: systemPrompt,
    messages,
    toolNames,
    temperature: settings.chatModel.temperature,
    maxTokens: settings.chatModel.maxTokens,
    label: "LLM Request (stream)",
  });

  const userMessageRecord: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: options.userMessage,
    createdAt: new Date().toISOString(),
  };

  async function ensureUserMessageSaved() {
    try {
      const chatInner = await getChat(options.chatId);
      if (!chatInner) return;
      const alreadySaved = chatInner.messages.some((msg) => msg.id === userMessageRecord.id);
      if (alreadySaved) return;

      chatInner.messages.push(userMessageRecord);
      chatInner.updatedAt = userMessageRecord.createdAt;
      const userMessageCount = chatInner.messages.filter((m) => m.role === "user").length;
      if (userMessageCount === 1 && chatInner.title === "New Chat") {
        chatInner.title =
          options.userMessage.slice(0, 60) +
          (options.userMessage.length > 60 ? "..." : "");
      }
      await saveChat(chatInner);
    } catch {
    }
  }

  async function persistAssistantTurn(payload: {
    responseMessages: ModelMessage[];
    continuationText?: string;
    fallbackText?: string;
  }): Promise<"none" | "continued" | "fallback" | "finished"> {
    const { responseMessages, continuationText = "", fallbackText = "" } = payload;
    try {
      const chatInner = await getChat(options.chatId);
      if (!chatInner) return "none";

      if (!chatInner.messages.some((msg) => msg.id === userMessageRecord.id)) {
        chatInner.messages.push(userMessageRecord);
      }

      const now = new Date().toISOString();
      for (const msg of responseMessages) {
        chatInner.messages.push(...convertModelMessageToChatMessages(msg, now));
      }
      if (continuationText || fallbackText) {
        chatInner.messages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: continuationText || fallbackText,
          createdAt: now,
        });
      }

      chatInner.updatedAt = now;
      await saveChat(chatInner);

      if (continuationText) return "continued";
      if (fallbackText) return "fallback";
      return "finished";
    } catch {
      return "none";
    }
  }

  await ensureUserMessageSaved();

  let streamErrorMessage = "";
  let streamFinished = false;
  let persistedByOnError = false;
  let onErrorPersistScheduled = false;
  let latestStepResponseMessages: ModelMessage[] = [];
  let lastFinishReason: string | undefined;
  let mcpCleanedUp = false;

  async function cleanupMcpIfNeeded() {
    if (!mcpCleanup || mcpCleanedUp) return;
    mcpCleanedUp = true;
    try {
      await mcpCleanup();
    } catch {
    }
  }

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    providerOptions,
    tools,
    stopWhen: [stepCountIs(MAX_TOOL_STEPS_PER_TURN), hasToolCall("response")],
    temperature: settings.chatModel.temperature ?? 0.7,
    maxOutputTokens: settings.chatModel.maxTokens ?? 4096,
    onStepFinish: async (step) => {
      latestStepResponseMessages = step.response.messages;
      lastFinishReason = step.finishReason;
    },
    onAbort: async () => {
      if (streamFinished || persistedByOnError) return;
      persistedByOnError = true;
      streamErrorMessage =
        streamErrorMessage || "The stream was aborted before a final response.";

      await cleanupMcpIfNeeded();

      const responseMessages = latestStepResponseMessages;
      const responseToolText = getLastResponseToolText(responseMessages).trim();
      const lastAssistantText = getLastAssistantText(responseMessages);
      const hasFinalText =
        hasVisibleText(lastAssistantText) || hasVisibleText(responseToolText);

      const fallbackText = hasFinalText
        ? ""
        : buildMissingFinalResponseFallback({
            responseMessages,
            streamErrorMessage,
          });

      const persistResult = await persistAssistantTurn({
        responseMessages,
        fallbackText,
      });

      publishUiSyncEvent({
        topic: "chat",
        projectId: options.projectId ?? null,
        chatId: options.chatId,
        reason:
          persistResult === "fallback"
            ? "agent_turn_stream_abort_fallback"
            : "agent_turn_stream_abort_partial_saved",
      });
    },
    onError: async ({ error }) => {
      streamErrorMessage = error instanceof Error ? error.message : String(error);
      console.error("Agent stream error:", error);

      if (onErrorPersistScheduled) return;
      onErrorPersistScheduled = true;

      setTimeout(async () => {
        if (streamFinished || persistedByOnError) return;
        persistedByOnError = true;
        await cleanupMcpIfNeeded();

        const responseMessages = latestStepResponseMessages;
        const responseToolText = getLastResponseToolText(responseMessages).trim();
        const lastAssistantText = getLastAssistantText(responseMessages);
        const hasFinalText =
          hasVisibleText(lastAssistantText) || hasVisibleText(responseToolText);

        const fallbackText = hasFinalText
          ? ""
          : buildMissingFinalResponseFallback({
              responseMessages,
              streamErrorMessage,
            });

        const persistResult = await persistAssistantTurn({
          responseMessages,
          fallbackText,
        });

        publishUiSyncEvent({
          topic: "chat",
          projectId: options.projectId ?? null,
          chatId: options.chatId,
          reason:
            persistResult === "fallback"
              ? "agent_turn_stream_error_fallback"
              : "agent_turn_stream_error_partial_saved",
        });
      }, 1200);
    },
    onFinish: async (event) => {
      streamFinished = true;
      const finishReason =
        typeof (event as unknown as { finishReason?: unknown }).finishReason === "string"
          ? ((event as unknown as { finishReason?: string }).finishReason as string)
          : undefined;

      const responseMessages = event.response.messages;
      const lastAssistantText = getLastAssistantText(responseMessages);
      const responseToolText = getLastResponseToolText(responseMessages).trim();
      let continuationText = "";
      let fallbackText = "";

      if (shouldAutoContinueAssistant(lastAssistantText, finishReason)) {
        try {
          const continuation = await generateText({
            model,
            system: systemPrompt,
            messages: [
              ...messages,
              ...responseMessages,
              {
                role: "user",
                content:
                  "Continue your previous answer from exactly where it stopped. " +
                  "Output only the continuation text, without repeating earlier content.",
              },
            ],
            providerOptions,
            temperature: settings.chatModel.temperature ?? 0.7,
            maxOutputTokens: Math.min(settings.chatModel.maxTokens ?? 4096, 1200),
          });
          continuationText = (continuation.text || "").trim();
        } catch (error) {
          console.warn("Auto-continuation failed:", error);
        }
      }

      if (
        !hasVisibleText(lastAssistantText) &&
        !hasVisibleText(responseToolText) &&
        !hasVisibleText(continuationText)
      ) {
        fallbackText = buildMissingFinalResponseFallback({
          responseMessages,
          streamErrorMessage,
        });
      }

      await cleanupMcpIfNeeded();
      if (!persistedByOnError) {
        await persistAssistantTurn({
          responseMessages,
          continuationText,
          fallbackText,
        });
      }

      publishUiSyncEvent({
        topic: "chat",
        projectId: options.projectId ?? null,
        chatId: options.chatId,
        reason: continuationText
          ? "agent_turn_auto_continued"
          : fallbackText
            ? "agent_turn_fallback_response"
            : lastFinishReason === "error"
              ? "agent_turn_finished_with_error"
              : "agent_turn_finished",
      });
      publishUiSyncEvent({
        topic: "files",
        projectId: options.projectId ?? null,
        reason: "agent_turn_finished",
      });
    },
  });

  return result;
}

export async function runAgentText(options: {
  chatId: string;
  userMessage: string;
  projectId?: string;
  currentPath?: string;
  agentNumber?: number;
  runtimeData?: Record<string, unknown>;
}): Promise<string> {
  const settings = await getSettings();
  const providerOptions = resolveModelProviderOptions(settings.chatModel.provider);
  const model = createModel(settings.chatModel, {
    projectId: options.projectId,
    currentPath: options.currentPath,
  });

  const context: AgentContext = {
    chatId: options.chatId,
    projectId: options.projectId,
    currentPath: options.currentPath,
    memorySubdir: options.projectId ? `${options.projectId}` : "main",
    knowledgeSubdirs: options.projectId ? [`${options.projectId}`, "main"] : ["main"],
    history: [],
    agentNumber: options.agentNumber ?? 0,
    data: {
      ...(options.runtimeData ?? {}),
      currentUserMessage: options.userMessage,
    },
  };

  const chat = await getChat(options.chatId);
  if (chat) {
    const allMessages = convertChatMessagesToModelMessages(chat.messages);
    const history = new History(80);
    history.addMany(allMessages);
    context.history = history.getAll();
  }

  const baseTools = createAgentTools(context, settings);
  let mcpCleanup: (() => Promise<void>) | undefined;
  let tools = baseTools;
  if (options.projectId) {
    const mcp = await getProjectMcpTools(options.projectId);
    if (mcp) {
      tools = { ...baseTools, ...mcp.tools };
      mcpCleanup = mcp.cleanup;
    }
  }
  tools = applyGlobalToolLoopGuard(tools);
  const toolNames = Object.keys(tools);

  const systemPrompt = await buildSystemPrompt({
    projectId: options.projectId,
    chatId: options.chatId,
    agentNumber: options.agentNumber,
    tools: toolNames,
  });

  const messages: ModelMessage[] = [
    ...context.history,
    { role: "user", content: options.userMessage },
  ];

  logLLMRequest({
    model: `${settings.chatModel.provider}/${settings.chatModel.model}`,
    system: systemPrompt,
    messages,
    toolNames,
    temperature: settings.chatModel.temperature,
    maxTokens: settings.chatModel.maxTokens,
    label: "LLM Request (non-stream)",
  });

  try {
    const generated = await generateText({
      model,
      system: systemPrompt,
      messages,
      providerOptions,
      tools,
      stopWhen: [stepCountIs(MAX_TOOL_STEPS_PER_TURN), hasToolCall("response")],
      temperature: settings.chatModel.temperature ?? 0.7,
      maxOutputTokens: settings.chatModel.maxTokens ?? 4096,
    });

    const responseMessages = (
      generated as unknown as { response?: { messages?: ModelMessage[] } }
    ).response?.messages;

    const text = generated.text ?? "";
    const fallbackReply =
      Array.isArray(responseMessages) && responseMessages.length > 0
        ? getLastResponseToolText(responseMessages) || getLastAssistantText(responseMessages)
        : "";
    const finalText = text.trim() ? text : fallbackReply;

    try {
      const latest = await getChat(options.chatId);
      if (latest) {
        const now = new Date().toISOString();
        latest.messages.push({
          id: crypto.randomUUID(),
          role: "user",
          content: options.userMessage,
          createdAt: now,
        });

        if (Array.isArray(responseMessages) && responseMessages.length > 0) {
          for (const msg of responseMessages) {
            latest.messages.push(...convertModelMessageToChatMessages(msg, now));
          }
        } else {
          latest.messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: finalText,
            createdAt: now,
          });
        }

        latest.updatedAt = now;
        await saveChat(latest);
      }
    } catch {
    }

    publishUiSyncEvent({
      topic: "files",
      projectId: options.projectId ?? null,
      reason: "agent_turn_finished",
    });

    return finalText;
  } finally {
    if (mcpCleanup) {
      try {
        await mcpCleanup();
      } catch {
      }
    }
  }
}

export async function runSubordinateAgent(options: {
  task: string;
  projectId?: string;
  parentAgentNumber: number;
  parentHistory: ModelMessage[];
}): Promise<string> {
  const settings = await getSettings();
  const providerOptions = resolveModelProviderOptions(settings.chatModel.provider);
  const model = createModel(settings.chatModel, {
    projectId: options.projectId,
  });

  const context: AgentContext = {
    chatId: `subordinate-${Date.now()}`,
    projectId: options.projectId,
    memorySubdir: options.projectId ? `projects/${options.projectId}` : "main",
    knowledgeSubdirs: options.projectId
      ? [`projects/${options.projectId}`, "main"]
      : ["main"],
    history: [],
    agentNumber: options.parentAgentNumber + 1,
    data: {},
  };

  let tools = createAgentTools(context, settings);
  let mcpCleanupSub: (() => Promise<void>) | undefined;
  if (options.projectId) {
    const mcp = await getProjectMcpTools(options.projectId);
    if (mcp) {
      tools = { ...tools, ...mcp.tools };
      mcpCleanupSub = mcp.cleanup;
    }
  }
  tools = applyGlobalToolLoopGuard(tools);
  const toolNames = Object.keys(tools);

  const systemPrompt = await buildSystemPrompt({
    projectId: options.projectId,
    agentNumber: context.agentNumber,
    tools: toolNames,
  });

  const relevantHistory = options.parentHistory.slice(-6);

  const messages: ModelMessage[] = [
    ...relevantHistory,
    {
      role: "user",
      content: `You are a subordinate agent. Complete this task and report back:\n\n${options.task}`,
    },
  ];

  logLLMRequest({
    model: `${settings.chatModel.provider}/${settings.chatModel.model}`,
    system: systemPrompt,
    messages,
    toolNames,
    temperature: settings.chatModel.temperature,
    maxTokens: settings.chatModel.maxTokens,
    label: "LLM Request (subordinate)",
  });

  try {
    const { text } = await generateText({
      model,
      system: systemPrompt,
      messages,
      providerOptions,
      tools,
      stopWhen: [stepCountIs(MAX_TOOL_STEPS_SUBORDINATE), hasToolCall("response")],
      temperature: settings.chatModel.temperature ?? 0.7,
      maxOutputTokens: settings.chatModel.maxTokens ?? 4096,
    });
    return text;
  } finally {
    if (mcpCleanupSub) {
      try {
        await mcpCleanupSub();
      } catch {
      }
    }
  }
}
