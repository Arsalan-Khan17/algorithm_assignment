import clsx from "clsx";

export function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll("_", " ");
  return (
    <span
      className={clsx("badge", {
        "badge-review": status === "needs_review" || status === "pending",
        "badge-success": ["completed", "executed", "auto_executed", "succeeded"].includes(status),
        "badge-danger": ["failed", "conflicted", "rejected"].includes(status),
        "badge-neutral": ["queued", "running", "requested"].includes(status),
      })}
    >
      <span className="badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
