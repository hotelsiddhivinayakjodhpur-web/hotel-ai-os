/**
 * Stayflexi connectivity verifier.
 *
 *   npm run stayflexi:verify
 *
 * Exercises a few SAFE, read-only documented endpoints against the real
 * Stayflexi APIs to confirm credentials + base URLs are correct. It performs NO
 * writes (no rate/inventory updates, no bookings, no cancellations).
 *
 * Skips any subsystem whose credentials aren't set, so it's safe to run before
 * you've been issued every key. Exits non-zero only on an UNEXPECTED failure
 * (a configured credential that doesn't work), not on "not configured yet".
 */
import { env } from "../src/lib/env";
import { stayflexi, defaultHotelId, StayflexiError } from "../src/lib/stayflexi";
import { addDays, isoDate } from "../src/lib/stayflexi/dates";

type Check = { name: string; run: () => Promise<unknown> };

function banner(s: string) {
  console.log(`\n${"─".repeat(64)}\n${s}\n${"─".repeat(64)}`);
}

async function runChecks(title: string, checks: Check[]): Promise<boolean> {
  banner(title);
  let allOk = true;
  for (const c of checks) {
    process.stdout.write(`• ${c.name} ... `);
    try {
      const out = await c.run();
      const preview =
        out && typeof out === "object" ? `${Object.keys(out as object).length} keys` : String(out);
      console.log(`OK (${preview})`);
    } catch (e) {
      allOk = false;
      if (e instanceof StayflexiError) {
        console.log(`FAIL [${e.name} status=${e.status ?? "n/a"}]`);
      } else {
        console.log(`FAIL [${e instanceof Error ? e.message : String(e)}]`);
      }
    }
  }
  return allOk;
}

async function main() {
  const beReady = Boolean(env.STAYFLEXI_BE_API_KEY && env.STAYFLEXI_GROUP_ID);
  const cmReady = Boolean(env.STAYFLEXI_CM_API_KEY && env.STAYFLEXI_PMS_ID);
  const hotelReady = Boolean(env.STAYFLEXI_HOTEL_ID);

  console.log("Stayflexi verification — read-only checks");
  console.log(
    `Booking Engine creds: ${beReady ? "set" : "MISSING"} | ` +
      `Channel Manager creds: ${cmReady ? "set" : "MISSING"} | ` +
      `hotelId: ${hotelReady ? "set" : "MISSING"}`,
  );

  let ok = true;

  // ── Booking Engine ──
  if (beReady) {
    const be = stayflexi.bookingEngine();
    const checks: Check[] = [
      { name: "grouphotels", run: () => be.listGroupHotels() },
      { name: "groupLocations", run: () => be.listGroupLocations() },
    ];
    if (hotelReady) {
      const hotelId = defaultHotelId();
      const today = isoDate(new Date());
      const tomorrow = addDays(today, 1);
      checks.push(
        { name: "hotelcontent", run: () => be.getHotelContent(hotelId) },
        {
          name: "hoteldetailadvanced (availability+rates)",
          run: () => be.getAvailabilityAndRates({ hotelId, checkin: today, checkout: tomorrow }),
        },
        {
          name: "hotelcalendar (inventory+restrictions)",
          run: () => be.getCalendar({ hotelId, fromDate: today, toDate: addDays(today, 7) }),
        },
      );
    }
    ok = (await runChecks("BOOKING ENGINE", checks)) && ok;
  } else {
    banner("BOOKING ENGINE — skipped (set STAYFLEXI_BE_API_KEY + STAYFLEXI_GROUP_ID)");
  }

  // ── Channel Manager ──
  if (cmReady && hotelReady) {
    const cm = stayflexi.channelManager();
    const hotelId = defaultHotelId();
    const checks: Check[] = [
      { name: "channels", run: () => cm.listChannels(hotelId) },
      { name: "gethoteldetail", run: () => cm.getHotelDetail(hotelId) },
      { name: "bookinglist (last 30d)", run: () => cm.listBookings(hotelId) },
    ];
    ok = (await runChecks("CHANNEL MANAGER", checks)) && ok;
  } else {
    banner(
      "CHANNEL MANAGER — skipped (set STAYFLEXI_CM_API_KEY + STAYFLEXI_PMS_ID + STAYFLEXI_HOTEL_ID)",
    );
  }

  banner(ok ? "RESULT: all configured checks passed ✅" : "RESULT: some checks FAILED ❌");
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error("Verifier crashed:", e);
  process.exit(1);
});
