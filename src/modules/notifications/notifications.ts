import type { Database, NotificationChannel } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
import type { EmailSender } from "../../adapters/email/types";
import type { WhatsAppGateway } from "../../adapters/whatsapp/types";
import { templates, type TemplateName } from "./templates";

export interface NotifyDeps {
  db: Database;
  queue: QueueClient;
}

export async function notify(
  deps: NotifyDeps,
  userId: string,
  template: TemplateName,
  payload: unknown
): Promise<void> {
  const definition = templates[template];
  const parsedPayload = definition.payloadSchema.parse(payload);
  const record = await deps.db.notifications.create({ userId, template, payload: parsedPayload });
  await deps.queue.send(
    "notify.send",
    { notificationId: record.id },
    { singletonKey: `notify:${record.id}`, retryLimit: 3, retryBackoff: true }
  );
}

export interface DeliveryDeps {
  db: Database;
  email: EmailSender;
  whatsapp: WhatsAppGateway;
}

export class NotificationNotFoundError extends Error {
  constructor(notificationId: string) {
    super(`Notification ${notificationId} not found`);
    this.name = "NotificationNotFoundError";
  }
}

export async function deliverNotification(deps: DeliveryDeps, notificationId: string): Promise<void> {
  const record = await deps.db.notifications.getById(notificationId);
  if (!record) throw new NotificationNotFoundError(notificationId);

  const user = await deps.db.identity.getUserById(record.userId);
  if (!user) throw new Error(`User ${record.userId} not found for notification ${notificationId}`);

  const definition = templates[record.template as TemplateName];
  const payload = definition.payloadSchema.parse(record.payload);

  let channel: NotificationChannel | null = null;

  if (user.phone) {
    try {
      const hasSession = await deps.whatsapp.hasActiveSession(record.userId);
      if (hasSession) {
        await deps.whatsapp.sendSessionMessage(user.phone, definition.renderWhatsAppText(payload));
        channel = "whatsapp_session";
      }
    } catch {
      // Fall through to the template-message attempt below.
    }

    if (!channel) {
      try {
        await deps.whatsapp.sendTemplateMessage(
          user.phone,
          definition.whatsappTemplateName,
          definition.whatsappParams(payload)
        );
        channel = "whatsapp_template";
      } catch {
        // Fall through to the email fallback below.
      }
    }
  }

  if (!channel) {
    try {
      const rendered = definition.renderEmail(payload);
      await deps.email.send({ to: user.email, subject: rendered.subject, html: rendered.html });
      channel = "email";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.db.notifications.markFailed(notificationId, message);
      throw new Error(`Failed to deliver notification ${notificationId} on any channel: ${message}`);
    }
  }

  await deps.db.notifications.markSent(notificationId, channel, new Date());
}
