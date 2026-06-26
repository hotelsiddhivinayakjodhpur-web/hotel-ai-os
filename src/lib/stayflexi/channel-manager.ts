import { ChannelManagerConfig, CM_PATHS, channelManagerConfig } from "./config";
import { toDDMMYYYY } from "./dates";
import { StayflexiHttpClient } from "./http";
import type {
  CmBookingDetail,
  CmBookingSummary,
  OccupancyRateMap,
  Raw,
  UpdateInventoryItem,
  UpdateRateItem,
  UpdateRestrictionItem,
} from "./types";

/**
 * Channel Manager (PMS) service. Wraps every documented CM endpoint as a typed,
 * reusable method. Auth = X-SF-API-KEY header (injected by the http client) +
 * `pmsId` query param (added here per-call).
 *
 * Base: https://stayflexi.com (configurable — docs are ambiguous about the
 * production host; confirm with Stayflexi, then set STAYFLEXI_CM_BASE_URL).
 */
export class ChannelManagerService {
  private readonly http: StayflexiHttpClient;
  private readonly pmsId: string;

  constructor(cfg: ChannelManagerConfig = channelManagerConfig(), http?: StayflexiHttpClient) {
    this.pmsId = cfg.pmsId;
    this.http =
      http ??
      new StayflexiHttpClient({
        api: "channel-manager",
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
      });
  }

  private path(p: string): string {
    return `${CM_PATHS.prefix}${p}`;
  }

  // 1. List connected OTA channels.
  listChannels(hotelId: string | number) {
    return this.http.get<Raw>(this.path("/channels/"), { pmsId: this.pmsId, hotelId });
  }

  // 2. Read hotel detail (room types, rate plans).
  getHotelDetail(hotelId: string | number) {
    return this.http.get<Raw>(this.path("/gethoteldetail/"), { pmsId: this.pmsId, hotelId });
  }

  // 3. Read inventory (room counts) for a room type over a range.
  getRoomCount(args: {
    hotelId: string | number;
    roomTypeId: string | number;
    fromDate: string | Date;
    toDate: string | Date;
  }) {
    return this.http.get<Raw>(this.path("/getroomcount/"), {
      pmsId: this.pmsId,
      hotelId: args.hotelId,
      roomTypeId: args.roomTypeId,
      fromDate: toDDMMYYYY(args.fromDate),
      toDate: toDDMMYYYY(args.toDate),
    });
  }

  // 4. Read rates for a room type + rate plan over a range. Keys "1".."4","c".
  getRoomRates(args: {
    hotelId: string | number;
    roomTypeId: string | number;
    ratePlanId: string | number;
    fromDate: string | Date;
    toDate: string | Date;
  }) {
    return this.http.get<Raw>(this.path("/getroomrates/"), {
      pmsId: this.pmsId,
      hotelId: args.hotelId,
      roomTypeId: args.roomTypeId,
      ratePlanId: args.ratePlanId,
      fromDate: toDDMMYYYY(args.fromDate),
      toDate: toDDMMYYYY(args.toDate),
    });
  }

  // 5. Update rates. daysIncluded controls which weekdays the change applies to.
  updateRates(hotelId: string | number, items: UpdateRateItem[], daysIncluded = "1,2,3,4,5,6,7") {
    return this.http.post<Raw>(this.path("/rates/"), {
      query: { pmsId: this.pmsId, hotelId, daysIncluded },
      body: items,
    });
  }

  // 6. Update inventory (room counts).
  updateInventory(
    hotelId: string | number,
    items: UpdateInventoryItem[],
    daysIncluded = "1,2,3,4,5,6,7",
  ) {
    return this.http.post<Raw>(this.path("/inventory/"), {
      query: { pmsId: this.pmsId, hotelId, daysIncluded },
      body: items,
    });
  }

  // 7. Update restrictions (minLos, stopSell, CTA/CTD, etc.).
  updateRestrictions(
    hotelId: string | number,
    items: UpdateRestrictionItem[],
    daysIncluded = "1,2,3,4,5,6,7",
  ) {
    return this.http.post<Raw>(this.path("/sendrestriction/"), {
      query: { pmsId: this.pmsId, hotelId, daysIncluded },
      body: items,
    });
  }

  // 8. Read restrictions for a room type + rate plan over a range.
  getRestrictions(args: {
    hotelId: string | number;
    roomTypeId: string | number;
    ratePlanId: string | number;
    fromDate: string | Date;
    toDate: string | Date;
    channelName?: string;
  }) {
    return this.http.get<Raw>(this.path("/getrestriction/"), {
      pmsId: this.pmsId,
      hotelId: args.hotelId,
      roomTypeId: args.roomTypeId,
      ratePlanId: args.ratePlanId,
      fromDate: toDDMMYYYY(args.fromDate),
      toDate: toDDMMYYYY(args.toDate),
      channelName: args.channelName,
    });
  }

  // 9. Read the booking list (last 30 days). POST-but-read; no body.
  listBookings(hotelId: string | number) {
    return this.http.post<CmBookingSummary[] | Raw>(this.path("/bookinglist/"), {
      query: { pmsId: this.pmsId, hotelId },
    });
  }

  // 10. Read a booking's detail (incl. channelBookingId for OTA sync).
  getBookingDetail(hotelId: string | number, bookingId: string) {
    return this.http.get<CmBookingDetail>(this.path("/bookingdetail/"), {
      pmsId: this.pmsId,
      hotelId,
      bookingId,
    });
  }
}

/** Convenience: build a flat occupancy rate map for updateRates. */
export function rateMap(
  base: number,
  overrides: Partial<OccupancyRateMap> = {},
): OccupancyRateMap {
  return { "1": base, "2": base, "3": base, "4": base, ...overrides };
}
