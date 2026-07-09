"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Read-only auto-refresh: re-runs the server component every `seconds`. */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
