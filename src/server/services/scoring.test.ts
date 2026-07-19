import { describe, it, expect } from "vitest";
import { scoreCampaignHealth, scoreKeyword, impressionWeightedAvg, clickWeightedAvg } from "./google-ads.service";
import { normaliseKey, fingerprint, inferCategory, resolvePriority } from "./recommendation.service";

/**
 * Business-logic tests for the scoring and deduplication engines.
 *
 * These functions drive money decisions (budget calls, keyword pauses, what the
 * CEO sees first), so their behaviour is pinned here rather than trusted.
 */

// Minimal valid rows — only the fields each scorer reads.
const campaign = (over: Partial<Parameters<typeof scoreCampaignHealth>[0]> = {}) =>
  ({
    campaign: "Test", status: "ENABLED", budget: 100, clicks: 500, impressions: 10_000,
    cost: 1000, conversions: 10, conversionValue: 5000, ctr: 0.05, avgCpc: 2, cpa: 100,
    roas: 5, impressionShare: 0.8, lostIsBudget: 0, lostIsRank: 0, budgetUtilization: 0.5,
    ...over,
  }) as Parameters<typeof scoreCampaignHealth>[0];

const keyword = (over: Partial<Parameters<typeof scoreKeyword>[0]> = {}) =>
  ({
    keyword: "hotel jodhpur", criterionKey: "1~1", campaign: "Test", matchType: "EXACT",
    status: "ENABLED", clicks: 50, impressions: 1000, cost: 500, conversions: 5,
    conversionValue: 2500, ctr: 0.05, avgCpc: 10, cpa: 100, roas: 5, qualityScore: 8,
    adRelevance: "ABOVE_AVERAGE", landingPageExp: "ABOVE_AVERAGE", expectedCtr: "ABOVE_AVERAGE",
    ...over,
  }) as Parameters<typeof scoreKeyword>[0];

describe("campaign health scoring", () => {
  it("scores a healthy campaign highly", () => {
    const r = scoreCampaignHealth(campaign(), 100);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.status).toBe("healthy");
    expect(r.issues).toHaveLength(0);
  });

  it("penalises spend with ZERO conversions most heavily", () => {
    // The single most expensive failure mode in paid search.
    const r = scoreCampaignHealth(campaign({ conversions: 0, cpa: null, roas: null }), 100);
    expect(r.score).toBeLessThan(80);
    expect(r.issues.join(" ")).toMatch(/0 conversions/i);
  });

  it("does NOT penalise a paused campaign for zero conversions", () => {
    // A paused campaign isn't wasting money — flagging it would be noise.
    const paused = scoreCampaignHealth(campaign({ status: "PAUSED", conversions: 0, cpa: null }), 100);
    const enabled = scoreCampaignHealth(campaign({ status: "ENABLED", conversions: 0, cpa: null }), 100);
    expect(paused.score).toBeGreaterThan(enabled.score);
  });

  it("flags impression share lost to budget", () => {
    const r = scoreCampaignHealth(campaign({ lostIsBudget: 0.35 }), 100);
    expect(r.issues.join(" ")).toMatch(/impression share to budget/i);
    expect(r.score).toBeLessThan(100);
  });

  it("flags CPA well above the account average", () => {
    const r = scoreCampaignHealth(campaign({ cpa: 500 }), 100); // 5x account CPA
    expect(r.issues.join(" ")).toMatch(/account average/i);
  });

  it("never returns a score outside 0-100", () => {
    const worst = scoreCampaignHealth(
      campaign({ conversions: 0, cpa: 99_999, lostIsBudget: 0.9, lostIsRank: 0.9, impressionShare: 0.01, ctr: 0.001 }),
      10,
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it("assigns status bands consistently with the score", () => {
    for (const c of [campaign(), campaign({ conversions: 0, cpa: null }), campaign({ ctr: 0.001, lostIsRank: 0.6 })]) {
      const r = scoreCampaignHealth(c, 100);
      if (r.score >= 80) expect(r.status).toBe("healthy");
      else if (r.score >= 55) expect(r.status).toBe("warning");
      else expect(r.status).toBe("critical");
    }
  });

  it("tolerates null impression-share fields (Smart/PMax accounts)", () => {
    const r = scoreCampaignHealth(campaign({ impressionShare: null, lostIsBudget: null, lostIsRank: null }), 100);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe("keyword health scoring", () => {
  it("scores a strong keyword highly", () => {
    const r = scoreKeyword(keyword(), 100);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(["top", "solid"]).toContain(r.perf);
  });

  it("penalises low Quality Score", () => {
    const low = scoreKeyword(keyword({ qualityScore: 3 }), 100);
    const good = scoreKeyword(keyword({ qualityScore: 9 }), 100);
    expect(low.score).toBeLessThan(good.score);
    expect(low.issues.join(" ")).toMatch(/quality score/i);
  });

  it("penalises spend with no conversions", () => {
    const r = scoreKeyword(keyword({ conversions: 0, cpa: null, roas: null }), 100);
    expect(r.issues.join(" ")).toMatch(/0 conversions/i);
  });

  it("only flags low CTR when impressions are statistically meaningful", () => {
    // 1 impression and 0 clicks is not evidence of a low-CTR keyword.
    const tiny = scoreKeyword(keyword({ ctr: 0.001, impressions: 5 }), 100);
    const real = scoreKeyword(keyword({ ctr: 0.001, impressions: 5000 }), 100);
    expect(tiny.issues.join(" ")).not.toMatch(/low ctr/i);
    expect(real.issues.join(" ")).toMatch(/low ctr/i);
  });

  it("classifies a converting, healthy keyword as top", () => {
    expect(scoreKeyword(keyword({ conversions: 20 }), 100).perf).toBe("top");
  });

  it("tolerates a missing Quality Score (Google withholds it on low volume)", () => {
    const r = scoreKeyword(keyword({ qualityScore: null }), 100);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.issues.join(" ")).not.toMatch(/quality score/i);
  });
});

describe("weighted averages", () => {
  it("weights impression share by impressions", () => {
    const rows = [
      { impressions: 900, v: 0.9 },
      { impressions: 100, v: 0.1 },
    ];
    const avg = impressionWeightedAvg(rows, (r) => r.v)!;
    expect(avg).toBeCloseTo(0.82, 2); // dominated by the high-impression row
  });

  it("weights click share by CLICKS, not impressions", () => {
    // Click share is a click-domain metric — impression-weighting would distort it.
    const rows = [
      { clicks: 90, v: 1.0 },
      { clicks: 10, v: 0.0 },
    ];
    expect(clickWeightedAvg(rows, (r) => r.v)).toBeCloseTo(0.9, 5);
  });

  it("returns null when nothing reports a value (never 0)", () => {
    expect(impressionWeightedAvg([{ impressions: 100, v: null }], (r) => r.v)).toBeNull();
    expect(clickWeightedAvg([{ clicks: 100, v: null }], (r) => r.v)).toBeNull();
  });

  it("ignores rows with zero weight", () => {
    const rows = [{ impressions: 0, v: 0.1 }, { impressions: 100, v: 0.9 }];
    expect(impressionWeightedAvg(rows, (r) => r.v)).toBeCloseTo(0.9, 5);
  });
});

describe("recommendation deduplication", () => {
  it("collapses the same finding with different counts", () => {
    // "3 campaigns..." and "1 campaign..." are the same problem.
    expect(normaliseKey("3 campaign(s) spending with 0 conversions"))
      .toBe(normaliseKey("1 campaign spending with 0 conversions"));
  });

  it("is word-order independent", () => {
    expect(normaliseKey("Improve the CTA")).toBe(normaliseKey("CTA improve"));
  });

  it("does NOT collapse genuinely different findings", () => {
    // This distinction is load-bearing: campaigns and keywords are separate fixes.
    expect(normaliseKey("5 keyword(s) spending with 0 conversions"))
      .not.toBe(normaliseKey("1 campaign(s) spending with 0 conversions"));
  });

  it("produces a stable fingerprint so owner status survives recomputation", () => {
    const a = fingerprint(normaliseKey("Bounce rate 72%"), "Website");
    const b = fingerprint(normaliseKey("Bounce rate 68%"), "Website");
    expect(a).toBe(b); // digits stripped → same underlying issue
    expect(a).toHaveLength(16);
  });

  it("separates identical text in different categories", () => {
    const key = normaliseKey("Improve conversion");
    expect(fingerprint(key, "Website")).not.toBe(fingerprint(key, "Booking"));
  });
});

describe("categorisation and priority", () => {
  const rec = (o: Partial<Parameters<typeof inferCategory>[0]>) =>
    ({ title: "", detail: "", department: "Google Ads", priority: "medium", ...o }) as Parameters<typeof inferCategory>[0];

  it("routes by keyword before department", () => {
    expect(inferCategory(rec({ title: "SSL certificate expired", department: "Website" }))).toBe("Security");
    expect(inferCategory(rec({ title: "LCP 4.2s exceeds target", department: "Website" }))).toBe("Performance");
  });

  it("falls back to the department mapping", () => {
    expect(inferCategory(rec({ title: "Add more headlines", department: "Instagram" }))).toBe("Content");
  });

  it("defaults to AI for an unknown department", () => {
    expect(inferCategory(rec({ title: "Something new", department: "Nonexistent Dept" }))).toBe("AI");
  });

  it("escalates to critical ONLY on a proven hard signal", () => {
    expect(resolvePriority(rec({ title: "Website is unreachable", priority: "high" }))).toBe("critical");
    expect(resolvePriority(rec({ title: "SSL expired", priority: "low" }))).toBe("critical");
  });

  it("never invents critical from urgent-sounding wording", () => {
    // Tone must not drive severity — only evidence does.
    expect(resolvePriority(rec({ title: "URGENT: improve your ad copy now!", priority: "medium" }))).toBe("medium");
    expect(resolvePriority(rec({ title: "Critical opportunity to grow", priority: "low" }))).toBe("low");
  });

  it("honours an explicit critical flag from the producing department", () => {
    expect(resolvePriority(rec({ title: "Campaign health critical", priority: "high", critical: true }))).toBe("critical");
  });
});
