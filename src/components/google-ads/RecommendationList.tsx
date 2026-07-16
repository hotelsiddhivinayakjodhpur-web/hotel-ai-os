import { Card, Pill } from "@/components/ui/primitives";
import type { AdsRecommendation } from "@/server/services/google-ads.service";

/** Priority → Pill tone. Single source for the Google Ads recommendation colouring. */
export function priorityTone(priority: AdsRecommendation["priority"]): "crit" | "warn" | "muted" {
  return priority === "high" ? "crit" : priority === "medium" ? "warn" : "muted";
}

/**
 * Shared recommendation/alert card grid used across the Google Ads dashboards
 * (dashboard AI recs + budget alerts, keyword recs). Behaviour-identical to the
 * per-page blocks it replaces — one place to maintain the layout + tone mapping.
 */
export function RecommendationList({ items }: { items: AdsRecommendation[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((r, i) => (
        <Card key={i}>
          <div className="flex items-start gap-3">
            <Pill tone={priorityTone(r.priority)}>{r.priority}</Pill>
            <div>
              <div className="text-sm font-medium text-text">{r.title}</div>
              <div className="text-xs text-muted">{r.detail}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
