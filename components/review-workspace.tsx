"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { getReviewDetail, listDemoIdentities } from "@/src/repositories/support-repository";
import type { Serialized } from "@/src/types/serialized";
import { StatusBadge } from "./status-badge";

type ReviewDetail = NonNullable<Serialized<Awaited<ReturnType<typeof getReviewDetail>>>>;
type Reviewer = Serialized<Awaited<ReturnType<typeof listDemoIdentities>>>["reviewers"][number];

function money(cents: number | null, currency: string | null) {
  if (cents === null || !currency) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

export function ReviewWorkspace({ initialDetail, reviewers }: { initialDetail: ReviewDetail; reviewers: Reviewer[] }) {
  const [detail, setDetail] = useState(initialDetail);
  const [reviewerId, setReviewerId] = useState(reviewers[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/reviews/${detail.review.id}`, { cache: "no-store" });
    if (response.ok) setDetail((await response.json()) as ReviewDetail);
  }, [detail.review.id]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const checks = useMemo(() => {
    const request = detail.request;
    const proposal = detail.review.proposedPayload as { amountCents?: number };
    return [
      { label: "Customer owns linked order", pass: Boolean(request.customerId && request.orderId) },
      {
        label:
          detail.review.actionType === "refund"
            ? "Order is not already refunded or cancelled"
            : "Order has not shipped",
        pass:
          detail.review.actionType === "refund"
            ? !["refunded", "cancelled"].includes(request.orderStatus ?? "")
            : !request.shippedAt && !["shipped", "delivered"].includes(request.orderStatus ?? ""),
      },
      {
        label: "Payment is eligible",
        pass:
          detail.review.actionType === "refund"
            ? request.paymentStatus === "captured" && request.refundedAmountCents === 0
            : ["authorized", "captured"].includes(request.paymentStatus ?? ""),
      },
      {
        label: "Proposed amount is within captured funds",
        pass:
          detail.review.actionType !== "refund" ||
          (typeof proposal.amountCents === "number" &&
            request.amountCents !== null &&
            proposal.amountCents <= request.amountCents - (request.refundedAmountCents ?? 0)),
      },
    ];
  }, [detail]);

  async function decide(decision: "approve" | "reject") {
    setWorking(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/reviews/${detail.review.id}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewerId, expectedVersion: detail.review.version, note: note || undefined }),
      });
      if (response.status === 409) {
        await refresh();
        setNotice("This review changed in another session. The latest authoritative state is now shown.");
        return;
      }
      const body = (await response.json()) as ReviewDetail | { error?: { message: string } };
      if (!response.ok) {
        throw new Error("error" in body ? body.error?.message : "Decision failed.");
      }
      setDetail(body as ReviewDetail);
      setNotice(decision === "approve" ? "Action committed successfully." : "Proposal rejected.");
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Decision failed.");
    } finally {
      setWorking(false);
    }
  }

  const proposed = detail.review.proposedPayload as Record<string, unknown>;
  const finalRun = detail.agentRuns[0];
  const displayedChecks =
    detail.review.status === "pending"
      ? checks
      : [
          { label: "Exactly one action execution recorded", pass: detail.executions.length === 1 },
          {
            label: "Committed state matches the approved action",
            pass:
              detail.review.actionType === "refund"
                ? detail.request.paymentStatus === "refunded"
                : detail.review.actionType === "cancel"
                  ? detail.request.orderStatus === "cancelled"
                  : detail.review.status === "rejected",
          },
          { label: "No duplicate refund exists", pass: detail.refunds.length <= 1 },
        ];

  return (
    <>
      <div className="breadcrumb"><Link href="/">Queue</Link><span>/</span><span>Review</span></div>
      <header className="review-header">
        <div>
          <p className="eyebrow">Human approval boundary</p>
          <h1>{detail.review.actionType.replaceAll("_", " ")} request</h1>
          <p className="lede">Order #{detail.request.orderNumber ?? "unlinked"} · {detail.request.customerName}</p>
        </div>
        <StatusBadge status={detail.review.status} />
      </header>

      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <div className="review-grid">
        <div className="review-main">
          <section className="panel">
            <p className="eyebrow">Customer request</p>
            <blockquote>{detail.request.message}</blockquote>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div><p className="eyebrow">Agent decision</p><h2>Why this reached you</h2></div>
              {finalRun ? <StatusBadge status={finalRun.status} /> : null}
            </div>
            <p>{detail.review.rationale}</p>
            <div className="reason-box"><strong>Escalation reason</strong><span>{detail.review.escalationReason}</span></div>
            {finalRun?.finalDecision && "summary" in finalRun.finalDecision ? (
              <p className="helper-text">Agent summary: {String(finalRun.finalDecision.summary)}</p>
            ) : null}
          </section>

          <section className="panel">
            <p className="eyebrow">Current facts</p>
            <h2>Order and payment</h2>
            <dl className="facts-grid">
              <div><dt>Order state</dt><dd>{detail.request.orderStatus ?? "—"}</dd></div>
              <div><dt>Payment state</dt><dd>{detail.request.paymentStatus ?? "—"}</dd></div>
              <div><dt>Captured</dt><dd>{money(detail.request.amountCents, detail.request.currency)}</dd></div>
              <div><dt>Already refunded</dt><dd>{money(detail.request.refundedAmountCents, detail.request.currency)}</dd></div>
              <div><dt>Fulfilment started</dt><dd>{formatDate(detail.request.fulfillmentStartedAt)}</dd></div>
              <div><dt>Shipped</dt><dd>{formatDate(detail.request.shippedAt)}</dd></div>
            </dl>
          </section>

          <section className="panel">
            <p className="eyebrow">Audit trace</p>
            <h2>Agent tool calls</h2>
            <ol className="trace-list">
              {detail.toolCalls.map((call) => (
                <li key={call.id}>
                  <div><strong>{call.sequence}. {call.toolName}</strong><StatusBadge status={call.status} /></div>
                  <code>{JSON.stringify(call.arguments)}</code>
                </li>
              ))}
              {!detail.toolCalls.length ? <li>No tool calls were completed.</li> : null}
            </ol>
          </section>
        </div>

        <aside className="review-sidebar">
          <section className="panel sticky-panel">
            <p className="eyebrow">Proposed action</p>
            <h2>{detail.review.actionType.replaceAll("_", " ")}</h2>
            <pre className="proposal">{JSON.stringify(proposed, null, 2)}</pre>

            <h3>{detail.review.status === "pending" ? "Live guardrails" : "Post-decision verification"}</h3>
            <ul className="check-list">
              {displayedChecks.map((check) => (
                <li key={check.label} className={check.pass ? "check-pass" : "check-fail"}>
                  <span aria-hidden="true">{check.pass ? "✓" : "×"}</span>{check.label}
                </li>
              ))}
            </ul>

            {detail.review.status === "pending" ? (
              <div className="decision-form">
                <label>Reviewer<select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}>
                  {reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.name}</option>)}
                </select></label>
                <label>Decision note<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} /></label>
                <div className="button-row">
                  <button className="button button-danger" disabled={working} onClick={() => void decide("reject")}>Reject</button>
                  <button className="button button-primary" disabled={working || checks.some((check) => !check.pass)} onClick={() => void decide("approve")}>
                    {working ? "Committing…" : "Approve & execute"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="decision-complete">
                <strong>Decision recorded</strong>
                <span>{detail.decidedBy?.name ?? "Reviewer"} · {formatDate(detail.review.decidedAt)}</span>
                {detail.review.decisionNote ? <span>{detail.review.decisionNote}</span> : null}
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
