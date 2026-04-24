import { CanopyApiError, CanopyNetworkError } from "./errors.js";

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  expectStatuses?: number[];
}

interface TransportResponse<T = unknown> {
  status: number;
  body: T;
}

/**
 * Thin HTTP wrapper. Callers pass a list of `expectStatuses` they know how to
 * handle (e.g. 200, 202, 403 for /api/sign) — anything outside that set
 * becomes a CanopyApiError. Network failures become CanopyNetworkError.
 */
export class Transport {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async request<T = unknown>(opts: RequestOptions): Promise<TransportResponse<T>> {
    const url = this.baseUrl.replace(/\/$/, "") + opts.path;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      ...(opts.headers ?? {}),
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: opts.method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      throw new CanopyNetworkError(`Network request to ${url} failed`, err);
    }

    let parsed: unknown = null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
    } else {
      try {
        parsed = await res.text();
      } catch {
        parsed = null;
      }
    }

    const allowed = opts.expectStatuses ?? [200];
    if (!allowed.includes(res.status)) {
      const message =
        (parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : null) ?? `Canopy API returned ${res.status}`;
      throw new CanopyApiError(res.status, message, parsed);
    }

    return { status: res.status, body: parsed as T };
  }
}
