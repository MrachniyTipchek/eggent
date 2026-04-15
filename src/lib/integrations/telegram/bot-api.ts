export interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
  result?: Record<string, unknown>;
}

export function parseTelegramError(
  status: number,
  payload: TelegramApiResponse | null
): string {
  const description = payload?.description?.trim();
  return description
    ? `Telegram API error (${status}): ${description}`
    : `Telegram API error (${status})`;
}

export async function callTelegramApi(
  botToken: string,
  method: string,
  body?: Record<string, unknown>
): Promise<TelegramApiResponse> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }
  );

  const payload = (await response.json().catch(() => null)) as
    | TelegramApiResponse
    | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(parseTelegramError(response.status, payload));
  }
  return payload;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  options?: {
    replyToMessageId?: number;
    transformOutgoingText?: (value: string) => string;
  }
): Promise<void> {
  const outgoing = options?.transformOutgoingText
    ? options.transformOutgoingText(text)
    : text;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: outgoing,
  };
  if (typeof options?.replyToMessageId === "number") {
    body.reply_to_message_id = options.replyToMessageId;
  }
  await callTelegramApi(botToken, "sendMessage", body);
}
