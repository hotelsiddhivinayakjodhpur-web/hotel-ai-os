import type { Config } from "tailwindcss";

// Dark enterprise control-room palette (distinct from the public website).
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F19",
        panel: "#111726",
        border: "#1E2638",
        muted: "#8A93A6",
        text: "#E6EAF2",
        brand: { DEFAULT: "#C8A56A", dark: "#8B5E34" },
        ok: "#34D399",
        warn: "#FBBF24",
        crit: "#F87171",
        info: "#60A5FA",
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
