"use client";
import { useEffect, type ReactNode } from "react";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-sheet-overlay" role="presentation" onClick={onClose}>
      <div className="ui-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ui-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="ui-sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ui-sheet-body">{children}</div>
      </div>
    </div>
  );
}
