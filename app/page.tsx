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
          <p className="section-label">Decision control</p>
          <h1>Support decisions</h1>
          <p className="lede">
            Review agent outcomes and keep financial actions under human control.
          </p>
        </div>
      </header>
      <SupportConsole initialRequests={serialize(requests)} identities={serialize(identities)} />
    </main>
  );
}
