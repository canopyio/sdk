import re
from decimal import Decimal

# USDC contract on Base mainnet (chain 8453).
USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
USDC_DECIMALS = 6

_ERC20_TRANSFER_SELECTOR = "0xa9059cbb"
_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def encode_erc20_transfer(to: str, amount: int) -> str:
    """Builds the `data` field for an ERC-20 transfer(to, amount) call."""
    if not _ADDRESS_RE.match(to):
        raise ValueError(f"Invalid address: {to}")
    if amount < 0:
        raise ValueError(f"Amount must be non-negative: {amount}")
    address_padded = to[2:].lower().rjust(64, "0")
    amount_padded = f"{amount:x}".rjust(64, "0")
    return f"{_ERC20_TRANSFER_SELECTOR}{address_padded}{amount_padded}"


def usd_to_usdc_units(usd: float) -> int:
    """Converts a USD float to USDC base units (6 decimals)."""
    if usd < 0:
        raise ValueError(f"Invalid USD amount: {usd}")
    # Use Decimal to avoid float rounding errors.
    units = (Decimal(str(usd)) * (10**USDC_DECIMALS)).quantize(Decimal("1"))
    return int(units)


def is_entity_slug(to: str) -> bool:
    """Anything not matching the `0x…` address format is treated as an entity slug."""
    return _ADDRESS_RE.match(to) is None
