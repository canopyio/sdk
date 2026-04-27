import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Canopy } from "../src/index.js";

interface Fixture {
  name: string;
  description: string;
  config: { apiKey: string; agentId?: string; baseUrl: string };
  call:
    | { method: "pay" | "preview"; args: Record<string, unknown> }
    | { method: "fetch"; args: { url: string; init?: { method?: string; body?: string } } };
  httpExchange: Array<{
    request: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      bodyMatches?: Record<string, unknown>;
    };
    response: {
      status: number;
      headers?: Record<string, string>;
      body: unknown;
    };
  }>;
  expectedReturn?: Record<string, unknown>;
  expectedFetch?: { status: number; bodyEquals?: unknown; headersInclude?: Record<string, string> };
  expectedThrow?: { name: string; messageIncludes?: string };
}

function loadFixtures(): Fixture[] {
  const dir = join(__dirname, "..", "..", "shared", "fixtures");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture);
}

/**
 * Deep subset match: every key in `expected` must exist in `actual` with the
 * same value. Extra keys in `actual` are allowed.
 */
function matchSubset(actual: unknown, expected: unknown, path = ""): string | null {
  if (expected === null || expected === undefined) {
    if (actual !== expected) return `${path}: expected ${expected}, got ${JSON.stringify(actual)}`;
    return null;
  }
  if (typeof expected !== "object") {
    if (actual !== expected) {
      return `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    }
    return null;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return `${path}: array length mismatch`;
    }
    for (let i = 0; i < expected.length; i++) {
      const err = matchSubset(actual[i], expected[i], `${path}[${i}]`);
      if (err) return err;
    }
    return null;
  }
  if (typeof actual !== "object" || actual === null) {
    return `${path}: expected object, got ${typeof actual}`;
  }
  for (const [k, v] of Object.entries(expected)) {
    const err = matchSubset((actual as Record<string, unknown>)[k], v, path ? `${path}.${k}` : k);
    if (err) return err;
  }
  return null;
}

describe("fixture replay", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Each test installs its own mock; this just ensures we start clean.
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const fixture of loadFixtures()) {
    it(fixture.name, async () => {
      let callIndex = 0;
      const actualRequests: unknown[] = [];

      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input as URL | Request).toString();
        const method = init?.method ?? "GET";
        let body: unknown = null;
        if (init?.body) {
          try {
            body = JSON.parse(init.body as string);
          } catch {
            body = init.body;
          }
        }
        const headers: Record<string, string> = {};
        const h = init?.headers;
        if (h) {
          if (h instanceof Headers) {
            h.forEach((v, k) => (headers[k.toLowerCase()] = v));
          } else if (Array.isArray(h)) {
            for (const [k, v] of h) headers[k.toLowerCase()] = v;
          } else {
            for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v as string;
          }
        }

        actualRequests.push({ method, url, headers, body });

        const exchange = fixture.httpExchange[callIndex];
        if (!exchange) {
          throw new Error(
            `Fixture ${fixture.name}: unexpected extra request #${callIndex + 1} to ${method} ${url}`,
          );
        }
        callIndex++;

        // Validate actual matches expected
        expect(method.toUpperCase()).toBe(exchange.request.method.toUpperCase());
        expect(url).toBe(exchange.request.url);
        if (exchange.request.headers) {
          for (const [k, v] of Object.entries(exchange.request.headers)) {
            expect(headers[k.toLowerCase()]).toBe(v);
          }
        }
        if (exchange.request.bodyMatches) {
          const err = matchSubset(body, exchange.request.bodyMatches);
          if (err) throw new Error(`Body mismatch: ${err}`);
        }

        const respHeaders: Record<string, string> = {
          "content-type": "application/json",
          ...(exchange.response.headers ?? {}),
        };
        return new Response(JSON.stringify(exchange.response.body), {
          status: exchange.response.status,
          headers: respHeaders,
        });
      }) as typeof fetch;

      const canopy = new Canopy(fixture.config);

      let threw: Error | null = null;
      let payResult: unknown = undefined;
      let fetchResult: Response | undefined = undefined;

      try {
        if (fixture.call.method === "pay") {
          payResult = await canopy.pay(fixture.call.args as Parameters<typeof canopy.pay>[0]);
        } else if (fixture.call.method === "preview") {
          payResult = await canopy.preview(
            fixture.call.args as Parameters<typeof canopy.preview>[0],
          );
        } else if (fixture.call.method === "fetch") {
          const args = fixture.call.args as { url: string; init?: RequestInit };
          fetchResult = await canopy.fetch(args.url, args.init);
        } else {
          throw new Error(`Fixture ${fixture.name}: unknown call method`);
        }
      } catch (e) {
        threw = e as Error;
      }

      if (fixture.expectedThrow) {
        if (!threw) throw new Error(`Fixture ${fixture.name}: expected throw, none occurred`);
        expect(threw.name).toBe(fixture.expectedThrow.name);
        if (fixture.expectedThrow.messageIncludes) {
          expect(threw.message).toContain(fixture.expectedThrow.messageIncludes);
        }
        return;
      }
      if (threw) throw threw;

      expect(callIndex).toBe(fixture.httpExchange.length);

      if (fixture.expectedReturn) {
        const err = matchSubset(payResult, fixture.expectedReturn);
        if (err) throw new Error(`Return mismatch: ${err}`);
      }
      if (fixture.expectedFetch && fetchResult) {
        expect(fetchResult.status).toBe(fixture.expectedFetch.status);
        if (fixture.expectedFetch.bodyEquals !== undefined) {
          const bodyText = await fetchResult.text();
          let parsed: unknown = bodyText;
          try {
            parsed = JSON.parse(bodyText);
          } catch {
            // keep as text
          }
          const err = matchSubset(parsed, fixture.expectedFetch.bodyEquals);
          if (err) throw new Error(`Fetch body mismatch: ${err}`);
        }
      }
    });
  }
});
