/**
 * Google connectivity verifier + ID discovery.
 *
 *   npm run google:verify
 *
 * Uses the configured service account to:
 *   1. Exchange a JWT for an access token (proves auth works)
 *   2. List Search Console sites the account can read (discovers GSC_SITE_URL form)
 *   3. List GA4 properties the account can read (discovers GA4_PROPERTY_ID)
 *
 * Read-only. Prints exactly what to paste into .env.
 */
import { GOOGLE_SCOPES, getAccessToken, isConfigured } from "../src/server/integrations/google-auth";
import { env } from "../src/lib/env";

function banner(s: string) {
  console.log(`\n${"─".repeat(64)}\n${s}\n${"─".repeat(64)}`);
}

async function listGscSites(): Promise<void> {
  banner("SEARCH CONSOLE — sites accessible to the service account");
  const token = await getAccessToken(GOOGLE_SCOPES.searchConsole);
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.log(`  FAILED (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const data = (await res.json()) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] };
  const sites = data.siteEntry ?? [];
  if (sites.length === 0) {
    console.log("  No sites. Add hotel-ai@…iam.gserviceaccount.com as a user on the GSC property.");
    return;
  }
  for (const s of sites) console.log(`  • ${s.siteUrl}  [${s.permissionLevel}]`);
  console.log(`\n  → set GSC_SITE_URL to one of the above (exact string).`);
}

async function listGa4Properties(): Promise<void> {
  banner("GA4 — properties accessible to the service account");
  const token = await getAccessToken(GOOGLE_SCOPES.analytics);
  const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.log(`  FAILED (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const data = (await res.json()) as {
    accountSummaries?: {
      displayName?: string;
      propertySummaries?: { property?: string; displayName?: string }[];
    }[];
  };
  const accounts = data.accountSummaries ?? [];
  if (accounts.length === 0) {
    console.log("  No properties. Add the service account to the GA4 property (Viewer).");
    return;
  }
  for (const a of accounts) {
    console.log(`  Account: ${a.displayName}`);
    for (const p of a.propertySummaries ?? []) {
      const id = p.property?.replace("properties/", "");
      console.log(`    • ${p.displayName}  →  GA4_PROPERTY_ID=${id}`);
    }
  }
}

async function main() {
  console.log("Google verification — service account auth + ID discovery");
  if (!isConfigured()) {
    console.log("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set. Aborting.");
    process.exit(1);
  }
  console.log(`GSC_SITE_URL (current): ${env.GSC_SITE_URL ?? "(unset)"}`);
  console.log(`GA4_PROPERTY_ID (current): ${env.GA4_PROPERTY_ID || "(unset — will discover)"}`);

  try {
    await getAccessToken(GOOGLE_SCOPES.searchConsole);
    console.log("\n✅ Token exchange OK — service account authenticated.");
  } catch (e) {
    console.log(`\n❌ Token exchange FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  await listGscSites();
  await listGa4Properties();
  banner("Done. Paste the discovered IDs into .env, then run npm run google:verify again.");
}

main().catch((e) => {
  console.error("Verifier crashed:", e);
  process.exit(1);
});
