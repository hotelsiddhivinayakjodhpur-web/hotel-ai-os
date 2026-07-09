import { getConnections } from "@/server/connections/connections.service";
import { ConnectionCard } from "@/components/settings/ConnectionCard";
import { PageHeader, Section, StatCard } from "@/components/ui/primitives";
import type { ConnectionCategory, ConnectionView } from "@/server/connections/types";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER: ConnectionCategory[] = ["Google", "Meta", "Booking", "AI", "Automation", "Infrastructure"];

export default async function SettingsPage() {
  const connections = await getConnections();

  const live = connections.filter((c) => c.status === "CONNECTED").length;
  const pending = connections.filter((c) => c.status === "WAITING" || c.status === "APP_REVIEW").length;
  const disconnected = connections.filter(
    (c) => c.status === "NOT_CONFIGURED" || c.status === "DISCONNECTED",
  ).length;
  const errored = connections.filter((c) =>
    ["ERROR", "TOKEN_EXPIRED", "PERMISSION_DENIED", "RATE_LIMITED"].includes(c.status),
  ).length;

  const byCategory = new Map<ConnectionCategory, ConnectionView[]>();
  for (const c of connections) {
    const arr = byCategory.get(c.category) ?? [];
    arr.push(c);
    byCategory.set(c.category, arr);
  }

  return (
    <div>
      <PageHeader
        title="Settings & Connections"
        subtitle="Single source of truth for every integration. Credentials are read only from environment variables — never stored here."
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Connected" value={live} tone="ok" hint="Live & verified" />
        <StatCard label="Pending" value={pending} tone="info" hint="Waiting / app review" />
        <StatCard label="Not configured" value={disconnected} hint="No credentials yet" />
        <StatCard label="Needs attention" value={errored} tone={errored > 0 ? "crit" : "default"} hint="Errors / expired" />
      </div>

      {CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((cat) => (
        <Section key={cat} title={cat}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {byCategory.get(cat)!.map((c) => (
              <ConnectionCard key={c.id} conn={c} />
            ))}
          </div>
        </Section>
      ))}

      <p className="mt-8 text-[11px] text-muted">
        Statuses: <span className="text-ok">Connected</span> · <span className="text-info">Waiting</span> ·{" "}
        <span className="text-warn">App review / Rate limited</span> ·{" "}
        <span className="text-crit">Error / Token expired / Permission denied</span> · Not configured · Disconnected.
        Future AI departments read connection status and credentials only through this registry.
      </p>
    </div>
  );
}
