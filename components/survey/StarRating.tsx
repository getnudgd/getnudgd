"use client";

interface StarRatingProps {
  value: number | null;
  onChange: (val: number) => void;
}

// Order: 5 → 4 → 3 → 2 → 1 (highest first, left to right)
const STARS = [5, 4, 3, 2, 1];

export function StarRating({ value, onChange }: StarRatingProps) {
  return (
    <>
      <div className="stars">
        {STARS.map((n) => (
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
      <div className="rating-labels">
        <span>Every time I apply ✅</span>
        <span>Useless 🙅</span>
      </div>
    </>
  );
}
