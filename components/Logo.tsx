import Image from "next/image";

const heights: Record<string, number> = { sm: 20, md: 24, lg: 32 };
const widths: Record<string, number> = { sm: 100, md: 120, lg: 160 };

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <Image
      src="/logo-light.png"
      alt="getnudgd"
      height={heights[size]}
      width={widths[size]}
      style={{ objectFit: "contain" }}
    />
  );
}
