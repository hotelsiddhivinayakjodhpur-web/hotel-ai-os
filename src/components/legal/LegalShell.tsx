import type { ReactNode } from "react";

/** Readable, centered container for legal pages (Privacy / Terms). */
export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl py-4">
      <h1 className="text-2xl font-semibold text-text">{title}</h1>
      <p className="mt-1 text-xs text-muted">Last updated: {updated}</p>
      <div className="legal mt-6 space-y-6 text-sm leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-text">{heading}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
