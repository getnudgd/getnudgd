"use client";

interface StarRatingProps {
  value: number | null;
  onChange: (val: number) => void;
}

export function StarRating({ value, onChange }: StarRatingProps) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star-btn ${value === n ? "active" : ""}`}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
