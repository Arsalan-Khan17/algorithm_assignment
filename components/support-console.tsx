"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { listDemoIdentities, listSupportRequests } from "@/src/repositories/support-repository";
import type { Serialized } from "@/src/types/serialized";
import { StatusBadge } from "./status-badge";

type QueueItem = Serialized<Awaited<ReturnType<typeof listSupportRequests>>[number]>;
type Identities = Serialized<Awaited<ReturnType<typeof listDemoIdentities>>>;

const filters = ["all", "needs_review", "auto_executed", "completed", "failed"] as const;

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function SupportConsole({
  initialRequests,
  identities,
}: {
  initialRequests: QueueItem[];
  identities: Identities;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const [customerId, setCustomerId] = useState(identities.customers[0]?.id ?? "");
  const [message, setMessage] = useState("I want a refund for order 1043.");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/support-requests", { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as { requests: QueueItem[] };
      setRequests(data.requests);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleRequests = useMemo(
    () => requests.filter((request) => filter === "all" || request.status === filter),
    [filter, requests],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/support-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId, message }),
      });
      const body = (await response.json()) as { agentError?: string; error?: { message: string } };
      if (!response.ok && response.status !== 202) {
        throw new Error(body.error?.message ?? "Could not create request.");
      }
      setNotice(
        body.agentError
          ? "Request saved and safely escalated because the live agent is not configured yet."
          : "Request processed successfully.",
      );
      await refresh();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Could not create request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="request-composer" aria-labelledby="new-request-title">
        <div>
          <p className="eyebrow">Simulated customer session</p>
          <h2 id="new-request-title">Submit a support request</h2>
          <p className="helper-text">
            Customer identity is trusted server context in production. This selector exists only for the seeded demo.
          </p>
        </div>
        <form onSubmit={submit} className="request-form">
          <label>
            Customer
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
              {identities.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.email}
                </option>
              ))}
            </select>
          </label>
          <label className="grow-field">
            Request
            <input value={message} onChange={(event) => setMessage(event.target.value)} required />
          </label>
          <button className="button button-primary" disabled={submitting || !customerId}>
            {submitting ? "Processing…" : "Send to agent"}
          </button>
        </form>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </section>

      <section aria-labelledby="queue-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live operations</p>
            <h2 id="queue-title">Decision queue</h2>
          </div>
          <nav className="filter-tabs" aria-label="Queue filters">
            {filters.map((item) => (
              <button
                key={item}
                className={filter === item ? "filter-active" : ""}
                onClick={() => setFilter(item)}
              >
                {item.replaceAll("_", " ")}
              </button>
            ))}
          </nav>
        </div>

        {visibleRequests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Order</th>
                  <th>Decision</th>
                  <th>Updated</th>
                  <th><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleRequests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <strong>{request.customerName}</strong>
                      <span className="cell-secondary">{request.message}</span>
                    </td>
                    <td>
                      {request.orderNumber ? `#${request.orderNumber}` : "Not linked"}
                      {request.orderStatus ? <span className="cell-secondary">{request.orderStatus}</span> : null}
                    </td>
                    <td>
                      <StatusBadge status={request.status} />
                      <span className="cell-secondary">
                        {request.escalationReason ?? request.outcomeSummary ?? "Agent processing"}
                      </span>
                    </td>
                    <td>{formatTime(request.updatedAt)}</td>
                    <td className="action-cell">
                      <Link href={request.reviewId ? `/reviews/${request.reviewId}` : `/requests/${request.id}`}>
                        {request.reviewId ? "Review" : "Trace"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No requests in this view</h3>
            <p>Submit a seeded scenario above or choose a different status filter.</p>
          </div>
        )}
      </section>
    </>
  );
}
