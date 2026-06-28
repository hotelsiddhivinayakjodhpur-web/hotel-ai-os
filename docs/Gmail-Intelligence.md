# Gmail Intelligence Layer

The **temporary production data source** for hotel revenue, until the Stayflexi
API credentials arrive. Stayflexi emails daily reports to the hotel inbox; this
layer parses them into Supabase and feeds the AI layer — through the same
`HotelDataProvider` interface the Stayflexi API will later implement, so **the AI
layer never changes when the source is swapped**.

> The Stayflexi SDK (`src/lib/stayflexi/`) is untouched and dormant.

## Flow diagram

```
            ┌──────────────── two entry points ────────────────┐
            │                                                   │
   n8n (Gmail trigger)                            App Gmail client (optional)
   downloads email + PDFs                         src/server/gmail/gmail.service.ts
            │                                                   │
            ▼                                                   ▼
   POST /api/ingest/stayflexi-report  ◄───────────────  syncGmailReports()
            │   { html, attachments[], messageId, subject, from }
            ▼
   ingestReport()  (src/server/gmail/ingest.service.ts)
            │
            ├─ detectReportType()  → NIGHT_AUDIT | DAILY_INTELLIGENCE
            ├─ parseIngest()       → structured JSON   (parser.ts)
            ├─ validate (zod)      → usable?
            ├─ dedupe              → EmailProcessingLog (messageId, reportType)
            ├─ store               → NightAuditReport / DailyIntelligenceReport (+children)
            └─ log                 → EmailProcessingLog (SUCCESS|PARTIAL|DUPLICATE|FAILED)
            │
            ▼
   getHotelDataProvider().getDailyKpis()  →  KpiSet
            │
            ├──────────────► CEO AI (executive.service, ceo.agent)
            └──────────────► Analytics AI (analytics page: occupancy/revenue trends, source analysis)
```

## Source format (real)

Stayflexi sends, from **`admin@stayflexi.com`**, subject *"Night Audit Report
report for HOTEL SIDDHI VINAYAK"*, with two PDF attachments
(`auditReport_29355.pdf`, `Daily Intelligence Report.pdf`) **and** an HTML body
that already contains the core KPIs:

```
Today's performance
  Rooms sold 19 · Occupancy 73.08% · ADR Rs. 1064.09 · Room revenue Rs. 20217.65
  Total Payments Collected: Cash 6650 · UPI 3295.01 · refunds … · Total 11638.88
Month's performance
  Rooms sold 304 · Occupancy 77.95% · ADR Rs. 1214.83 · Room revenue Rs. 369309.53
```

## Parsing strategy

1. **Night Audit core KPIs** → parsed from the **email HTML body** (reliable,
   no PDF binary needed). RevPAR = ADR × occupancy; rooms available =
   round(rooms sold ÷ occupancy). Nothing is hardcoded — every value is matched
   by label (`parser.ts`).
2. **Extended detail** (revenue by source/room type, pickup, forecast, arrivals)
   → parsed from **extracted PDF text** when provided (n8n extracts it, or the
   Gmail client can be extended). Best-effort, label-based, degrades to "absent"
   rather than failing.
3. **Report-type detection** from subject / filename / body keywords.
4. **Validation** (zod): a Night Audit is stored only if it has a business date
   and at least one headline metric.

## Database schema (new tables)

| Table | Purpose |
|---|---|
| `NightAuditReport` | one per (hotel, business date): occupancy, ADR, RevPAR, rooms sold/available, room/POS/services revenue, payments JSON, month-to-date JSON |
| `DailyIntelligenceReport` | occupancy, revenue, pickup, booking window, market intel JSON |
| `RevenueSource` | revenue by booking source (OTA/direct/walk-in) |
| `RoomRevenue` | revenue + rooms sold by room type |
| `PickupSource` | new bookings by source |
| `DailyForecast` | forward occupancy/revenue forecast rows |
| `EmailProcessingLog` | idempotency + observability: (messageId, reportType) unique, status, fields parsed, errors, attempts |

Dedup is enforced by unique constraints: reports on `(hotelId, businessDate)`,
processing on `(messageId, reportType)`.

## Error handling

`ingestReport()` never throws. Every failure mode — bad JSON, parse failure,
missing data, duplicate, DB down — is caught, recorded in `EmailProcessingLog`
with a status and message, and returned structurally so the caller (n8n / Gmail
client) can branch and retry. Re-ingesting the same message is an idempotent
upsert.

## n8n integration

Recommended n8n workflow:

1. **Gmail Trigger** — on new email from `admin@stayflexi.com`.
2. **(optional) Extract PDF** — Gmail "Download Attachment" → "Extract from File"
   (PDF) to text, per attachment.
3. **HTTP Request** — `POST {APP_URL}/api/ingest/stayflexi-report?secret={STAYFLEXI_WEBHOOK_SECRET}`
   with body:
   ```json
   {
     "messageId": "{{$json.id}}",
     "subject": "{{$json.subject}}",
     "from": "{{$json.from}}",
     "html": "{{$json.html}}",
     "attachments": [{ "filename": "Daily Intelligence Report.pdf", "text": "{{$json.pdfText}}" }]
   }
   ```
4. The endpoint returns `{ ok, status, businessDate, fieldsParsed }` for n8n to
   branch on.

The app can also pull Gmail itself (`/api/gmail/sync`) when
`GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` are configured; the daily cron
(`/api/agents/tick`) runs that sync before the agents.

## Migration strategy (Gmail → Stayflexi API)

The AI layer depends only on `HotelDataProvider` (`hotel-data.provider.ts`):

```ts
export function getHotelDataProvider(): HotelDataProvider {
  return gmailDataProvider; // ← later: return stayflexiApiProvider
}
```

When the Stayflexi API credentials arrive:
1. Activate the existing Stayflexi SDK (add the keys to env).
2. Add `stayflexiApiProvider` implementing the same `HotelDataProvider` interface
   (returning the same `KpiSet`).
3. Switch the one-line selector above (optionally behind an env flag).

**No change** to CEO AI, Analytics AI, the dashboards, or the database. The
Gmail tables can remain as a historical/backfill source.

## Production readiness
- Build/lint/typecheck green; ingestion verified end-to-end against a real
  Night Audit email (18 fields, idempotent).
- Endpoints secret-gated and fail-closed in production.
- No fabricated numbers; missing data renders honest empty states.
- Required for live Gmail *pull*: a Gmail OAuth refresh token **or** n8n driving
  the ingestion endpoint (recommended).
