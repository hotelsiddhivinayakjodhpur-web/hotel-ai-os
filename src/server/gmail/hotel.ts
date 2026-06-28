import { env } from "@/lib/env";

/**
 * The hotel id everything in the data layer keys on. Stayflexi's reports are for
 * Hotel Siddhi Vinayak (property 29355), so that is the real default until a
 * different STAYFLEXI_HOTEL_ID is configured. Ingestion writes and the data
 * provider reads under this same id.
 */
export function hotelId(): string {
  return env.STAYFLEXI_HOTEL_ID ?? "29355";
}
