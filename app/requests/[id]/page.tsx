import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, CheckCircle2, Wrench } from "lucide-react";
import { z } from "zod";
import { StatusBadge } from "@/components/status-badge";
import { StructuredData, toolLabel } from "@/components/structured-data";
import { getSupportRequestDetail } from "@/src/repositories/support-repository";
import { conciseDecisionSummary } from "@/src/presentation/decision-summary";

export const dynamic = "force-dynamic";

export default async function RequestTracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const detail = await getSupportRequestDetail(id);
  if (!detail) notFound();

  return (
    <main className="shell detail-shell">
      <div className="breadcrumb">
        <Link href="/"><ArrowLeft size={14} strokeWidth={1.7} aria-hidden="true" />Queue</Link>
        <span>/</span>
        <span>Request trace</span>
      </div>

      <header className="detail-header">
        <div>
          <p className="section-label">Support request</p>
          <h1>{detail.request.customerName}</h1>
          <p className="lede detail-request-copy">“{detail.request.message}”</p>
        </div>
        <StatusBadge status={detail.request.status} />
      </header>

      <div className="evidence-flow">
        <section className="panel evidence-step outcome-panel">
          <span className="evidence-node evidence-node-success" aria-hidden="true">
            <CheckCircle2 size={17} strokeWidth={1.8} />
          </span>
          <div className="panel-heading">
            <div>
              <p className="section-label">Final outcome</p>
              <h2>{conciseDecisionSummary(detail.request.outcomeSummary, "Processing")}</h2>
            </div>
          </div>
          <div className="outcome-meta">
            <span>Order {detail.request.orderNumber ? `#${detail.request.orderNumber}` : "not linked"}</span>
            <span aria-hidden="true">·</span>
            <span>{detail.request.orderStatus ?? "Unknown state"}</span>
          </div>
        </section>

        <section className="panel evidence-step">
          <span className="evidence-node" aria-hidden="true">
            <Bot size={17} strokeWidth={1.7} />
          </span>
          <div className="panel-heading">
            <div>
              <p className="section-label">Agent runs</p>
              <h2>Model decision</h2>
            </div>
            <span className="panel-count">{detail.agentRuns.length}</span>
          </div>
          <ol className="trace-list">
            {detail.agentRuns.map((run) => (
              <li key={run.id}>
                <div className="trace-item-heading"><strong>{run.model}</strong><StatusBadge status={run.status} /></div>
                {run.errorMessage ? <p className="trace-error">{run.errorMessage}</p> : null}
                {run.finalDecision ? (
                  <StructuredData
                    data={{
                      summary: conciseDecisionSummary(run.finalDecision.summary),
                      turns: run.finalDecision.turns,
                    }}
                    currency={detail.request.currency}
                  />
                ) : null}
              </li>
            ))}
            {!detail.agentRuns.length ? <li className="empty-record">No agent run was required for this seeded record</li> : null}
          </ol>
        </section>

        <section className="panel evidence-step">
          <span className="evidence-node" aria-hidden="true">
            <Wrench size={17} strokeWidth={1.7} />
          </span>
          <div className="panel-heading">
            <div>
              <p className="section-label">Tool calls</p>
              <h2>Verified evidence</h2>
            </div>
            <span className="panel-count">{detail.toolCalls.length}</span>
          </div>
          <ol className="trace-list">
            {detail.toolCalls.map((call) => (
              <li key={call.id}>
                <div className="trace-item-heading"><strong>{call.sequence}. {toolLabel(call.toolName)}</strong><StatusBadge status={call.status} /></div>
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
            {!detail.toolCalls.length ? <li className="empty-record">No tool calls were required for this seeded record</li> : null}
          </ol>
        </section>
      </div>
    </main>
  );
}
