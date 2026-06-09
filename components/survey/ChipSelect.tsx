"use client";

import { useRef, useState } from "react";

interface Option {
  value: string;
  label: string;
}

interface ChipSelectProps {
  options: Option[];
  selected: string | string[];
  multi?: boolean;
  onChange: (val: string | string[]) => void;
}

export function ChipSelect({ options, selected, multi = false, onChange }: ChipSelectProps) {
  const [justDeselected, setJustDeselected] = useState<Set<string>>(new Set());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function markDeselected(value: string) {
    setJustDeselected((prev) => new Set([...prev, value]));
    if (timers.current[value]) clearTimeout(timers.current[value]);
    timers.current[value] = setTimeout(() => {
      setJustDeselected((prev) => {
        const next = new Set(prev);
        next.delete(value);
        return next;
      });
    }, 400);
  }

  function handleClick(value: string) {
    if (multi) {
      const current = Array.isArray(selected) ? selected : [];
      if (current.includes(value)) {
        onChange(current.filter((v) => v !== value));
        markDeselected(value);
      } else {
        onChange([...current, value]);
      }
    } else {
      if (selected === value) {
        onChange("");
        markDeselected(value);
      } else {
        onChange(value);
      }
    }
  }

  function isSelected(value: string) {
    if (Array.isArray(selected)) return selected.includes(value);
    return selected === value;
  }

  return (
    <div className="chips" data-multi={multi ? "true" : undefined}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`chip ${isSelected(opt.value) ? "selected" : ""}`}
          data-just-deselected={justDeselected.has(opt.value) ? "" : undefined}
          onClick={() => handleClick(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
