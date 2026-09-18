export interface TimelineStep {
  label: string;
  at?: Date;
  complete: boolean;
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="ui-timeline">
      {steps.map((step) => (
        <li key={step.label} className={step.complete ? "ui-timeline-step complete" : "ui-timeline-step"}>
          <span className="ui-timeline-dot" aria-hidden="true" />
          <span className="ui-timeline-label">{step.label}</span>
          {step.at && <time className="ui-timeline-time">{step.at.toLocaleString("en-IN")}</time>}
        </li>
      ))}
    </ol>
  );
}
