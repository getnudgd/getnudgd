"use client";

interface EmojiOption {
  value: string;
  emoji: string;
  label: string;
}

interface EmojiScaleProps {
  options: EmojiOption[];
  value: string;
  onChange: (val: string) => void;
}

export function EmojiScale({ options, value, onChange }: EmojiScaleProps) {
  return (
    <div className="emoji-scale">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`emoji-btn ${value === opt.value ? "active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          <span className="em">{opt.emoji}</span>
          <span className="em-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
