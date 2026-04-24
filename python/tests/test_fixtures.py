from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest

from canopy_ai import Canopy

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"


def load_fixtures() -> list[dict[str, Any]]:
    return [
        json.loads(p.read_text())
        for p in sorted(FIXTURES_DIR.glob("*.json"))
    ]


_CAMEL_TO_SNAKE = re.compile(r"(?<!^)(?=[A-Z])")


def camel_to_snake_keys(value: Any) -> Any:
    """Recursively convert camelCase keys to snake_case for parity with Python SDK output."""
    if isinstance(value, dict):
        return {
            _CAMEL_TO_SNAKE.sub("_", k).lower(): camel_to_snake_keys(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [camel_to_snake_keys(v) for v in value]
    return value


def subset_match(actual: Any, expected: Any, path: str = "") -> str | None:
    """Assert every key in `expected` is in `actual` with matching value."""
    if expected is None:
        if actual is not None:
            return f"{path}: expected None, got {actual!r}"
        return None
    if not isinstance(expected, (dict, list)):
        if actual != expected:
            return f"{path}: expected {expected!r}, got {actual!r}"
        return None
    if isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            return f"{path}: array length mismatch"
        for i, (a, e) in enumerate(zip(actual, expected, strict=True)):
            err = subset_match(a, e, f"{path}[{i}]")
            if err:
                return err
        return None
    if not isinstance(actual, dict):
        return f"{path}: expected dict, got {type(actual).__name__}"
    for k, v in expected.items():
        err = subset_match(actual.get(k), v, f"{path}.{k}" if path else k)
        if err:
            return err
    return None


@pytest.mark.parametrize("fixture", load_fixtures(), ids=lambda f: f["name"])
def test_fixture(fixture: dict[str, Any]) -> None:
    exchange = fixture["httpExchange"]
    call_index = {"i": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        i = call_index["i"]
        if i >= len(exchange):
            raise AssertionError(
                f"Unexpected extra request #{i + 1} to {request.method} {request.url}"
            )
        ex = exchange[i]
        call_index["i"] = i + 1

        assert request.method.upper() == ex["request"]["method"].upper()
        assert str(request.url) == ex["request"]["url"]

        expected_headers = ex["request"].get("headers") or {}
        for k, v in expected_headers.items():
            assert request.headers.get(k.lower()) == v, (
                f"Header {k} mismatch: expected {v!r}, got {request.headers.get(k.lower())!r}"
            )

        expected_body = ex["request"].get("bodyMatches")
        if expected_body:
            body = json.loads(request.content) if request.content else None
            err = subset_match(body, expected_body)
            if err:
                raise AssertionError(f"Body mismatch: {err}")

        return httpx.Response(
            status_code=ex["response"]["status"],
            json=ex["response"]["body"],
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)

    canopy = Canopy(
        api_key=fixture["config"]["apiKey"],
        agent_id=fixture["config"].get("agentId"),
        base_url=fixture["config"]["baseUrl"],
        http_client=client,
    )

    method = fixture["call"]["method"]
    args = fixture["call"]["args"]
    # Translate camelCase SDK args to snake_case kwargs.
    kwargs = {_CAMEL_TO_SNAKE.sub("_", k).lower(): v for k, v in args.items()}

    if method == "pay":
        result = canopy.pay(**kwargs)
    elif method == "preview":
        result = canopy.preview(**kwargs)
    else:
        raise AssertionError(f"Unknown call method: {method}")

    assert call_index["i"] == len(exchange), "SDK did not make all expected HTTP calls"

    expected_return = camel_to_snake_keys(fixture["expectedReturn"])
    err = subset_match(result, expected_return)
    if err:
        raise AssertionError(f"Return mismatch: {err}")
