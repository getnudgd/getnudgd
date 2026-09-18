export function ErrorState({ title, onRetry }: { title: string; onRetry?: () => void }) {
  return (
    <div className="ui-error-state" role="alert">
      <h3>{title}</h3>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
