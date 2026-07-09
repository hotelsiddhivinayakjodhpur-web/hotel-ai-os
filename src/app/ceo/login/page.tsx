import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CeoLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <div className="card">
        <div className="text-center">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">Hotel Siddhi Vinayak</div>
          <h1 className="mt-1 text-lg font-semibold text-text">CEO Dashboard</h1>
        </div>

        <form action={loginAction} className="mt-6 space-y-3">
          <div>
            <label htmlFor="password" className="stat-label">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-info"
            />
          </div>

          {error && <p className="text-xs text-crit">Incorrect password. Please try again.</p>}

          <button
            type="submit"
            className="w-full rounded-lg bg-info/15 px-3 py-2 text-sm font-semibold text-info transition-colors hover:bg-info/25"
          >
            Login
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">Internal · read-only · authorized access only</p>
      </div>
    </div>
  );
}
