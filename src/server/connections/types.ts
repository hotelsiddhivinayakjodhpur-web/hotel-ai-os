/**
 * Settings & Connections — shared types.
 *
 * This module is the SINGLE SOURCE OF TRUTH for every external connection the AI
 * OS uses. Credentials themselves live only in environment variables; the
 * registry describes each connection and where its credentials come from, and
 * the service computes live status. Future AI departments read connection state
 * and credentials exclusively through this module.
 */
export type ConnectionStatus =
  | "CONNECTED"
  | "DISCONNECTED"
  | "TOKEN_EXPIRED"
  | "WAITING"
  | "ERROR"
  | "APP_REVIEW"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED";

export type ConnectionCategory =
  | "Google"
  | "Meta"
  | "Booking"
  | "AI"
  | "Automation"
  | "Infrastructure";

/** An environment variable a connection depends on. */
export interface ConnectionEnvVar {
  key: string;
  secret: boolean; // true = never display the value anywhere
  label?: string;
}

/** Declarative definition of one connection (no credentials, no logic). */
export interface ConnectionDef {
  id: string; // stable key, e.g. "ga4"
  name: string;
  category: ConnectionCategory;
  icon: string; // emoji/glyph, dependency-free
  owner: string; // who owns/administers this connection
  description: string;
  docsUrl: string;
  env: ConnectionEnvVar[]; // required credentials (all must be present to be configured)
  optionalEnv?: ConnectionEnvVar[]; // nice-to-have
  testable: boolean; // whether a live Test Connection is implemented
  /** Platforms that require provider app-review before they can go live. */
  requiresAppReview?: boolean;
}

/** Result of a live Test Connection. */
export interface ConnectionTestResult {
  status: ConnectionStatus;
  ok: boolean;
  detail?: string;
  error?: string;
}

/** Fully-resolved view of a connection for the Settings UI + consumers. */
export interface ConnectionView {
  id: string;
  name: string;
  category: ConnectionCategory;
  icon: string;
  owner: string;
  description: string;
  docsUrl: string;
  status: ConnectionStatus;
  configured: boolean; // all required env present
  enabled: boolean; // user hasn't Disconnected it
  testable: boolean;
  envKeys: { key: string; present: boolean; secret: boolean }[];
  lastSyncAt: string | null;
  lastTestAt: string | null;
  lastError: string | null;
}
