import { validateRuntimeEnv } from "@/lib/runtime-validation";

/**
 * Renders a clear, persistent banner at the top of every page when required
 * configuration is missing — the visual counterpart to the startup validation
 * error. Renders nothing when fully configured.
 */
export function EnvValidationBanner() {
  const v = validateRuntimeEnv();
  if (v.ok) return null;

  return (
    <div className="border-b border-warn/30 bg-warn/10 px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-warn">⚠ Configuration incomplete</span>
        <span className="text-muted">Missing:</span>
        {v.missingRequired.map((k) => (
          <code key={k} className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-xs text-warn">
            {k}
          </code>
        ))}
        <span className="text-xs text-muted">
          — set these in <code className="font-mono">.env</code> to activate the affected subsystems.
        </span>
      </div>
    </div>
  );
}
