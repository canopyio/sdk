# SDK fixtures

Wire-level contract tests that both the TS and Python SDKs must pass.

## Schema

Each fixture is a JSON file with:

- `name` — short identifier, matches filename
- `description` — what this scenario exercises
- `config` — Canopy client config passed to the SDK
- `call` — the SDK method + args being tested
- `httpExchange[]` — ordered list of expected HTTP round-trips, each with:
  - `request` — method, url, and a **subset** of headers + body that must appear
  - `response` — status + body the mock transport returns
- `expectedReturn` — the structured return value the SDK should produce (camelCase; Python test runner translates to snake_case before comparison)
- `expectsThrow` (optional) — describes an expected thrown error instead of a return value

## Test runner contract

Both SDKs ship a fixture-replay runner that:

1. Instantiates the SDK with `config`.
2. Installs a mock HTTP transport seeded with `httpExchange`.
3. Invokes the SDK method in `call`.
4. Asserts each HTTP request the SDK sent matches the fixture's `request` subset.
5. Asserts the SDK's return value deep-equals `expectedReturn` (after language translation).

Adding a new scenario is: drop a JSON file in this directory, push — CI replays it in both languages.
