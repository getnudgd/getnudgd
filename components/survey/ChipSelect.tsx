"use client";

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
  function handleClick(value: string) {
    if (multi) {
      const current = Array.isArray(selected) ? selected : [];
      if (current.includes(value)) {
        onChange(current.filter((v) => v !== value));
      } else {
        onChange([...current, value]);
      }
    } else {
      onChange(value);
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
          onClick={() => handleClick(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
