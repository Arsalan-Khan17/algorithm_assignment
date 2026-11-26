import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { StatusBadge } from "@/components/status-badge";
import { StructuredData, toolLabel } from "@/components/structured-data";
import { getSupportRequestDetail } from "@/src/repositories/support-repository";

export const dynamic = "force-dynamic";

export default async function RequestTracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const detail = await getSupportRequestDetail(id);
  if (!detail) notFound();

  return (
    <main className="shell narrow-shell">
      <div className="breadcrumb"><Link href="/">Queue</Link><span>/</span><span>Request trace</span></div>
      <header className="review-header">
        <div><p className="eyebrow">Support request</p><h1>{detail.request.customerName}</h1><p className="lede">{detail.request.message}</p></div>
        <StatusBadge status={detail.request.status} />
      </header>
      <section className="panel">
        <p className="eyebrow">Final outcome</p>
        <h2>{detail.request.outcomeSummary ?? "Processing"}</h2>
        <p>Order {detail.request.orderNumber ? `#${detail.request.orderNumber}` : "not linked"} · {detail.request.orderStatus ?? "unknown state"}</p>
      </section>
      <section className="panel">
        <p className="eyebrow">Agent runs</p>
        <ol className="trace-list">
          {detail.agentRuns.map((run) => (
            <li key={run.id}>
              <div><strong>{run.model}</strong><StatusBadge status={run.status} /></div>
              {run.errorMessage ? <p className="trace-error">{run.errorMessage}</p> : null}
              {run.finalDecision ? (
                <StructuredData data={run.finalDecision} currency={detail.request.currency} />
              ) : null}
            </li>
          ))}
          {!detail.agentRuns.length ? <li>No agent run has been recorded yet.</li> : null}
        </ol>
      </section>
      <section className="panel">
        <p className="eyebrow">Tool calls</p>
        <ol className="trace-list">
          {detail.toolCalls.map((call) => (
            <li key={call.id}>
              <div><strong>{call.sequence}. {toolLabel(call.toolName)}</strong><StatusBadge status={call.status} /></div>
              <div className="trace-detail">
                <div className="trace-block">
                  <span className="trace-block-label">Tool input</span>
                  <StructuredData data={call.arguments} currency={detail.request.currency} nested />
                </div>
                {call.result ? (
                  <div className="trace-block">
                    <span className="trace-block-label">Tool result</span>
                    <StructuredData data={call.result} currency={detail.request.currency} nested />
                  </div>
                ) : null}
              </div>
              {call.errorMessage ? <p className="trace-error">{call.errorMessage}</p> : null}
            </li>
          ))}
          {!detail.toolCalls.length ? <li>No tool calls have been recorded yet.</li> : null}
        </ol>
      </section>
    </main>
  );
}
