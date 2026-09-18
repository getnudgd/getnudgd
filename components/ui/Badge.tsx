import type { ReactNode } from "react";

export interface BadgeProps {
  tone?: "neutral" | "success" | "error" | "primary";
  children: ReactNode;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}
