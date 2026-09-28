import { z } from "zod";
import type { Database } from "../adapters/db/types";
import type { QueueClient } from "./queue";
import type { EmailSender } from "../adapters/email/types";
import type { WhatsAppGateway } from "../adapters/whatsapp/types";
import { expire, sweepExpiredSent, type RequestsDeps } from "../modules/requests/requests";
import { deliverNotification, sweepPendingNotifications, type DeliveryDeps } from "../modules/notifications/notifications";

export interface WorkerDeps {
  db: Database;
  queue: QueueClient;
  email: EmailSender;
  whatsapp: WhatsAppGateway;
}

const requestExpirePayloadSchema = z.object({ requestId: z.string().min(1) });
const notifySendPayloadSchema = z.object({ notificationId: z.string().min(1) });
const NOTIFICATIONS_SWEEP_CRON = "*/15 * * * *";

export async function startWorker(deps: WorkerDeps): Promise<void> {
  const requestsDeps: RequestsDeps = { db: deps.db, queue: deps.queue };
  const deliveryDeps: DeliveryDeps = { db: deps.db, email: deps.email, whatsapp: deps.whatsapp };

  // Against the real pg-boss client, work()/schedule() call boss.createQueue()
  // internally, which requires the database connection to already be open —
  // only true after start(). start() must run before any work()/schedule()
  // registration below (see the contract note on QueueClient.start()).
  await deps.queue.start();

  await deps.queue.work("request.expire", async (payload) => {
    const { requestId } = requestExpirePayloadSchema.parse(payload);
    await expire(requestsDeps, requestId);
  });

  await deps.queue.work("requests.sweep", async () => {
    await sweepExpiredSent(requestsDeps, new Date());
  });
  await deps.queue.schedule("requests.sweep", "0 * * * *", {});

  // policy: "singleton" pairs with the singletonKey `notify:{id}` set in
  // notifications.ts's enqueueDelivery — whichever process (web sending vs. worker
  // registering here) creates this queue first determines its policy, since
  // pg-boss's createQueue is ON CONFLICT DO NOTHING and cannot be changed later.
  await deps.queue.work(
    "notify.send",
    async (payload) => {
      const { notificationId } = notifySendPayloadSchema.parse(payload);
      await deliverNotification(deliveryDeps, notificationId);
    },
    { policy: "singleton" }
  );

  await deps.queue.work("notifications.sweep", async () => {
    await sweepPendingNotifications({ db: deps.db, queue: deps.queue }, new Date());
  });
  await deps.queue.schedule("notifications.sweep", NOTIFICATIONS_SWEEP_CRON, {});

  console.log(
    "[worker] started with request.expire, requests.sweep, notify.send, and notifications.sweep handlers registered"
  );
}
