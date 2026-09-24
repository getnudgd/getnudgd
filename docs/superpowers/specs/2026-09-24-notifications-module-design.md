# Notifications module — design spec

**Status:** approved for planning
**Implements:** AGENTS.md §3.2 (`notifications` module row), §3.4 (`notify.send` job row), §3.11 Phase 1 backlog item "email notifications" (the item after Timers)

## Summary

A `notifications` module that lets any request-transition call `notify(userId, template, payload)`, which durably records the notification and delivers it through a channel-selection tree: an active WhatsApp session, else a WhatsApp template message, else — since neither a real WhatsApp gateway nor a delivery-confirmation webhook exists yet — an immediate email fallback. WhatsApp is fully designed and stubbed behind an adapter interface with a fake; nothing sends a real WhatsApp message in this plan. Real WhatsApp (Meta Cloud API via Gupshup) is Phase 2/3 work per AGENTS.md's own backlog and slots in later by implementing `WhatsAppGateway.real.ts` — no interface change needed.

## Scope

**Trigger events (5), chosen as "core outcomes a human is waiting on"** — not AGENTS.md's literal "any transition," which would include internal-only events (e.g. `sendRequest`) nobody needs a push for:

| Event | Recipient(s) | Template(s) |
|---|---|---|
| `accept` | Seeker | `request.accepted` |
| `decline` | Seeker | `request.declined` |
| `expire` | Seeker | `request.expired` |
| `reviewProof` verify | Insider, Seeker | `proof.verified` (both), differently worded per audience via payload |
| `reviewProof` reject | Insider | `proof.rejected` |

**Explicitly out of scope for this plan:**
- Real WhatsApp adapter (`WhatsAppGateway.real.ts`) — Phase 2/3.
- The 15-minute delivery-confirmation-based email fallback AGENTS.md's jobs table describes — there is no webhook yet to observe WhatsApp delivery vs non-delivery, so this plan falls back to email immediately on any WhatsApp send failure. The literal 15-minute-wait version is real Phase 3 work once `/api/webhooks/whatsapp` exists.
- Any other request-transition trigger (`sendRequest`, `submitProof`, `cancel`) — can be added later as one-line additions once this pattern exists, since each is just another `notify(...)` call site.
- Admin UI for inspecting failed notifications (`/admin/jobs`-adjacent) — not built here.
- `insider.reverify`/`insider.weeklyReset`-triggered notifications — those jobs don't exist yet.

## Architecture

Two-phase design, mirroring the `request.expire` pattern from the Phase 1 Timers plan:

**Phase 1 — enqueue (synchronous, called from `requests.ts`/`admin.ts`):**
```ts
notify(deps: NotifyDeps, userId: string, template: TemplateName, payload: unknown): Promise<void>
// NotifyDeps = { db: Database; queue: QueueClient }
```
Validates `payload` against the named template's Zod schema (a caller bug — wrong shape — throws synchronously, not silently swallowed), inserts a `notifications` row (`status: "pending"`), enqueues a `notify.send` job with `{ notificationId }`, singleton key `notify:{notificationId}`, and retry options (`retryLimit`, `retryBackoff` — see QueueClient extension below). Returns once enqueued; does not wait for delivery.

Called from `requests.ts`'s `accept`/`decline`/`expire` and `admin.ts`'s `reviewProof`, immediately after each function's own state-transition DB write, each call independently wrapped in try/catch (logged, not rethrown) — exactly the pattern the Timers final review hardened for `request.expire`'s enqueue. A notification-pipeline failure must never fail the underlying business mutation.

**Phase 2 — delivery (async, run by the worker):**
```ts
deliverNotification(deps: DeliveryDeps, notificationId: string): Promise<void>
// DeliveryDeps = { db: Database; email: EmailSender; whatsapp: WhatsAppGateway }
```
Called only by the `notify.send` job handler in `worker.ts`. Loads the notification row and the recipient's `{ email, phone }` (a new nullable `phone` column on `users` — see Data Model). Runs the channel-selection tree:

1. `phone` is null → skip to step 4 (email).
2. `whatsapp.hasActiveSession(userId)` → true: `whatsapp.sendSessionMessage(phone, renderedBody)`. Success → mark `sent`, channel `whatsapp_session`, done.
3. No active session, or step 2 threw → `whatsapp.sendTemplateMessage(phone, templateName, params)`. Success → mark `sent`, channel `whatsapp_template`, done.
4. Every WhatsApp attempt unavailable/failed (or no phone) → `email.send(...)`. Success → mark `sent`, channel `email`, done. Failure → mark `failed` with `error`, rethrow so pg-boss's `retryLimit`/`retryBackoff` (set at enqueue time) retries the whole job.

`NotifyDeps` and `DeliveryDeps` are deliberately separate types with no vendor overlap — `RequestsDeps`/`AdminDeps` (which construct `NotifyDeps`) never need `email`/`whatsapp`; only `worker.ts` constructs `DeliveryDeps`.

## Data Model

**New table `notifications`:**
```
id            uuid primary key
user_id       uuid not null references users(id)
template      text not null
payload       jsonb not null
status        text not null default 'pending'   -- check in ('pending','sent','failed')
channel       text                                -- nullable; check in ('whatsapp_session','whatsapp_template','email') once set
delivered_at  timestamptz
error         text
created_at    timestamptz not null default now()
```

**New column:** `users.phone` — nullable `text`. Nothing collects it yet (no signup/onboarding field exists for it); this plan only adds the column and the `null`-means-"skip WhatsApp" handling. Populating it is future onboarding-UI work, not in scope here.

**`Database` interface additions:**
- `identity.getSeekerProfileById(seekerProfileId): Promise<SeekerProfileRecord | null>` — mirrors the existing `getInsiderProfileById`; needed to resolve `seekerProfileId → userId` at the 4 "notify Seeker" call sites (`accept`/`decline`/`expire`/`reviewProof`-verify).
- `notifications.create(input): Promise<NotificationRecord>`, `notifications.getById(id): Promise<NotificationRecord | null>`, `notifications.markSent(id, channel, deliveredAt): Promise<void>`, `notifications.markFailed(id, error): Promise<void>`.

## Adapter: `WhatsAppGateway`

`src/adapters/whatsapp/types.ts` (interface) + `src/adapters/whatsapp/fake.ts` (configurable fake). No `real.ts` in this plan.

```ts
export interface WhatsAppGateway {
  hasActiveSession(userId: string): Promise<boolean>;
  sendSessionMessage(to: string, body: string): Promise<{ id: string }>;
  sendTemplateMessage(to: string, templateName: string, params: Record<string, string>): Promise<{ id: string }>;
}
```

The fake is configurable per-test: seed which `userId`s have an active session, and force either send method to succeed or throw for a given call — so all three channel-tree branches (session message, template message, email fallback) are exercised deterministically by tests, not left uncovered until Phase 2/3.

## Template Registry

`src/modules/notifications/templates.ts` — `Record<TemplateName, TemplateDefinition>`. Each definition: a Zod payload schema, an email renderer (subject + HTML, using `src/config/brand.ts` and this project's locked vocabulary — never "referral"/"refer"), and a WhatsApp template name + param mapping (declared now, unused until Phase 2/3's real gateway exists, so that work doesn't need to touch this file).

Five templates: `request.accepted`, `request.declined`, `request.expired`, `proof.verified`, `proof.rejected`. `proof.verified` is used for both the Insider (points-earned framing) and Seeker (submitted framing) sends, with different payload fields driving different copy — not two separate templates, since the underlying event and Zod-validated core fields (requestId, company) are the same.

## Queue Extension

`QueueClient.SendOptions` (in `src/jobs/queue.ts`) gains `retryLimit?: number` and `retryBackoff?: boolean`, mapped through in `queue.real.ts` to pg-boss's native `send()` options — the exact mechanism the Timers plan used to add `singletonKey`/`startAfterSeconds`. Satisfies AGENTS.md §3.4's "retries with backoff" for `notify.send` without any custom retry logic in the handler itself.

## Error Handling

- **Enqueue-phase** (`notify()` itself, including Zod validation failures and `queue.send` failures): caught by the caller, logged via `console.error`, never propagated to the caller's own return value.
- **Delivery-phase, per-channel**: a WhatsApp attempt throwing is caught internally and treated as "fall through to the next channel," not a job failure.
- **Delivery-phase, total failure**: only when every channel (including email) fails does `deliverNotification` mark the row `failed` and rethrow, letting pg-boss's own retry/backoff handle re-attempts.

## Testing

- `notifications.test.ts`: `notify()` happy path (row created, correct singleton key/payload enqueued); payload-validation-rejection (throws synchronously, no row created); queue-failure-does-not-throw (mirrors the `sendRequest`-when-`queue.send`-throws precedent).
- `deliverNotification` tests: active-session success; no-session-falls-to-template success; no-phone-on-file skips straight to email; all-WhatsApp-fails-falls-to-email success; everything-fails marks `failed` and rethrows.
- `templates.test.ts`: each of the 5 templates renders valid output from a valid payload and rejects an invalid one via its Zod schema.
- `requests.test.ts`/`admin.test.ts`: one test per call site (5 total) confirming `notify()` was invoked with the right template/recipient, via a spy — not re-testing `notify()`'s internals.

## Open items carried to the plan (not decided here, decide during planning/implementation)

- Exact migration numbering and whether `users.phone` and the `notifications` table land in one migration or two (mechanical, decide when writing the plan against the current migration head).
- Exact email copy per template (must use locked vocabulary + `brand.ts`, functional-but-real copy — not placeholder Lorem Ipsum, not founder-review-gated since this is transactional, not marketing, copy).
