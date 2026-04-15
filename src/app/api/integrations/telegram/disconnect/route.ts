import {
  getTelegramIntegrationPublicSettings,
  getTelegramIntegrationRuntimeConfig,
  getTelegramIntegrationStoredSettings,
  saveTelegramIntegrationStoredSettings,
} from "@/lib/storage/telegram-integration-store";
import { callTelegramApi } from "@/lib/integrations/telegram/bot-api";

async function deleteTelegramWebhook(botToken: string): Promise<void> {
  await callTelegramApi(botToken, "deleteWebhook", {
    drop_pending_updates: false,
  });
}

export async function POST() {
  try {
    const runtime = await getTelegramIntegrationRuntimeConfig();
    const stored = await getTelegramIntegrationStoredSettings();
    const botToken = runtime.botToken.trim();

    let webhookRemoved = false;
    let webhookWarning: string | null = null;

    if (botToken) {
      try {
        await deleteTelegramWebhook(botToken);
        webhookRemoved = true;
      } catch (error) {
        webhookWarning =
          error instanceof Error
            ? error.message
            : "Failed to remove Telegram webhook";
      }
    }

    await saveTelegramIntegrationStoredSettings({
      botToken: "",
      webhookSecret: "",
      publicBaseUrl: stored.publicBaseUrl,
      defaultProjectId: stored.defaultProjectId,
    });

    const settings = await getTelegramIntegrationPublicSettings();
    const note =
      settings.sources.botToken === "env"
        ? "Token is still provided by .env. Remove TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET to fully disconnect."
        : null;

    return Response.json({
      success: true,
      message: "Telegram disconnected",
      webhookRemoved,
      webhookWarning,
      note,
      settings,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to disconnect Telegram integration",
      },
      { status: 500 }
    );
  }
}
