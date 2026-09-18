export interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

export function Stepper({ value, min = 0, max = Infinity, step = 1, onChange }: StepperProps) {
  return (
    <div className="ui-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label="Decrease">
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label="Increase">
        +
      </button>
    </div>
  );
}
