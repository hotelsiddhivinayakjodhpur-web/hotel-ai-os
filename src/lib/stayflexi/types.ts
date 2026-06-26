/**
 * Types for Stayflexi request/response payloads.
 *
 * Stayflexi's docs only partially specify response shapes, so each interface
 * models the DOCUMENTED fields precisely and carries an index signature for the
 * undocumented remainder. This keeps call sites type-safe for known fields
 * without lying about exhaustiveness. Where a shape is entirely undocumented we
 * fall back to `Json`.
 */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Raw = Record<string, unknown>;

// ── Booking Engine ──────────────────────────────────────────────────────────

export interface GroupHotel {
  hotelId?: string | number;
  hotelName?: string;
  [k: string]: unknown;
}

export interface HotelContent {
  hotelId?: string | number;
  hotelName?: string;
  roomTypeList?: RoomType[];
  ratePlans?: RatePlan[];
  policyInfo?: Raw;
  [k: string]: unknown;
}

export interface RoomType {
  roomTypeId?: string | number;
  roomTypeName?: string;
  [k: string]: unknown;
}

export interface RatePlan {
  ratePlanId?: string | number;
  ratePlanName?: string;
  [k: string]: unknown;
}

/** hoteldetailadvanced — point-in-time availability + rates. priceMap keys like "2+1". */
export interface HotelDetailAdvanced {
  hotelId?: string | number;
  priceMap?: Record<string, unknown>;
  roomTypeList?: RoomType[];
  [k: string]: unknown;
}

/** hotelcalendar — inventory + rates + restrictions over a date range. */
export interface HotelCalendar {
  hotelId?: string | number;
  restrictionInfos?: RestrictionInfo[];
  [k: string]: unknown;
}

export interface RestrictionInfo {
  minLos?: number;
  maxLos?: number;
  closedOnArrival?: boolean;
  closedOnDeparture?: boolean;
  stopSell?: boolean;
  stopRTSell?: boolean;
  cutOff?: number;
  maxAdvancedOffset?: number;
  [k: string]: unknown;
}

// ── perform-booking ─────────────────────────────────────────────────────────

export interface RoomStay {
  numAdults: number;
  numChildren: number;
  numChildren1?: number;
  roomTypeId: string | number;
  ratePlanId: string | number;
  [k: string]: unknown;
}

export interface CustomerDetails {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  [k: string]: unknown;
}

export interface PaymentDetails {
  sellRate: number;
  roomRate: number;
  payAtHotel: boolean;
  [k: string]: unknown;
}

export interface PerformBookingRequest {
  /** "DD-MM-YYYY" */
  checkin: string;
  /** "DD-MM-YYYY" */
  checkout: string;
  hotelId: string | number;
  bookingStatus?: "CONFIRMED";
  bookingSource?: string;
  roomStays: RoomStay[];
  customerDetails: CustomerDetails;
  paymentDetails: PaymentDetails;
  isEnquiry?: boolean;
  isExternalPayment?: boolean;
  [k: string]: unknown;
}

export interface PerformBookingResponse {
  bookingId?: string;
  status?: boolean | string;
  message?: string;
  [k: string]: unknown;
}

export interface RecordExternalPaymentRequest {
  hotel_id: string | number;
  booking_id: string;
  booking_source?: string;
  module_source?: string;
  amount: number;
  currency?: string;
  payment_gateway_id?: string;
  pg_name?: string;
  requires_post_payment_confirmation?: string;
  status?: string;
  [k: string]: unknown;
}

export interface BookingInfo {
  bookingId?: string;
  bookingStatus?: string;
  arrivalStatus?: string;
  [k: string]: unknown;
}

// ── Channel Manager ─────────────────────────────────────────────────────────

/** Per-occupancy rate map. Keys "1".."4" = occupancy, "c" = child. */
export type OccupancyRateMap = { "1"?: number; "2"?: number; "3"?: number; "4"?: number; c?: number };

export interface UpdateRateItem {
  roomTypeId: string | number;
  ratePlanId: string | number;
  /** "dd-MM-yyyy" */
  fromDate: string;
  /** "dd-MM-yyyy" */
  toDate: string;
  currency?: string;
  roomRate: OccupancyRateMap;
}

export interface UpdateInventoryItem {
  roomTypeId: string | number;
  /** "dd-MM-yyyy" */
  fromDate: string;
  /** "dd-MM-yyyy" */
  toDate: string;
  roomCount: number;
}

export interface UpdateRestrictionItem {
  roomTypeId: string | number;
  ratePlanId?: string | number;
  fromDate: string;
  toDate: string;
  minLos?: number;
  maxLos?: number;
  closedOnArrival?: boolean;
  closedOnDeparture?: boolean;
  stopSell?: boolean;
  stopRTSell?: boolean;
  [k: string]: unknown;
}

export type CmBookingStatus = "CREATED" | "MODIFIED" | "CANCELLED";

export interface CmBookingSummary {
  bookingId?: string;
  bookingStatus?: CmBookingStatus;
  [k: string]: unknown;
}

export interface CmBookingDetail {
  bookingId?: string;
  channelBookingId?: string; // the OTA id
  bookingStatus?: CmBookingStatus;
  [k: string]: unknown;
}

// ── Webhook ─────────────────────────────────────────────────────────────────

export interface StayflexiWebhookPayload {
  bookingId?: string;
  bookingStatus?: CmBookingStatus;
  hotelId?: string | number;
  [k: string]: unknown;
}

export interface StayflexiWebhookAck {
  status: true;
  message: "Success";
}
