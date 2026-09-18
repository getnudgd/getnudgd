import type { ReactNode } from "react";

export interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({ selected = false, onClick, children }: ChipProps) {
  return (
    <button type="button" className={`chip${selected ? " selected" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
