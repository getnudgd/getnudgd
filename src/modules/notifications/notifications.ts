import type { Database, NotificationChannel } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
import type { EmailSender } from "../../adapters/email/types";
import type { WhatsAppGateway } from "../../adapters/whatsapp/types";
import { templates, type TemplateDefinition, type TemplateName } from "./templates";

export interface NotifyDeps {
  db: Database;
  queue: QueueClient;
}

export async function notify(
  deps: NotifyDeps,
  userId: string,
  template: TemplateName,
  payload: unknown,
  eventKey: string
): Promise<void> {
  const definition = templates[template];
  const parsedPayload = definition.payloadSchema.parse(payload);
  const { record, created } = await deps.db.notifications.create({
    userId,
    template,
    payload: parsedPayload,
    idempotencyKey: `${eventKey}:${template}:${userId}`,
  });
  // A replayed event (e.g. a racing second caller of the same transition) finds
  // the row already exists; it must not enqueue a second delivery. A row whose
  // first enqueue failed stays `pending` and is re-enqueued by
  // sweepPendingNotifications once it is older than PENDING_SWEEP_AGE_MS.
  if (!created) return;
  await enqueueDelivery(deps.queue, record.id);
}

export const PENDING_SWEEP_AGE_MS = 30 * 60 * 1000;
export const PENDING_SWEEP_BATCH = 100;

// NOTE: the queue uses pg-boss's default "standard" policy, under which singletonKey is NOT a dedup
// constraint (see queue.ts SendOptions). Double delivery is currently prevented only by a single worker
// running one job at a time plus deliverNotification's status === "sent" guard. Before adding worker
// concurrency or a second worker, add a real claim (atomic UPDATE ... SET status='sending' WHERE
// status IN ('pending','failed') RETURNING) or a deduplicating queue policy.
async function enqueueDelivery(queue: QueueClient, notificationId: string): Promise<void> {
  await queue.send(
    "notify.send",
    { notificationId },
    { singletonKey: `notify:${notificationId}`, retryLimit: 3, retryBackoff: true }
  );
}

// Re-enqueues delivery for rows still `pending` after PENDING_SWEEP_AGE_MS: the
// row was written but queue.send failed (or the job was lost). Safe to run
// repeatedly: deliverNotification skips rows that are already `sent`, and the
// age gate keeps this away from rows whose first job is still running/retrying.
export async function sweepPendingNotifications(deps: NotifyDeps, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_SWEEP_AGE_MS);
  const stale = await deps.db.notifications.listPendingOlderThan(cutoff, PENDING_SWEEP_BATCH);
  let requeued = 0;
  for (const record of stale) {
    try {
      await enqueueDelivery(deps.queue, record.id);
      requeued++;
    } catch (err) {
      console.error(`[notifications] failed to re-enqueue pending notification ${record.id}`, err);
    }
  }
  return requeued;
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function deliverNotification(deps: DeliveryDeps, notificationId: string): Promise<void> {
  const record = await deps.db.notifications.getById(notificationId);
  if (!record) throw new NotificationNotFoundError(notificationId);
  if (record.status === "sent") return;

  // Failures below are deterministic: retrying cannot fix them, so record the
  // reason on the row and return instead of letting pg-boss retry forever.
  const failPermanently = async (reason: string): Promise<void> => {
    console.error(`[notifications] ${reason}`);
    await deps.db.notifications.markFailed(notificationId, reason);
  };

  const user = await deps.db.identity.getUserById(record.userId);
  if (!user) {
    await failPermanently(`User ${record.userId} not found for notification ${notificationId}`);
    return;
  }

  const definition: TemplateDefinition | undefined = templates[record.template as TemplateName];
  if (!definition) {
    await failPermanently(`Unknown template "${record.template}" on notification ${notificationId}`);
    return;
  }
  const parsed = definition.payloadSchema.safeParse(record.payload);
  if (!parsed.success) {
    await failPermanently(
      `Stored payload no longer matches template "${record.template}" on notification ${notificationId}: ${parsed.error.message}`
    );
    return;
  }
  const payload = parsed.data;

  let channel: NotificationChannel | null = null;
  const attempts: string[] = [];

  if (user.phone) {
    try {
      const hasSession = await deps.whatsapp.hasActiveSession(record.userId);
      if (hasSession) {
        await deps.whatsapp.sendSessionMessage(user.phone, definition.renderWhatsAppText(payload));
        channel = "whatsapp_session";
      }
    } catch (err) {
      attempts.push(`whatsapp_session: ${errorMessage(err)}`);
    }

    if (!channel) {
      try {
        await deps.whatsapp.sendTemplateMessage(
          user.phone,
          definition.whatsappTemplateName,
          definition.whatsappParams(payload)
        );
        channel = "whatsapp_template";
      } catch (err) {
        attempts.push(`whatsapp_template: ${errorMessage(err)}`);
      }
    }
  }

  if (!channel) {
    try {
      const rendered = definition.renderEmail(payload);
      await deps.email.send({ to: user.email, subject: rendered.subject, html: rendered.html });
      channel = "email";
    } catch (err) {
      const message = [...attempts, `email: ${errorMessage(err)}`].join("; ");
      await deps.db.notifications.markFailed(notificationId, message);
      throw new Error(`Failed to deliver notification ${notificationId} on any channel: ${message}`);
    }
  }

  await deps.db.notifications.markSent(notificationId, channel, new Date());
}
