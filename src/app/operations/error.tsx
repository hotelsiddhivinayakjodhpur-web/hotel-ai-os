"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState error={error} reset={reset} area="AI Operations" />;
}
