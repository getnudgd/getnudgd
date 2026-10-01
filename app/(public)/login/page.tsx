import { notFound } from "next/navigation";
import { getEnv } from "@/src/config/env";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  const env = getEnv();
  if (!env.DEV_LOGIN_ENABLED || env.NODE_ENV === "production") {
    notFound();
  }
  return <LoginForm />;
}
