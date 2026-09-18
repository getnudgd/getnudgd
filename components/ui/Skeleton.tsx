export function Skeleton({ width = "100%", height = "16px" }: { width?: string; height?: string }) {
  return <div className="ui-skeleton" style={{ width, height }} aria-hidden="true" />;
}
