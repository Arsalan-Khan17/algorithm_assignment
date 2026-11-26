import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link className="product-mark" href="/" aria-label="Support operations queue">
          <span className="product-glyph" aria-hidden="true">
            <ShieldCheck size={18} strokeWidth={1.7} />
          </span>
          <span className="product-name">Support operations</span>
          <span className="product-context">Decision control</span>
        </Link>
        <div className="enforcement-state">
          <span className="enforcement-dot" aria-hidden="true" />
          Policy enforcement active
        </div>
      </div>
    </header>
  );
}
