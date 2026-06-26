import { BookingEngineConfig, BE_PATHS, bookingEngineConfig } from "./config";
import { toDDMMYYYY, toDDMMYYYYHms } from "./dates";
import { StayflexiHttpClient } from "./http";
import type {
  BookingInfo,
  GroupHotel,
  HotelCalendar,
  HotelContent,
  HotelDetailAdvanced,
  PerformBookingRequest,
  PerformBookingResponse,
  Raw,
  RecordExternalPaymentRequest,
} from "./types";

/**
 * Booking Engine (SFCORE) service. Wraps every documented BE endpoint as a
 * typed, reusable method. Auth = X-SF-API-KEY header (injected by the http
 * client) + `groupId` query param (added here per-call).
 *
 * Base: https://api.stayflexi.com  (configurable via STAYFLEXI_BE_BASE_URL)
 */
export class BookingEngineService {
  private readonly http: StayflexiHttpClient;
  private readonly groupId: string;

  constructor(cfg: BookingEngineConfig = bookingEngineConfig(), http?: StayflexiHttpClient) {
    this.groupId = cfg.groupId;
    this.http =
      http ??
      new StayflexiHttpClient({
        api: "booking-engine",
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
      });
  }

  private core(path: string): string {
    return `${BE_PATHS.corePrefix}${path}`;
  }

  // 1. List hotels in the group.
  listGroupHotels() {
    return this.http.get<GroupHotel[] | Raw>(this.core("/grouphotels"), {
      groupId: this.groupId,
    });
  }

  // 2. List the group's locations.
  listGroupLocations() {
    return this.http.get<Raw>(this.core("/groupLocations"), { groupId: this.groupId });
  }

  // 3. List group hotels filtered by location.
  listGroupHotelsByLocation(location: string) {
    return this.http.get<GroupHotel[] | Raw>(this.core("/grouphotelsbylocation"), {
      groupId: this.groupId,
      location,
    });
  }

  // 4. Read hotel content (room types, rate plans, policies).
  getHotelContent(hotelId: string | number) {
    return this.http.get<HotelContent>(this.core("/hotelcontent"), { hotelId });
  }

  // 5. Hotel check-in list for a date.
  getHotelCheckin(hotelId: string | number, date: string | Date) {
    return this.http.get<Raw>(this.core("/hotelcheckin/"), {
      hotelId,
      date: toDDMMYYYY(date),
    });
  }

  // 6. Hotel check-out list for a date.
  getHotelCheckout(hotelId: string | number, date: string | Date) {
    return this.http.get<Raw>(this.core("/hotelcheckout/"), {
      hotelId,
      date: toDDMMYYYY(date),
    });
  }

  // 7. Point-in-time availability + rates for a stay. dates "DD-MM-YYYY HH:MM:ss".
  getAvailabilityAndRates(args: {
    hotelId: string | number;
    checkin: string | Date;
    checkout: string | Date;
    discount?: number;
  }) {
    return this.http.get<HotelDetailAdvanced>(this.core("/hoteldetailadvanced"), {
      hotelId: args.hotelId,
      checkin: toDDMMYYYYHms(args.checkin),
      checkout: toDDMMYYYYHms(args.checkout),
      discount: args.discount ?? 0,
    });
  }

  // 8. Calendar: inventory + rates + restrictions over a range.
  getCalendar(args: { hotelId: string | number; fromDate: string | Date; toDate: string | Date }) {
    return this.http.get<HotelCalendar>(this.core("/hotelcalendar/"), {
      hotelId: args.hotelId,
      fromDate: toDDMMYYYY(args.fromDate),
      toDate: toDDMMYYYY(args.toDate),
    });
  }

  // 9. Create a booking. Caller passes checkin/checkout as Date|"YYYY-MM-DD";
  //    we normalise to the "DD-MM-YYYY" the endpoint expects.
  createBooking(
    req: Omit<PerformBookingRequest, "checkin" | "checkout"> & {
      checkin: string | Date;
      checkout: string | Date;
    },
  ) {
    // The index signature on PerformBookingRequest makes object-spread lose the
    // named required props at the type level, so we assert the assembled shape
    // (it carries every required field at runtime via `...rest`).
    const { bookingSource, ...rest } = req;
    const body = {
      ...rest,
      checkin: toDDMMYYYY(req.checkin),
      checkout: toDDMMYYYY(req.checkout),
      bookingStatus: "CONFIRMED" as const,
      bookingSource: typeof bookingSource === "string" ? bookingSource : "STAYFLEXI_OD",
    } as PerformBookingRequest;
    return this.http.post<PerformBookingResponse>(this.core("/perform-booking"), { body });
  }

  // 10. Record an external payment to confirm a pay-now booking.
  //     NOTE: this endpoint is UNAUTHENTICATED (no X-SF-API-KEY) and lives under
  //     the /api/v2/payments prefix.
  recordExternalPayment(req: RecordExternalPaymentRequest) {
    const body: RecordExternalPaymentRequest = {
      booking_source: "CUSTOM_BE",
      module_source: "CUSTOM_BE_PAYMENT",
      currency: "INR",
      pg_name: "RAZORPAY",
      requires_post_payment_confirmation: "true",
      status: "SUCCESS",
      ...req,
    };
    return this.http.post<Raw>(`${BE_PATHS.paymentsPrefix}/recordExternalPayment/`, {
      body,
      noAuth: true,
    });
  }

  // 11. Build the hosted payment-gateway redirect URL (no request — returns the URL).
  paymentRedirectUrl(args: {
    bookingId: string;
    hotelId: string | number;
    redirectUrl: string;
    cancelUrl: string;
    gatewayBaseUrl?: string;
  }): string {
    const base = (args.gatewayBaseUrl ?? "https://bookingengine.stayflexi.com").replace(/\/$/, "");
    const u = new URL(`${base}/redirect-payment-gateway/${args.bookingId}`);
    u.searchParams.set("hotel_id", String(args.hotelId));
    u.searchParams.set("redirect_url", args.redirectUrl);
    u.searchParams.set("cancel_url", args.cancelUrl);
    return u.toString();
  }

  // 12. Read a booking's info/status.
  getBookingInfo(bookingId: string) {
    return this.http.get<BookingInfo>(this.core("/bookinginfo"), { bookingId });
  }

  // 13. Cancel a booking.
  cancelBooking(bookingId: string) {
    return this.http.get<Raw>(this.core("/bookingcancellation"), { bookingId });
  }
}
