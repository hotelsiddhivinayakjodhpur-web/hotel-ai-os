import { describe, it, expect } from "vitest";
import { buildAdCopyPack, adaptToAdCopy, AD_LIMITS, AD_COPY_THEMES, type AdCopyTheme } from "./google-ads-tools";
import { PAGES, HOTEL } from "./hotel-facts";

/**
 * Ad Copy engine — regression suite.
 *
 * Every test here corresponds to a defect that actually shipped and was caught
 * by manual inspection. These exist so the next one is caught by CI instead.
 */

describe("Google Ads asset limits (policy compliance)", () => {
  const themes = AD_COPY_THEMES.map((t) => t.id);

  it.each(themes)("theme '%s' never exceeds any Google character limit", (theme: AdCopyTheme) => {
    const pack = buildAdCopyPack({ theme });
    for (const h of pack.headlines) expect(h.length, `headline: ${h}`).toBeLessThanOrEqual(AD_LIMITS.headline);
    for (const d of pack.descriptions) expect(d.length, `description: ${d}`).toBeLessThanOrEqual(AD_LIMITS.description);
    for (const c of pack.callouts) expect(c.length, `callout: ${c}`).toBeLessThanOrEqual(AD_LIMITS.callout);
    for (const p of pack.paths) expect(p.length, `path: ${p}`).toBeLessThanOrEqual(AD_LIMITS.path);
    for (const v of pack.structuredSnippet.values) expect(v.length).toBeLessThanOrEqual(AD_LIMITS.snippetValue);
  });

  it.each(themes)("theme '%s' never emits a TRUNCATED [OPERATOR] placeholder", (theme: AdCopyTheme) => {
    // REGRESSION: clamping once split "[OPERATOR: e.g. Free Cancellation]" into
    // "[OPERATOR: e.g. Free" — meaningless copy that would have gone live.
    const pack = buildAdCopyPack({ theme });
    const assets = [...pack.headlines, ...pack.descriptions, ...pack.callouts];
    for (const a of assets) {
      const opens = (a.match(/\[/g) ?? []).length;
      const closes = (a.match(/\]/g) ?? []).length;
      expect(opens, `unbalanced brackets in: ${a}`).toBe(closes);
    }
  });

  it.each(themes)("theme '%s' meets Google's asset-count guidance", (theme: AdCopyTheme) => {
    // REGRESSION: packs once shipped 8/15 headlines and 2/4 descriptions.
    const pack = buildAdCopyPack({ theme });
    expect(pack.headlines.length).toBeGreaterThanOrEqual(10);
    expect(pack.descriptions.length).toBeGreaterThanOrEqual(3);
    expect(pack.callouts.length).toBeGreaterThanOrEqual(4);
  });

  it("produces no duplicate assets within a pack", () => {
    const pack = buildAdCopyPack({ theme: "hotel-offer" });
    expect(new Set(pack.headlines).size).toBe(pack.headlines.length);
    expect(new Set(pack.descriptions).size).toBe(pack.descriptions.length);
  });
});

describe("data integrity — no fabricated claims", () => {
  it("never invents a price, discount or rating", () => {
    for (const t of AD_COPY_THEMES) {
      const pack = buildAdCopyPack({ theme: t.id });
      const text = [...pack.headlines, ...pack.descriptions, ...pack.callouts].join(" ");
      // No currency amounts, no "N% off", no star ratings — those must come from
      // the operator via the promotion extension, never from the generator.
      expect(text).not.toMatch(/₹\s*\d/);
      expect(text).not.toMatch(/\d+\s*%\s*off/i);
      expect(text).not.toMatch(/\d(\.\d)?\s*star/i);
    }
  });

  it("promotion extension refuses to invent a discount", () => {
    const pack = buildAdCopyPack({ theme: "hotel-offer", promo: { occasion: "Diwali" } });
    expect(pack.promotion).not.toBeNull();
    // No value supplied → an explicit operator placeholder, never a made-up number.
    expect(pack.promotion!.join(" ")).toContain("[OPERATOR: set the discount]");
  });

  it("uses the operator's real discount when supplied", () => {
    const pack = buildAdCopyPack({ theme: "hotel-offer", promo: { discountType: "percent", discountValue: "15" } });
    expect(pack.promotion!.join(" ")).toContain("15% off");
  });

  it("omits the promotion block entirely when nothing is supplied", () => {
    expect(buildAdCopyPack({ theme: "generic" }).promotion).toBeNull();
  });
});

describe("landing page correctness", () => {
  it("only ever links to verified real pages", () => {
    // REGRESSION: generators hardcoded /attractions, which 404s. The real page
    // is /nearby-attractions — this locks the verified PAGES map as the source.
    const valid = Object.values(PAGES);
    for (const t of AD_COPY_THEMES) {
      const notes = buildAdCopyPack({ theme: t.id }).notes.join(" ");
      const urls = notes.match(new RegExp(`${HOTEL.website}[a-z-/]*`, "g")) ?? [];
      for (const u of urls) {
        const path = u.replace(HOTEL.website, "") || "/";
        expect(valid, `unverified landing path: ${path}`).toContain(path);
      }
    }
  });

  it("PAGES contains no known-dead path", () => {
    expect(Object.values(PAGES)).not.toContain("/attractions");
    expect(Object.values(PAGES)).toContain("/nearby-attractions");
  });
});

describe("ad strength scoring", () => {
  it("is bounded 0-100 and self-consistent", () => {
    for (const t of AD_COPY_THEMES) {
      const s = buildAdCopyPack({ theme: t.id }).strength;
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      if (s.score >= 85) expect(s.rating).toBe("excellent");
      if (s.score < 50) expect(s.rating).toBe("poor");
    }
  });

  it("explains every gap rather than only scoring it", () => {
    const s = buildAdCopyPack({ theme: "generic" }).strength;
    if (s.score < 100) expect(s.tips.length).toBeGreaterThan(0);
  });
});

describe("adaptToAdCopy delegates (single source of truth)", () => {
  it("returns the same assets the shared pack builder produces", () => {
    // Guards against the wrapper drifting into a second generator.
    const src = { title: "Diwali Offer — 20% off", body: "Celebrate Diwali in Jodhpur.\nBook direct and save." };
    const wrapper = adaptToAdCopy(src);
    const pack = buildAdCopyPack({ theme: "generic", source: src });
    expect(wrapper.headlines).toEqual(pack.headlines);
    expect(wrapper.descriptions).toEqual(pack.descriptions);
  });
});
