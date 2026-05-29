export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-3xl",
  };
  return (
    <span className={`font-display tracking-tight ${sizes[size]}`}>
      <span className="wl-brand-get">get</span>
      <span className="wl-brand-nudgd">nudgd</span>
    </span>
  );
}
