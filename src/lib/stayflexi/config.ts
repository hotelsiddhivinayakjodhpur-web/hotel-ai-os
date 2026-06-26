import { env, requireEnv } from "@/lib/env";

/**
 * Stayflexi exposes TWO independent APIs with separate base hosts, auth scopes
 * and identifiers:
 *
 *   - Booking Engine (BE / SFCORE): auth = X-SF-API-KEY + `groupId`
 *   - Channel Manager (CM / PMS):   auth = X-SF-API-KEY + `pmsId`
 *
 * Both use a long-lived static `X-SF-API-KEY` header (no OAuth, no refresh).
 * Base URLs are configurable because the CM host is documented ambiguously
 * (prose: https://stayflexi.com, examples: http://beta.stayflexi.com).
 */
export const BE_PATHS = {
  // payments live under a different prefix on the same host
  paymentsPrefix: "/api/v2/payments",
  corePrefix: "/core/api/v1/beservice",
} as const;

export const CM_PATHS = {
  prefix: "/apiv1/cmservice",
} as const;

export interface BookingEngineConfig {
  baseUrl: string;
  apiKey: string;
  groupId: string;
}

export interface ChannelManagerConfig {
  baseUrl: string;
  apiKey: string;
  pmsId: string;
}

/** Build the BE config from env, throwing a clear error if creds are missing. */
export function bookingEngineConfig(): BookingEngineConfig {
  const e = requireEnv(
    ["STAYFLEXI_BE_API_KEY", "STAYFLEXI_GROUP_ID"],
    "Stayflexi Booking Engine",
  );
  return {
    baseUrl: env.STAYFLEXI_BE_BASE_URL.replace(/\/$/, ""),
    apiKey: e.STAYFLEXI_BE_API_KEY,
    groupId: e.STAYFLEXI_GROUP_ID,
  };
}

/** Build the CM config from env, throwing a clear error if creds are missing. */
export function channelManagerConfig(): ChannelManagerConfig {
  const e = requireEnv(
    ["STAYFLEXI_CM_API_KEY", "STAYFLEXI_PMS_ID"],
    "Stayflexi Channel Manager",
  );
  return {
    baseUrl: env.STAYFLEXI_CM_BASE_URL.replace(/\/$/, ""),
    apiKey: e.STAYFLEXI_CM_API_KEY,
    pmsId: e.STAYFLEXI_PMS_ID,
  };
}

/** The hotelId for Hotel Siddhi Vinayak (most calls need it explicitly). */
export function defaultHotelId(): string {
  const e = requireEnv(["STAYFLEXI_HOTEL_ID"], "Stayflexi hotel id");
  return e.STAYFLEXI_HOTEL_ID;
}
