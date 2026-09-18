import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error = false, className, ...rest }: InputProps) {
  const classes = ["ui-input", error ? "error" : "", className].filter(Boolean).join(" ");
  return <input className={classes} {...rest} />;
}
