/**
 * Stayflexi SDK — single import surface.
 *
 *   import { stayflexi } from "@/lib/stayflexi";
 *   const hotels = await stayflexi.bookingEngine().listGroupHotels();
 *   const bookings = await stayflexi.channelManager().listBookings(hotelId);
 *
 * Services are constructed lazily (and memoised) so importing this module never
 * throws on a missing credential — it only throws when you actually call an API
 * whose env isn't configured.
 */
export * from "./types";
export * from "./errors";
export { BookingEngineService } from "./booking-engine";
export { ChannelManagerService, rateMap } from "./channel-manager";
export { defaultHotelId } from "./config";
export * as sfDates from "./dates";

import { BookingEngineService } from "./booking-engine";
import { ChannelManagerService } from "./channel-manager";

let _be: BookingEngineService | undefined;
let _cm: ChannelManagerService | undefined;

export const stayflexi = {
  /** Booking Engine (groupId + key). Memoised after first use. */
  bookingEngine(): BookingEngineService {
    return (_be ??= new BookingEngineService());
  },
  /** Channel Manager (pmsId + key). Memoised after first use. */
  channelManager(): ChannelManagerService {
    return (_cm ??= new ChannelManagerService());
  },
  /** Reset memoised clients (tests / credential rotation). */
  _reset() {
    _be = undefined;
    _cm = undefined;
  },
};
