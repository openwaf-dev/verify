/**
 * OpenWAF Verify siteverify client for Node.js (>= 18).
 *
 * Validates OpenWAF Verify tokens on your server. Zero runtime dependencies:
 * uses the global `fetch` and `AbortSignal.timeout`.
 */

import { randomUUID } from "node:crypto";

export const VERSION = "0.1.0";

/** Default siteverify endpoint (control plane). */
export const DEFAULT_ENDPOINT = "https://dash.openwaf.dev/v1/challenge/siteverify";

/** Default request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Maximum token length in bytes accepted by the server. */
export const MAX_TOKEN_BYTES = 2048;

/** Maximum idempotency key length in characters. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/** Test secrets: work everywhere and never spend anything. */
export const TEST_SECRETS = Object.freeze({
  /** Any non-empty response succeeds (`metadata.resultWithTestingKey: true`, hostname `example.com`). */
  pass: "ows_test_pass",
  /** Always fails with `invalid-input-response`. */
  fail: "ows_test_fail",
  /** Always fails with `timeout-or-duplicate`. */
  spent: "ows_test_spent",
} as const);

/** Test sitekeys for the browser widget. */
export const TEST_SITEKEYS = Object.freeze({
  /** Always passes, producing {@link TEST_TOKEN}. */
  pass: "owk_test_pass",
  /** Always fails with the widget error `test-fail`. */
  fail: "owk_test_fail",
  /** Shows a checkbox, then produces {@link TEST_TOKEN}. */
  interactive: "owk_test_interactive",
} as const);

/** Token produced by the passing test sitekeys. */
export const TEST_TOKEN = "v1.TEST.TOKEN";

/** Error codes returned by the server. */
export type ServerErrorCode =
  | "missing-input-secret"
  | "invalid-input-secret"
  | "missing-input-response"
  | "invalid-input-response"
  | "timeout-or-duplicate"
  | "remoteip-mismatch"
  | "bad-request"
  | "rate-limited"
  | "internal-error";

/** Error codes added by this library (never sent by the server). */
export type ClientErrorCode = "hostname-mismatch" | "action-mismatch";

/** Any error code; unknown future server codes are passed through as strings. */
export type ErrorCode = ServerErrorCode | ClientErrorCode | (string & {});

export interface SiteverifyMetadata {
  mode?: string;
  interactive?: boolean;
  risk?: "low" | "high" | (string & {});
  /** Present (true) only when a test secret was used. */
  resultWithTestingKey?: boolean;
}

export interface SiteverifyResponse {
  success: boolean;
  /** RFC 3339 timestamp of the challenge (on success). */
  challengeTs?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  errorCodes: ErrorCode[];
  metadata?: SiteverifyMetadata;
  /** Seconds to wait before retrying (HTTP 429 only). */
  retryAfter?: number;
  /** HTTP status of the answer; 0 when short-circuited locally. */
  status: number;
  /** The raw JSON body as received (undefined when short-circuited locally). */
  raw?: unknown;
}

export interface SiteverifyClientOptions {
  /** Secret key (`ows_…`). Required. */
  secret: string;
  /** Siteverify URL. Defaults to {@link DEFAULT_ENDPOINT}. */
  endpoint?: string;
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number;
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** User-Agent header. Defaults to `openwaf-verify-node/<version>`. */
  userAgent?: string;
}

export interface VerifyOptions {
  /** Visitor IP address, checked against the one that solved the challenge. */
  remoteIp?: string;
  /** Reuse the same key when retrying after a timeout (see {@link newIdempotencyKey}). */
  idempotencyKey?: string;
  /** If set, a successful answer for another hostname becomes `hostname-mismatch`. */
  expectedHostname?: string;
  /** If set, a successful answer for another action becomes `action-mismatch`. */
  expectedAction?: string;
  /** Optional caller abort signal, combined with the timeout. */
  signal?: AbortSignal;
}

export type SiteverifyErrorCode = "config" | "timeout" | "network" | "http" | "bad-response";

/** Transport or configuration failure. Never contains the secret. */
export class SiteverifyError extends Error {
  readonly code: SiteverifyErrorCode;
  /** HTTP status, when a response was received. */
  readonly status?: number;

  constructor(code: SiteverifyErrorCode, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SiteverifyError";
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
  }
}

/** Returns a new random idempotency key (UUID v4). */
export function newIdempotencyKey(): string {
  return randomUUID();
}

// Statuses whose JSON body is a siteverify answer; anything else is a transport error.
const ANSWER_STATUSES: Record<number, true> = { 200: true, 400: true, 405: true, 429: true };
const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

export class SiteverifyClient {
  readonly #secret: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly userAgent: string;
  readonly #fetch: typeof fetch;

  constructor(options: SiteverifyClientOptions) {
    if (!options || typeof options.secret !== "string" || options.secret === "") {
      throw new SiteverifyError("config", "OpenWAF Verify: secret is required");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new SiteverifyError("config", "OpenWAF Verify: timeoutMs must be a positive number");
    }
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new SiteverifyError("config", "OpenWAF Verify: no fetch implementation available");
    }
    this.#secret = options.secret;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = timeoutMs;
    this.userAgent = options.userAgent ?? `openwaf-verify-node/${VERSION}`;
    this.#fetch = f;
  }

  /** Verifies a token. Resolves with the decision; rejects with {@link SiteverifyError} on transport failures. */
  async verify(token: string, options: VerifyOptions = {}): Promise<SiteverifyResponse> {
    if (typeof token !== "string" || token === "") {
      return localFailure("missing-input-response");
    }
    if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) {
      return localFailure("invalid-input-response");
    }

    const body = new URLSearchParams();
    body.set("secret", this.#secret);
    body.set("response", token);
    if (options.remoteIp) body.set("remoteip", options.remoteIp);
    if (options.idempotencyKey) {
      if (options.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        throw new SiteverifyError("config", `OpenWAF Verify: idempotencyKey longer than ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
      }
      body.set("idempotency_key", options.idempotencyKey);
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? anySignal([timeout, options.signal]) : timeout;

    let res: Response;
    let text: string;
    try {
      res = await this.#fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          "user-agent": this.userAgent,
        },
        body: body.toString(),
        signal,
        redirect: "error",
      });
      text = await res.text();
    } catch (err) {
      if (timeout.aborted) {
        throw new SiteverifyError("timeout", `OpenWAF Verify: siteverify timed out after ${this.timeoutMs} ms`);
      }
      throw new SiteverifyError("network", `OpenWAF Verify: siteverify request failed: ${errorName(err)}`, { cause: sanitize(err) });
    }

    if (!ANSWER_STATUSES[res.status]) {
      throw new SiteverifyError("http", `OpenWAF Verify: unexpected HTTP status ${res.status}`, { status: res.status });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new SiteverifyError("bad-response", `OpenWAF Verify: non-JSON answer (HTTP ${res.status})`, { status: res.status });
    }
    if (!isRecord(raw) || !Array.isArray(raw["error-codes"]) || (res.status === 200 && typeof raw.success !== "boolean")) {
      throw new SiteverifyError("bad-response", `OpenWAF Verify: malformed answer (HTTP ${res.status})`, { status: res.status });
    }

    const out: SiteverifyResponse = {
      success: res.status === 200 && raw.success === true,
      errorCodes: raw["error-codes"].filter((c): c is string => typeof c === "string"),
      status: res.status,
      raw,
    };
    if (typeof raw.challenge_ts === "string") out.challengeTs = raw.challenge_ts;
    if (typeof raw.hostname === "string") out.hostname = raw.hostname;
    if (typeof raw.action === "string") out.action = raw.action;
    if (typeof raw.cdata === "string") out.cdata = raw.cdata;
    if (isRecord(raw.metadata)) {
      const m = raw.metadata;
      const md: SiteverifyMetadata = {};
      if (typeof m.mode === "string") md.mode = m.mode;
      if (typeof m.interactive === "boolean") md.interactive = m.interactive;
      if (typeof m.risk === "string") md.risk = m.risk;
      if (typeof m.result_with_testing_key === "boolean") md.resultWithTestingKey = m.result_with_testing_key;
      out.metadata = md;
    }
    if (res.status === 429) {
      const ra = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      if (Number.isFinite(ra) && ra >= 0) out.retryAfter = ra;
    }

    if (out.success) {
      if (options.expectedHostname !== undefined && out.hostname !== options.expectedHostname) {
        out.success = false;
        out.errorCodes.push("hostname-mismatch");
      }
      if (options.expectedAction !== undefined && out.action !== options.expectedAction) {
        out.success = false;
        out.errorCodes.push("action-mismatch");
      }
    }
    return out;
  }

  toJSON(): Record<string, unknown> {
    return { endpoint: this.endpoint, timeoutMs: this.timeoutMs, userAgent: this.userAgent, secret: "[redacted]" };
  }

  toString(): string {
    return `SiteverifyClient(${this.endpoint})`;
  }

  [inspectSymbol](): string {
    return `SiteverifyClient { endpoint: '${this.endpoint}', timeoutMs: ${this.timeoutMs}, secret: '[redacted]' }`;
  }
}

function localFailure(code: ServerErrorCode): SiteverifyResponse {
  return { success: false, errorCodes: [code], status: 0 };
}

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorName(err: unknown): string {
  const cause = err instanceof Error && "cause" in err ? err.cause : undefined;
  if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") return cause.code;
  return err instanceof Error ? err.name : "unknown error";
}

// Fetch errors never include the request body, but keep only safe fields anyway.
function sanitize(err: unknown): unknown {
  if (!(err instanceof Error)) return undefined;
  const e = new Error(err.message);
  e.name = err.name;
  return e;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  // AbortSignal.any exists from Node 20.3; Node 18 uses the manual fallback below.
  if ("any" in AbortSignal && typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
