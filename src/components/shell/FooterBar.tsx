import { env } from "@/lib/env";
import pkg from "../../../package.json";

/**
 * Global footer (every page): version, environment, deployment identity and
 * serving status. Reads only values that actually exist — CLI deploys have no
 * git SHA in the runtime, so the Vercel deployment id is shown instead of a
 * fabricated commit.
 */
export function FooterBar() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  const deployment = process.env.VERCEL_DEPLOYMENT_ID?.replace(/^dpl_/, "").slice(0, 10) ?? null;
  const region = process.env.VERCEL_REGION ?? null;

  return (
    <footer className="mt-8 border-t border-border px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[11px] text-muted">
        <span>
          Hotel AI OS <span className="font-mono">v{pkg.version}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Env: {env.NODE_ENV}</span>
          <span>{commit ? `Commit ${commit}` : deployment ? `Deployment ${deployment}` : "Local build"}</span>
          {region && <span>Region {region}</span>}
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
            Build: Serving
          </span>
        </span>
      </div>
    </footer>
  );
}
