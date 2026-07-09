/**
 * AI Prompt Library — curated, reusable prompts for when an LLM connection
 * (OpenAI / Claude / Gemini, managed in Settings) is used to draft content.
 * Static and deterministic; {placeholders} are filled by the operator.
 * The library itself makes no API calls.
 */
export interface PromptTemplate {
  id: string;
  title: string;
  department: "Blog" | "GBP" | "Instagram" | "Facebook" | "YouTube" | "Reviews" | "SEO";
  useCase: string;
  prompt: string;
}

export const PROMPT_LIBRARY: PromptTemplate[] = [
  {
    id: "blog-attraction",
    title: "Attraction blog post",
    department: "Blog",
    useCase: "Full SEO blog draft for a Jodhpur attraction",
    prompt:
      "You are writing for Hotel Siddhi Vinayak, a hotel in Jodhpur, Rajasthan (website: hotelsiddhi-vinayak.com). " +
      "Write a 900-word SEO blog post about {attraction} for the target keyword \"{keyword}\". " +
      "Use only widely verifiable facts; where specifics vary (timings, fees), tell the reader to check officially. " +
      "Structure: H1, intro, 3-4 H2 sections, a 'Where to stay' section mentioning the hotel naturally, and a 3-question FAQ. " +
      "Tone: helpful local expert, no hype. End with a direct-booking call to action.",
  },
  {
    id: "gbp-weekly",
    title: "GBP weekly post batch",
    department: "GBP",
    useCase: "7 Google Business posts in one go",
    prompt:
      "Create 7 Google Business Profile posts (max 1500 characters each) for Hotel Siddhi Vinayak, Jodhpur. " +
      "Mix: 2 direct-booking, 2 nearby attractions ({attractions}), 1 dining, 1 guest-hospitality, 1 seasonal. " +
      "Each needs a suggested CTA button (BOOK or LEARN_MORE) and must not invent prices, ratings or amenities.",
  },
  {
    id: "ig-month",
    title: "Instagram 30-day calendar",
    department: "Instagram",
    useCase: "Month of caption ideas",
    prompt:
      "Plan 30 Instagram posts for Hotel Siddhi Vinayak, Jodhpur ({month}). " +
      "For each: content idea (photo/reel the STAFF can realistically shoot on a phone), caption ≤150 words, 6 hashtags. " +
      "Themes: rooms, guest welcomes, Jodhpur attractions, food, festivals in {month}, direct booking. " +
      "No stock-photo ideas; no invented amenities.",
  },
  {
    id: "fb-festival",
    title: "Festival campaign",
    department: "Facebook",
    useCase: "Festival post series",
    prompt:
      "Write a 3-post Facebook series for {festival} (dates: {dates}) for Hotel Siddhi Vinayak, Jodhpur: " +
      "1) 2 weeks before (anticipation), 2) 3 days before (plan your stay), 3) festival day (celebration). " +
      "Warm, family tone. Include the website hotelsiddhi-vinayak.com. Do not invent events the hotel doesn't run.",
  },
  {
    id: "yt-short-script",
    title: "YouTube Short script",
    department: "YouTube",
    useCase: "30-second short script",
    prompt:
      "Script a 30-second YouTube Short: {topic} at/near Hotel Siddhi Vinayak, Jodhpur. " +
      "Format: 5 shots with on-screen text ≤6 words each + a spoken line. Hook in the first 2 seconds. " +
      "End card: 'Book direct — hotelsiddhi-vinayak.com'. Only shots a staff member can film on a phone.",
  },
  {
    id: "review-reply-tone",
    title: "Review reply (custom tone)",
    department: "Reviews",
    useCase: "Reply to a specific review",
    prompt:
      "Write a reply to this Google review of Hotel Siddhi Vinayak, Jodhpur:\n\nRating: {rating}/5\nReview: \"{review}\"\n\n" +
      "Rules: thank the guest by first name, address their specific points, no excuses, no discounts or compensation offers, " +
      "invite them back (or to contact the hotel via the website if negative). ≤120 words, warm professional hotelier voice.",
  },
  {
    id: "seo-meta",
    title: "Meta title + description",
    department: "SEO",
    useCase: "On-page meta for any page",
    prompt:
      "Write 3 options of meta title (≤60 chars) + meta description (≤155 chars) for this page of hotelsiddhi-vinayak.com: {pageTopic}. " +
      "Target keyword: {keyword}. Include the brand where natural. No clickbait, no invented claims (no star-ratings, no 'best').",
  },
  {
    id: "faq-schema",
    title: "FAQ answers from real queries",
    department: "SEO",
    useCase: "Answer real Search Console queries",
    prompt:
      "These are REAL Google queries our hotel site appeared for: {queries}. " +
      "For the 5 most useful, write FAQ entries (question + ≤80-word answer) for Hotel Siddhi Vinayak, Jodhpur. " +
      "Use only facts from the hotel website; where information is missing write [CONFIRM WITH HOTEL].",
  },
];
