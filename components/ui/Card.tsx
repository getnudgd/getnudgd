import type { ReactNode } from "react";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["ui-card", className].filter(Boolean).join(" ")}>{children}</div>;
}
