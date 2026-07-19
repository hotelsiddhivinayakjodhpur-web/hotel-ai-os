import { governed } from "./api-governance";
import { logger } from "@/lib/logger";

/**
 * Jodhpur weather for the CEO Morning Brief — Open-Meteo (free, keyless, no
 * account). Read-only, degrades to null with a reason on any failure. The
 * travel/tourism notes are deterministic heuristics computed from the REAL
 * temperature/rain values and labeled as such — never fabricated observations.
 */
const log = logger.child({ component: "weather" });

const JODHPUR = { latitude: 26.2389, longitude: 73.0243 };

export interface JodhpurWeather {
  tempMaxC: number;
  tempMinC: number;
  rainChancePct: number;
  travelConditions: string; // heuristic from real values
  tourismImpact: string; // heuristic from real values
}

export async function getJodhpurWeather(): Promise<{ data: JodhpurWeather | null; reason?: string }> {
  try {
    const qs = new URLSearchParams({
      latitude: String(JODHPUR.latitude),
      longitude: String(JODHPUR.longitude),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "Asia/Kolkata",
      forecast_days: "1",
    });
    const res = await governed("weather", () => fetch(`https://api.open-meteo.com/v1/forecast?${qs}`, { next: { revalidate: 1800 } }), { label: "open-meteo:forecast" });
    if (!res.ok) {
      log.warn("weather_failed", { status: res.status });
      return { data: null, reason: `Weather service returned ${res.status}.` };
    }
    const d = (await res.json()) as {
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[] };
    };
    const tempMaxC = d.daily?.temperature_2m_max?.[0];
    const tempMinC = d.daily?.temperature_2m_min?.[0];
    const rainChancePct = d.daily?.precipitation_probability_max?.[0];
    if (tempMaxC === undefined || tempMinC === undefined || rainChancePct === undefined) {
      return { data: null, reason: "Weather service returned no daily values." };
    }

    const travelConditions =
      rainChancePct >= 60 ? "Rain likely — expect slower local travel" : tempMaxC >= 42 ? "Extreme heat — daytime travel uncomfortable" : "Good travel conditions";
    const tourismImpact =
      rainChancePct >= 60
        ? "Monsoon showers may reduce walk-in and sightseeing demand"
        : tempMaxC >= 42
          ? "Peak heat typically softens leisure demand; indoor amenities matter"
          : "Weather is favourable for sightseeing — normal to positive demand";

    return { data: { tempMaxC, tempMinC, rainChancePct, travelConditions, tourismImpact } };
  } catch (e) {
    log.warn("weather_error", { message: e instanceof Error ? e.message : String(e) });
    return { data: null, reason: "Weather service unreachable." };
  }
}
