import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url(),
  BRAND_NAME: z.string().min(1),
  BRAND_DOMAIN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ADAPTERS: z.enum(["fake", "real"]).default("fake"),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional(),

  GCS_BUCKET_RESUMES: z.string().optional(),
  GCS_BUCKET_PROOFS: z.string().optional(),
  GCS_BUCKET_PUBLIC: z.string().optional(),

  GOTENBERG_URL: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  PROMPT_VERSION: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  WHATSAPP_BSP_API_KEY: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  BREVO_API_KEY: z.string().optional(),
  BREVO_LIST_ID: z.string().optional(),

  GIFTCARD_VENDOR: z.enum(["manual", "xoxoday", "qwikcilver"]).default("manual"),
  GIFTCARD_API_KEY: z.string().optional(),

  SESSION_COOKIE_SECRET: z.string().min(32, "SESSION_COOKIE_SECRET must be at least 32 characters"),
  SENTRY_DSN: z.string().optional(),
  ADMIN_IP_ALLOWLIST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clears the module-level cache so tests can mutate process.env between cases. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}
