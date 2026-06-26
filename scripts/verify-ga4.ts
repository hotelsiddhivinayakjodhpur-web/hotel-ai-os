/**
 * GA4 runtime verification — proves env loading + service-account access +
 * live data for the configured property. Prints the EXACT Google API response
 * (status + body) on failure instead of a generic message.
 *
 *   npx tsx --env-file=.env scripts/verify-ga4.ts
 */
import { env } from "../src/lib/env";
import { GOOGLE_SCOPES, getAccessToken } from "../src/server/integrations/google-auth";

function line(s = "─".repeat(64)) {
  console.log(s);
}

async function main() {
  line();
  console.log("GA4 RUNTIME VERIFICATION");
  line();

  // 1. Confirm GA4_PROPERTY_ID is loaded from the runtime environment.
  console.log(`1. GA4_PROPERTY_ID (runtime env) : ${env.GA4_PROPERTY_ID ?? "(MISSING)"}`);
  console.log(`   GOOGLE service account set    : ${Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)}`);
  if (!env.GA4_PROPERTY_ID) {
    console.log("   ✗ GA4_PROPERTY_ID is not loaded. Aborting.");
    process.exit(1);
  }

  // 2. Token (proves the service account authenticates for the analytics scope).
  const token = await getAccessToken(GOOGLE_SCOPES.analytics);
  console.log(`2. Access token acquired         : yes (len ${token.length})`);

  // 3. Property access check via Admin getMetadata (lightweight) — optional;
  //    the real proof is the runReport below.
  const propId = env.GA4_PROPERTY_ID;
  const metaUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${propId}/metadata`;
  const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
  console.log(`3. Property metadata access      : HTTP ${metaRes.status}`);
  if (!metaRes.ok) {
    console.log("   --- exact Google response ---");
    console.log(await metaRes.text());
  }

  // 4. Live runReport — the definitive test.
  line();
  console.log("4. runReport (sessions, activeUsers, conversions, last 28 days)");
  const reportUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`;
  const res = await fetch(reportUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      metrics: [
        { name: "sessions" },
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "screenPageViews" },
        { name: "conversions" },
      ],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      limit: 10,
    }),
  });

  console.log(`   HTTP status                   : ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!res.ok) {
    line();
    console.log("❌ GA4 FAILED — exact Google API response:");
    console.log(text);
    line();
    process.exit(1);
  }

  const data = JSON.parse(text) as {
    rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    rowCount?: number;
  };
  const totalSessions = (data.rows ?? []).reduce(
    (s, r) => s + Number(r.metricValues?.[0]?.value ?? 0),
    0,
  );
  console.log(`   ✅ LIVE DATA — rowCount=${data.rowCount ?? 0}, total sessions=${totalSessions}`);
  for (const r of data.rows ?? []) {
    const ch = r.dimensionValues?.[0]?.value ?? "(other)";
    const mv = r.metricValues?.map((m) => m.value).join(" / ");
    console.log(`     • ${ch}: ${mv}  (sessions/users/new/views/conv)`);
  }
  line();
  console.log("RESULT: GA4 live verification PASSED ✅");
}

main().catch((e) => {
  console.error("Verifier crashed:", e);
  process.exit(1);
});
