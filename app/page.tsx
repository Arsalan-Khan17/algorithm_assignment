import { SupportConsole } from "@/components/support-console";
import { listDemoIdentities, listSupportRequests } from "@/src/repositories/support-repository";
import { serialize } from "@/src/types/serialized";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [requests, identities] = await Promise.all([listSupportRequests(), listDemoIdentities()]);

  return (
    <main className="shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Support operations</p>
          <h1>Decision queue</h1>
          <p className="lede">AI-assisted triage with human-controlled financial actions.</p>
        </div>
        <span className="status-pill">Guardrails enforced in code</span>
      </header>
      <SupportConsole initialRequests={serialize(requests)} identities={serialize(identities)} />
    </main>
  );
}
