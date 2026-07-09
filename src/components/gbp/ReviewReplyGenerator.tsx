"use client";

import { useState } from "react";
import { generateReviewReply } from "@/lib/gbp-content";
import type { GbpReviewItem } from "@/server/services/gbp.service";
import { Pill } from "@/components/ui/primitives";

/**
 * Review Reply Generator — deterministic, template-based drafts from verified
 * hotel facts. The operator copies the reply into GBP manually (auto-posting is
 * intentionally deferred). Works with live reviews when available, and with
 * manual paste-in when not.
 */
export function ReviewReplyGenerator({ liveReviews }: { liveReviews: GbpReviewItem[] }) {
  const [reviewer, setReviewer] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function generate(r: { reviewer: string; rating: number; comment: string }) {
    setReply(generateReviewReply(r));
    setCopied(false);
  }

  async function copy() {
    if (!reply) return;
    await navigator.clipboard.writeText(reply).catch(() => {});
    setCopied(true);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Input side */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-text">
          {liveReviews.length > 0 ? "Pick a live review or paste one" : "Paste a review"}
        </h3>

        {liveReviews.length > 0 && (
          <ul className="mb-4 max-h-56 space-y-2 overflow-y-auto pr-1">
            {liveReviews.slice(0, 10).map((r, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    setReviewer(r.reviewer);
                    setRating(r.rating);
                    setComment(r.comment);
                    generate({ reviewer: r.reviewer, rating: r.rating, comment: r.comment });
                  }}
                  className="w-full rounded-lg border border-border bg-bg/40 p-2.5 text-left text-xs transition-colors hover:border-brand/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text">{r.reviewer}</span>
                    <span className="flex items-center gap-2">
                      <Pill tone={r.rating >= 4 ? "ok" : r.rating === 3 ? "warn" : "crit"}>{r.rating}★</Pill>
                      {!r.replyComment && <Pill tone="warn">Unreplied</Pill>}
                    </span>
                  </div>
                  {r.comment && <p className="mt-1 line-clamp-2 text-muted">{r.comment}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3">
          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Reviewer name"
            className="w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Rating:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className={`h-8 w-8 rounded-lg border text-sm ${rating === n ? "border-brand bg-brand/20 text-text" : "border-border text-muted hover:text-text"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Review text (optional)"
            rows={4}
            className="w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none"
          />
          <button
            onClick={() => generate({ reviewer: reviewer || "Guest", rating, comment })}
            className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20"
          >
            Generate Reply
          </button>
        </div>
      </div>

      {/* Output side */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Reply draft</h3>
          {reply && (
            <button onClick={copy} className="rounded-lg border border-border px-3 py-1 text-xs text-muted transition-colors hover:text-text">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          )}
        </div>
        {reply ? (
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-bg/40 p-3 text-sm leading-relaxed text-text">{reply}</p>
        ) : (
          <p className="text-sm text-muted">Pick or paste a review, then generate. Drafts are template-based from verified hotel facts — review before publishing in GBP.</p>
        )}
        <p className="mt-3 text-[11px] text-muted">
          Publishing is manual by design (GBP write API deferred): copy the draft, open the review in Google Business Profile, and paste.
        </p>
      </div>
    </div>
  );
}
