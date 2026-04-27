import { CanopyApiError, CanopyNetworkError } from "./errors.js";
import { agentsUrl, apiKeysUrl } from "./dashboard-urls.js";

const SDK_VERSION = "0.0.1";
const RUNTIME_BANNER = (() => {
  const v = typeof process !== "undefined" ? process.versions?.node : undefined;
  return v ? `node/${v.split(".")[0]}` : "unknown";
})();
const USER_AGENT = `@canopy-ai/sdk/${SDK_VERSION} ${RUNTIME_BANNER}`;

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
      "user-agent": USER_AGENT,
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
      const apiMessage =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : null;
      const dashboardUrl = this.dashboardUrlFor(res.status, opts.path);
      const baseMessage = apiMessage ?? `Canopy API returned ${res.status}`;
      const message = dashboardUrl ? `${baseMessage}. See ${dashboardUrl}` : baseMessage;
      throw new CanopyApiError(res.status, message, parsed, dashboardUrl);
    }

    return { status: res.status, body: parsed as T };
  }

  private dashboardUrlFor(status: number, path: string): string | undefined {
    if (status === 401) return apiKeysUrl(this.baseUrl);
    if (status === 403) return apiKeysUrl(this.baseUrl);
    if (status === 404 && path.includes("/agents")) return agentsUrl(this.baseUrl);
    return undefined;
  }
}
