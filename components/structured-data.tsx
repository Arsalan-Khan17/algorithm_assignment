import type { ReactNode } from "react";

const fieldLabels: Record<string, string> = {
  accepted: "Accepted",
  actionType: "Action",
  agentRunId: "Agent run ID",
  amountCents: "Amount",
  currency: "Currency",
  deliveredAt: "Delivered",
  errorCode: "Error code",
  fulfillmentStartedAt: "Fulfilment started",
  id: "Record ID",
  ok: "Succeeded",
  orderId: "Order ID",
  orderNumber: "Order",
  outcome: "Outcome",
  paymentStatus: "Payment status",
  policyCode: "Policy decision",
  reason: "Reason",
  refundedAmountCents: "Already refunded",
  requestedAction: "Requested action",
  reviewTaskId: "Review task ID",
  shippedAt: "Shipped",
  status: "Status",
  summary: "Decision summary",
  turns: "Agent turns",
};

const toolLabels: Record<string, string> = {
  escalate_to_human: "Escalated to a reviewer",
  lookup_order: "Looked up the order",
  propose_refund: "Proposed a refund",
  request_cancellation: "Requested cancellation",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function toolLabel(toolName: string): string {
  return toolLabels[toolName] ?? humanize(toolName);
}

function fieldLabel(key: string): string {
  return fieldLabels[key] ?? humanize(key);
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function dateTime(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function displayScalar(key: string, value: string | number | boolean, currency: string): ReactNode {
  if (typeof value === "boolean") {
    return <span className={value ? "data-positive" : "data-negative"}>{value ? "Yes" : "No"}</span>;
  }

  if (typeof value === "number" && key.toLowerCase().endsWith("cents")) {
    return money(value, currency);
  }

  if (typeof value === "string" && key.toLowerCase().endsWith("at")) {
    const formatted = dateTime(value);
    if (formatted) return formatted;
  }

  if (typeof value === "string" && key.toLowerCase().endsWith("id")) {
    return <span className="data-code">{value}</span>;
  }

  if (
    typeof value === "string" &&
    ["actionType", "outcome", "paymentStatus", "requestedAction", "status"].includes(key)
  ) {
    return <span className="data-emphasis">{humanize(value)}</span>;
  }

  return String(value);
}

function displayValue(key: string, value: unknown, currency: string): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="data-muted">Not provided</span>;
  }

  if (Array.isArray(value)) {
    if (!value.length) return <span className="data-muted">None</span>;
    return (
      <ul className="data-array">
        {value.map((item, index) => (
          <li key={`${key}-${index}`}>
            {isRecord(item) ? <StructuredData data={item} currency={currency} nested /> : String(item)}
          </li>
        ))}
      </ul>
    );
  }

  if (isRecord(value)) {
    return <StructuredData data={value} currency={currency} nested />;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    return displayScalar(key, value as string | number | boolean, currency);
  }

  return <span className="data-muted">Unavailable</span>;
}

export function StructuredData({
  data,
  currency = "USD",
  nested = false,
}: {
  data: Record<string, unknown> | null | undefined;
  currency?: string | null;
  nested?: boolean;
}) {
  const entries = Object.entries(data ?? {});
  const effectiveCurrency =
    typeof data?.currency === "string" ? data.currency : currency || "USD";

  if (!entries.length) {
    return <p className="data-empty">No details recorded.</p>;
  }

  return (
    <dl className={nested ? "data-list data-list-nested" : "data-list"}>
      {entries.map(([key, value]) => (
        <div className={isRecord(value) ? "data-row data-row-group" : "data-row"} key={key}>
          <dt>{fieldLabel(key)}</dt>
          <dd>{displayValue(key, value, effectiveCurrency)}</dd>
        </div>
      ))}
    </dl>
  );
}
