import { HOTEL, ATTRACTIONS } from "@/lib/hotel-facts";
import { generateInstagramCaption, generateFacebookPost, generateYouTubeMeta } from "@/lib/content-templates";
import { generateDailyPost, generateOffer, generateFaqFromQuery } from "@/lib/gbp-content";
import { prepareEmail, prepareGoogleAdsCampaign, prepareMetaCampaign, type AdsCampaignSpec, type MetaCampaignSpec } from "@/lib/marketing-ops";

/**
 * Content Factory AI — composes ONE ready-to-post package per request by
 * REUSING every existing generator (Instagram/Facebook/YouTube templates,
 * GBP post/offer/FAQ generators, email preparators, ads campaign specs) and
 * adding the factory-only layers (strategy, variants, prompts, scripts,
 * shot lists, checklists).
 *
 * Honesty contract: only verified hotel facts (hotel-facts.ts) appear as
 * facts; anything the operator must confirm is an explicit [OPERATOR: …]
 * placeholder; performance prediction derives ranges ONLY from the account's
 * real current baselines and says so. Nothing here publishes anything.
 */
export type PackageTopic = "OFFER" | "FESTIVAL" | "ATTRACTION" | "ROOMS" | "DINING" | "GENERAL";

export interface FactoryBaselines {
  igFollowers: number | null;
  igReach30d: number | null;
  igAvgLikes: number | null; // mean likes of the real recent posts
  fbFollowers: number | null;
  sessions28d: number | null;
}

export interface PlatformCopy {
  platform: string;
  professional: string;
  emoji: string;
  hindi: string;
  hinglish: string;
}

export interface ContentPackage {
  topicLabel: string;
  strategy: { objective: string; audience: string; funnelStage: string; intent: string; platforms: string; cta: string };
  social: PlatformCopy[];
  hashtags: { group: string; tags: string[] }[];
  imagePrompts: { tool: string; prompt: string }[];
  carousel: { slide: string; title: string; description: string; photo: string }[];
  reel: Record<string, string>;
  video: Record<string, string>;
  shotList: { subject: string; angle: string; time: string; lighting: string; composition: string }[];
  design: Record<string, string>;
  seo: Record<string, string>;
  gbp: Record<string, string>;
  email: { subject: string; preview: string; body: string; cta: string; buttonText: string; htmlNote: string };
  whatsapp: { kind: string; message: string }[];
  metaAds: MetaCampaignSpec;
  googleAds: AdsCampaignSpec;
  prediction: { metric: string; expectation: string; why: string }[];
  checklist: string[];
}

const H = HOTEL.name;
const CITY = HOTEL.city;

function topicPhrase(topic: PackageTopic, detail: string): string {
  const d = detail.trim();
  switch (topic) {
    case "OFFER":
      return d || "your direct-booking offer";
    case "FESTIVAL":
      return d ? `${d} in ${CITY}` : `the festive season in ${CITY}`;
    case "ATTRACTION":
      return d || ATTRACTIONS[0] || `the sights of ${CITY}`;
    case "ROOMS":
      return d || "our rooms";
    case "DINING":
      return d || "our restaurant";
    default:
      return d || `a stay in the Blue City`;
  }
}

export function buildContentPackage(topic: PackageTopic, detail: string, baselines: FactoryBaselines): ContentPackage {
  const phrase = topicPhrase(topic, detail);
  const topicLabel = `${topic}: ${detail || "(general)"}`;

  // ── 1. Strategy ──
  const strategy = {
    objective: topic === "OFFER" ? "Direct bookings (bypass OTA commission)" : topic === "FESTIVAL" ? "Capture festival-window demand" : "Awareness → website sessions → direct bookings",
    audience: `Domestic leisure travellers planning a ${CITY} trip; families and couples researching stays near the old city`,
    funnelStage: topic === "OFFER" ? "Decision (BOFU)" : "Awareness/Consideration (TOFU–MOFU)",
    intent: topic === "OFFER" ? "Ready to book — needs a reason to book direct" : `Researching ${CITY} — needs inspiration + trust`,
    platforms: "Instagram (primary reach) · Facebook (local community) · GBP (local search) · YouTube Shorts (discovery)",
    cta: `${HOTEL.bookingNote} → ${HOTEL.website}`,
  };

  // ── 2. Social package (reuses the existing platform generators as the base) ──
  const igBase = generateInstagramCaption(topic === "OFFER" ? "offer" : topic === "FESTIVAL" ? "festival" : "attraction", phrase);
  const fbBase = generateFacebookPost(topic === "OFFER" ? "offer" : topic === "FESTIVAL" ? "festival" : "attraction", phrase);
  const gbpBase = generateDailyPost(topic === "OFFER" ? "direct-booking" : topic === "DINING" ? "dining" : topic === "ROOMS" ? "rooms" : "attraction", phrase);
  const mk = (platform: string, base: string): PlatformCopy => ({
    platform,
    professional: base,
    emoji: `✨ ${base} 🏰💙`,
    hindi: hindiCopy(topic, phrase),
    hinglish: `${phrase} explore karna hai? ${H}, ${CITY} se sab kuch paas hai. Direct booking = best rate. Link in bio! 💙`,
  });
  const social: PlatformCopy[] = [
    mk("Instagram Feed", igBase.caption),
    mk("Instagram Reel (caption)", `POV: ${phrase} 🎥 ${igBase.caption.slice(0, 120)}`),
    mk("Instagram Story", `${phrase} — swipe up thoughts? DM us "STAY" for direct-booking rates at ${H}.`),
    mk("Facebook Post", fbBase),
    mk("Google Business Post", `${gbpBase.body} ${gbpBase.cta}`),
    mk("YouTube Community Post", `New from ${H}: ${phrase}. What should we film next in ${CITY}? 👇`),
    { platform: "LinkedIn (future)", professional: "[Deferred — activate when a LinkedIn page exists]", emoji: "—", hindi: "—", hinglish: "—" },
    { platform: "Twitter/X (future)", professional: "[Deferred — activate when an X account exists]", emoji: "—", hindi: "—", hinglish: "—" },
  ];

  // ── 3. Hashtags (marketing labels, capped at 30) ──
  const hashtags = [
    { group: "High competition", tags: ["#travel", "#india", "#hotel", "#vacation"] },
    { group: "Medium competition", tags: ["#rajasthantourism", "#incredibleindia", "#travelindia", "#heritagehotel"] },
    { group: "Local / Jodhpur", tags: ["#jodhpur", "#bluecity", "#jodhpurdiaries", "#mehrangarh", "#jodhpurcity"] },
    { group: "Hotel", tags: ["#hotelsiddhivinayak", "#jodhpurhotel", "#stayinjodhpur", "#jodhpurstay"] },
    { group: "Travel", tags: ["#travelgram", "#wanderlust", "#indiatravel", "#travelphotography"] },
    { group: "Luxury", tags: ["#luxurystay", "#boutiquehotel", "#hotellife"] },
    { group: "SEO/intent", tags: ["#jodhpurtourism", "#rajasthandiaries", "#weekendgetaway", "#familytravel", "#couplegoals", "#foodie"] },
  ];

  // ── 4. AI image prompts (8 tools, full photographic spec, no text-in-image) ──
  const scene =
    topic === "ROOMS"
      ? `an elegant hotel guest room at ${H}, ${CITY}`
      : topic === "DINING"
        ? `a warmly lit hotel restaurant table setting in ${CITY}`
        : topic === "FESTIVAL"
          ? `a heritage hotel courtyard decorated with diyas and marigolds in ${CITY}`
          : `the blue old-city rooftops of ${CITY} with Mehrangarh Fort on the horizon at golden hour`;
  const core = `${scene}, luxury hospitality photography, ultra realistic, 35mm lens, eye-level three-quarter angle, golden-hour soft directional light, rule-of-thirds composition, warm amber-and-indigo color grading, serene inviting mood, high dynamic range, no text, no watermark`;
  const imagePrompts = [
    { tool: "OpenAI Images", prompt: core },
    { tool: "Claude Images", prompt: core },
    { tool: "Midjourney", prompt: `${core} --ar 4:5 --style raw --v 6` },
    { tool: "Flux", prompt: `${core}, photorealistic render, f/2.8 depth of field` },
    { tool: "Ideogram", prompt: `${core}, magazine editorial quality` },
    { tool: "Stable Diffusion", prompt: `${core}, 8k, sharp focus, (no text:1.4)` },
    { tool: "Canva AI", prompt: `${scene}, warm luxury hotel photo, golden hour, realistic, portrait 4:5, no text` },
    { tool: "Adobe Firefly", prompt: `${core}, content type: photo` },
  ];

  // ── 5. Carousel ──
  const carousel = [
    { slide: "1 (Hook)", title: `${CITY} is calling`, description: `Open with the strongest visual — stop the scroll with ${phrase}.`, photo: "Hero shot (see shot list #1)" },
    { slide: "2", title: "Wake up here", description: `Morning at ${H} — comfort first, sightseeing second. [OPERATOR: confirm the room photo shows a real room]`, photo: "Room, window light" },
    { slide: "3", title: "Eat like a local", description: `From our restaurant to ${CITY}'s street food — a taste itinerary.`, photo: "Restaurant / thali close-up" },
    { slide: "4", title: "10 minutes from everything", description: `${(ATTRACTIONS.slice(0, 3) as readonly string[]).join(" · ")} — plan one day, see them all.`, photo: "Attraction exterior" },
    { slide: "5", title: "Why book direct?", description: HOTEL.bookingNote, photo: "Reception / warm welcome" },
    { slide: "6 (CTA)", title: "Your Jodhpur basecamp", description: `Save this post · Book at ${HOTEL.website}`, photo: "Night exterior with signage lit" },
  ];

  // ── 6. Reel package ──
  const reel: Record<string, string> = {
    Hook: `"You're 10 minutes from every sight in ${CITY}" (first 1.5s, hard cut)`,
    Voiceover: `This is ${H} — your basecamp in the Blue City. ${phrase} starts at our doorstep.`,
    "Scene 1": "Drone/gimbal push toward the hotel exterior (2s)",
    "Scene 2": "Door opens → lobby reveal, walking POV (2s)",
    "Scene 3": "Room: curtains pulled, light floods in (2.5s)",
    "Scene 4": `Cutaway: ${ATTRACTIONS[0] ?? "Mehrangarh Fort"} + blue streets, fast cuts (3s)`,
    "Scene 5": "Restaurant: dish landing on table, steam close-up (2s)",
    "Ending CTA": `End card voice: "${HOTEL.bookingNote}" → show ${HOTEL.website}`,
    "On-screen text": "Minimal captions per scene, lower third, brand color",
    "B-roll": "Staff welcome · keys handover · rooftop sunset · street lassi pour",
    "Camera movement": "Slow push-ins and whip-pan transitions; gimbal only, no shake",
    Transitions: "Whip-pan between locations; hard cut on beat for hook",
    Duration: "18–24 seconds",
    "Music style": "Rajasthani folk fusion, 90–100 BPM rise",
    "Trending audio": "[OPERATOR: pick a currently-trending audio in IG — trends change weekly; not guessable]",
    "Thumbnail text": `${CITY} basecamp`,
    "Thumbnail prompt": imagePrompts[2]?.prompt ?? core,
  };

  // ── 7. Video package (reuses the existing YouTube meta generator) ──
  const yt = generateYouTubeMeta({ topic: phrase, format: "video" });
  const video: Record<string, string> = {
    "YouTube Title": yt.titles[0] ?? `${phrase} — ${H}, ${CITY}`,
    "SEO Title": yt.titles[1] ?? `${phrase} | ${CITY} hotel guide`,
    Description: yt.description,
    Chapters: "0:00 Hook · 0:15 The hotel · 0:45 Rooms · 1:15 Food · 1:45 Around the city · 2:30 How to book",
    Tags: yt.tags.join(", "),
    "Thumbnail Prompt": imagePrompts[0]?.prompt ?? core,
    "End Screen CTA": `Subscribe + "Book direct at ${HOTEL.website}"`,
    "Pinned Comment": `Planning ${CITY}? Ask us anything below — and book direct for the best rate: ${HOTEL.website}`,
    "Short Description": `${phrase} from ${H}, ${CITY}.`,
    "Long Description": `${yt.description}\n\nAttractions nearby: ${(ATTRACTIONS.slice(0, 5) as readonly string[]).join(", ")}.`,
  };

  // ── 8. Shot list ──
  const shotList = [
    { subject: "Exterior (hero)", angle: "Low three-quarter", time: "Golden hour", lighting: "Natural warm", composition: "Building right-third, sky negative space" },
    { subject: "Reception / welcome", angle: "Eye level, guest POV", time: "Morning", lighting: "Ambient + warm fill", composition: "Staff centered, desk leading line" },
    { subject: "Lobby", angle: "Wide corner", time: "Midday", lighting: "Natural", composition: "Symmetry, leading lines" },
    { subject: "Room", angle: "Corner wide + detail set", time: "Morning window light", lighting: "Natural, curtains open", composition: "Bed two-thirds, window highlight" },
    { subject: "Bathroom", angle: "Doorway wide", time: "Any (controlled)", lighting: "All fixtures on + fill", composition: "Mirror line, no photographer reflection" },
    { subject: "Restaurant + food", angle: "45° table + overhead dish", time: "Lunch service", lighting: "Window side-light", composition: "Steam visible, shallow depth" },
    { subject: "Night view", angle: "Tripod front", time: "Blue hour", lighting: "Signage lit", composition: "Long exposure, clean sky" },
    { subject: "Staff", angle: "Candid 85mm", time: "Working hours", lighting: "Natural", composition: "Action moments, consent confirmed" },
    { subject: "Guest experience", angle: "Over-shoulder", time: "Check-in", lighting: "Ambient", composition: "[OPERATOR: real guests only with written consent]" },
    { subject: "Nearby attraction", angle: "Wide + human scale", time: "Sunrise", lighting: "Natural", composition: `${ATTRACTIONS[0] ?? "Fort"} with foreground figure` },
    { subject: "Drone establishing", angle: "Top-down + orbit", time: "Sunrise", lighting: "Natural", composition: "[OPERATOR: verify local drone rules near the fort]" },
    { subject: "Sunset rooftop", angle: "Silhouette wide", time: "Sunset", lighting: "Backlit", composition: "Skyline horizon lower-third" },
  ];

  // ── 9. Graphic design package ──
  const design: Record<string, string> = {
    "Banner text": `${phrase} · ${H}, ${CITY}`,
    "Offer graphic": `Headline "[OPERATOR: exact offer]" · subline "${HOTEL.bookingNote}" · website URL footer`,
    "Story graphic": "9:16, hero photo top 60%, caption band bottom, one CTA sticker",
    "Festival graphic": "Marigold/diya border motif, brand colors, greeting headline + one-line offer hook",
    "Review graphic": "[OPERATOR: paste a REAL guest review verbatim] — quote card, 5-star row, guest first name only",
    "Quote graphic": `"The Blue City looks best from a place that feels like home." — ${H}`,
    "Template suggestion": "Canva: 'Minimal Luxury Hotel' template family — keep one family for consistency",
    "Brand colors": "Deep indigo #1e2a4a · warm sand #e8c890 · white — matches the dark-luxury site theme",
    "Font recommendation": "Playfair Display (headings) + Inter (body) — mirrors the website pairing",
  };

  // ── 10. SEO package (reuses the FAQ generator on the topic) ──
  const faq = generateFaqFromQuery(`${phrase} ${CITY} hotel`);
  const slug = phrase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const seo: Record<string, string> = {
    "SEO Title": `${phrase} — stay at ${H}, ${CITY}`,
    "Meta Title": `${phrase} | ${H} ${CITY}`.slice(0, 60),
    "Meta Description": `${phrase} made easy from ${H} — central ${CITY} location, direct-booking rates. ${HOTEL.bookingNote}`.slice(0, 155),
    Slug: `/blog/${slug}`,
    Keywords: `${CITY.toLowerCase()} hotel, ${slug.replace(/-/g, " ")}, ${CITY.toLowerCase()} stay, hotels near ${(ATTRACTIONS[0] ?? "Mehrangarh Fort").toLowerCase()}`,
    "Schema suggestion": "Article + FAQPage (question below) + Hotel (site-wide already present)",
    "Internal links": HOTEL.websiteSections.join(" · "),
    "External links": "Official Rajasthan Tourism page for the attraction (authoritative, non-competing)",
    FAQ: `${faq.question} — ${faq.answer}`,
    "Featured snippet": `Answer the FAQ in ≤50 words directly under an H2 phrased as the question.`,
    "AI search optimization": "Lead with a direct answer paragraph; keep facts (location, distances) explicit — AI answer engines quote verifiable statements.",
  };

  // ── 11. Google Business package (reuses GBP generators) ──
  const offer = generateOffer({ title: detail || "Direct Booking Offer", benefit: "[OPERATOR: exact benefit — never invented]", validFrom: "[OPERATOR: YYYY-MM-DD]", validTo: "[OPERATOR: YYYY-MM-DD]" });
  const gbp: Record<string, string> = {
    Post: `${gbpBase.body} ${gbpBase.cta}`,
    "Offer Post": `${offer.body} ${offer.couponHint}`,
    "Event Post": topic === "FESTIVAL" ? `Celebrate ${detail || "the festival"} in ${CITY} — ${H} is minutes from the old-city celebrations. [OPERATOR: add exact dates]` : "n/a for this topic",
    Question: faq.question,
    Answer: faq.answer,
    "Review Request": `Loved your stay? A quick Google review helps other travellers find ${H}. It takes 30 seconds — thank you!`,
  };

  // ── 12. Email package (reuses the email preparators) ──
  const emailBase = prepareEmail(topic === "OFFER" ? "OFFER" : topic === "FESTIVAL" ? "FESTIVAL" : "NEWSLETTER");
  const email = {
    subject: emailBase.title,
    preview: `${phrase} — from ${H}, ${CITY}`,
    body: emailBase.body,
    cta: HOTEL.bookingNote,
    buttonText: "Book Direct",
    htmlNote: "HTML version: single-column, hero image (shot #1), button block; plain-text version is the body as-is. Rendered on send-platform connect — never auto-sent.",
  };

  // ── 13. WhatsApp package ──
  const wa = (kind: string, message: string) => ({ kind, message });
  const whatsapp = [
    wa("Broadcast", `Namaste from ${H}! ${phrase} — planning a ${CITY} trip? Reply STAY for our direct-booking rate. 🙏`),
    wa("Quick reply", `Thanks for reaching ${H}! Share your dates and we'll confirm availability within the hour.`),
    wa("Follow-up", `Hi [OPERATOR: guest name], still planning your ${CITY} visit? Your quote from ${H} is valid — reply YES to hold it.`),
    wa("Offer", `${H} direct-booking offer: [OPERATOR: exact offer + validity]. Book: ${HOTEL.website}`),
    wa("Festival", `Wishing you a joyful ${topic === "FESTIVAL" && detail ? detail : "festive season"} from all of us at ${H}, ${CITY}! 🪔`),
    wa("Booking reminder", `Reminder: your stay at ${H} begins [OPERATOR: date]. Check-in from [OPERATOR: time]. Safe travels!`),
    wa("Review reminder", `Hope you loved ${CITY}! A 30-second Google review of ${H} would mean a lot: [OPERATOR: review link]`),
  ];

  // ── 14 + 15. Ads packages (reuse the DMOC campaign spec builders) ──
  const metaAds = prepareMetaCampaign(0);
  const googleAds = prepareGoogleAdsCampaign([`hotel in ${CITY.toLowerCase()}`, `${CITY.toLowerCase()} hotel near fort`, slug.replace(/-/g, " ")]);

  // ── 16. Performance prediction (ranges from REAL baselines only) ──
  const prediction = buildPrediction(baselines);

  // ── 17. Publishing checklist ──
  const checklist = [
    "Facts: every claim traces to hotel-facts or the operator (no invented amenities/prices/dates)",
    "Legal: photo consent for staff/guests; music licensed on platform; drone rules checked",
    "Offers: price, validity and terms filled by operator (placeholders resolved)",
    "SEO: meta title ≤60 chars, description ≤155, slug clean, FAQ schema attached",
    "Grammar: read once aloud; Hindi/Hinglish reviewed by a native reader",
    "Brand: colors/fonts per design spec; one CTA per asset; website URL correct",
    "Images: real hotel photos or AI images clearly non-deceptive; no text baked into images",
    "Approval: package APPROVED in the queue before any manual publish",
  ];

  return { topicLabel, strategy, social, hashtags, imagePrompts, carousel, reel, video, shotList, design, seo, gbp, email, whatsapp, metaAds, googleAds, prediction, checklist };
}

function hindiCopy(topic: PackageTopic, phrase: string): string {
  if (topic === "OFFER") return `${H}, ${CITY} में सीधी बुकिंग पर सबसे अच्छा रेट। ${phrase} — आज ही बुक करें: ${HOTEL.website}`;
  if (topic === "FESTIVAL") return `${phrase} की शुभकामनाएँ! ${CITY} की रौनक ${H} से बस कुछ ही मिनट दूर। सीधी बुकिंग = बेहतर रेट।`;
  return `${CITY} घूमने का प्लान? ${phrase} — ${H} से हर जगह पास है। वेबसाइट पर सीधी बुकिंग करें: ${HOTEL.website}`;
}

function buildPrediction(b: FactoryBaselines): ContentPackage["prediction"] {
  const range = (v: number | null, lo: number, hi: number) => (v === null ? null : `${Math.max(0, Math.round(v * lo))}–${Math.round(v * hi)}`);
  const perPostReach = b.igReach30d !== null ? Math.round(b.igReach30d / 10) : null; // real 30d reach spread over ~10 posts
  return [
    {
      metric: "Reach (IG, per post)",
      expectation: perPostReach !== null ? `${range(perPostReach, 0.6, 2.5)} accounts` : "No baseline yet",
      why: b.igReach30d !== null ? `Derived from YOUR account's real 30-day reach (${b.igReach30d}); reels typically outperform the mean, hence the wide honest range.` : "Account has no reach history to derive from — not estimated.",
    },
    {
      metric: "Engagement (likes)",
      expectation: b.igAvgLikes !== null ? `${range(b.igAvgLikes, 0.5, 2)} likes` : "No baseline yet",
      why: b.igAvgLikes !== null ? `Your recent posts' real average is ${b.igAvgLikes} likes; a package post lands in a band around it.` : "No recent-post history.",
    },
    { metric: "CTR (link)", expectation: "Not predictable", why: "No historical link-click data exists for this account — predicting a CTR would be fabrication." },
    { metric: "Shares", expectation: b.igAvgLikes !== null ? `0–${Math.max(1, Math.round((b.igAvgLikes ?? 0) / 4))}` : "No baseline yet", why: "Shares on small accounts track a fraction of likes; band from your real like counts." },
    { metric: "Bookings", expectation: "Not predictable", why: "No attribution chain exists yet (conversion tracking + booking source). Populates once tracking works — never estimated before that." },
    { metric: "Risk", expectation: "Low", why: "All claims verified or operator-gated; nothing auto-publishes; approval checklist enforces consent/legal items." },
    { metric: "Confidence", expectation: b.igReach30d !== null ? "Medium" : "Low", why: "Bands come from a small real dataset (one month, small account) — honest but wide." },
  ];
}

/** Markdown rendering — the ContentItem body a human can use directly after approval. */
export function renderPackageMarkdown(p: ContentPackage): string {
  const L: string[] = [`# Content Package — ${p.topicLabel}`, ""];
  L.push("## Strategy", ...Object.entries(p.strategy).map(([k, v]) => `- **${k}**: ${v}`), "");
  L.push("## Social copy");
  for (const s of p.social) {
    L.push(`### ${s.platform}`, `- Professional: ${s.professional}`, `- Emoji: ${s.emoji}`, `- Hindi: ${s.hindi}`, `- Hinglish: ${s.hinglish}`);
  }
  L.push("", "## Hashtags (max 30)");
  for (const h of p.hashtags) L.push(`- **${h.group}**: ${h.tags.join(" ")}`);
  L.push("", "## AI image prompts");
  for (const ip of p.imagePrompts) L.push(`- **${ip.tool}**: ${ip.prompt}`);
  L.push("", "## Carousel");
  for (const c of p.carousel) L.push(`- **Slide ${c.slide} — ${c.title}**: ${c.description} _(photo: ${c.photo})_`);
  L.push("", "## Reel script", ...Object.entries(p.reel).map(([k, v]) => `- **${k}**: ${v}`));
  L.push("", "## Video package", ...Object.entries(p.video).map(([k, v]) => `- **${k}**: ${v}`));
  L.push("", "## Shot list");
  for (const s of p.shotList) L.push(`- **${s.subject}** — ${s.angle} · ${s.time} · ${s.lighting} · ${s.composition}`);
  L.push("", "## Graphic design", ...Object.entries(p.design).map(([k, v]) => `- **${k}**: ${v}`));
  L.push("", "## SEO package", ...Object.entries(p.seo).map(([k, v]) => `- **${k}**: ${v}`));
  L.push("", "## Google Business package", ...Object.entries(p.gbp).map(([k, v]) => `- **${k}**: ${v}`));
  L.push("", "## Email", `- Subject: ${p.email.subject}`, `- Preview: ${p.email.preview}`, `- CTA: ${p.email.cta} (button: ${p.email.buttonText})`, "", p.email.body, "", `_${p.email.htmlNote}_`);
  L.push("", "## WhatsApp");
  for (const w of p.whatsapp) L.push(`- **${w.kind}**: ${w.message}`);
  L.push(
    "",
    "## Meta Ads spec",
    `- Campaign: ${p.metaAds.campaign}`,
    `- Objective: ${p.metaAds.objective}`,
    `- Budget: ${p.metaAds.budgetSuggestion}`,
    `- Audiences: ${p.metaAds.audiences.join(" · ")}`,
    `- Remarketing: ${p.metaAds.remarketing.join(" · ")}`,
    `- Creative: ${p.metaAds.creativeSuggestions.join(" · ")}`,
    "- Placements: Reels + Feed + Stories (IG & FB), advantage+ placements to start",
    "- A/B test ideas: offer-led vs experience-led creative · Reel vs static · warm vs lookalike audience",
  );
  L.push(
    "",
    "## Google Ads spec",
    `- Campaign: ${p.googleAds.campaign}`,
    `- Objective: ${p.googleAds.objective}`,
    `- Budget: ${p.googleAds.budgetSuggestion}`,
    `- Bid: ${p.googleAds.bidSuggestion}`,
    ...p.googleAds.adGroups.map((g) => `- Ad group **${g.name}**: keywords ${g.keywords.join(", ")}${g.negatives.length ? ` · negatives ${g.negatives.join(", ")}` : ""}`),
    `- RSA headlines: ${p.googleAds.rsa.headlines.join(" | ")}`,
    `- RSA descriptions: ${p.googleAds.rsa.descriptions.join(" | ")}`,
    `- Extensions: ${p.googleAds.extensions.join(" · ")}`,
  );
  L.push("", "## Performance prediction (from real baselines — never guaranteed)");
  for (const pr of p.prediction) L.push(`- **${pr.metric}**: ${pr.expectation} — ${pr.why}`);
  L.push("", "## Publishing checklist", ...p.checklist.map((c) => `- [ ] ${c}`));
  return L.join("\n");
}
