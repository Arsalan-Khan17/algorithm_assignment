import clsx from "clsx";

export function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll("_", " ");
  return (
    <span
      className={clsx("badge", {
        "badge-review": ["needs_review", "needs_information", "pending"].includes(status),
        "badge-success": ["completed", "executed", "auto_executed", "succeeded"].includes(status),
        "badge-danger": ["failed", "conflicted", "rejected", "refused"].includes(status),
        "badge-neutral": ["queued", "running", "requested"].includes(status),
      })}
    >
      <span className="badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
