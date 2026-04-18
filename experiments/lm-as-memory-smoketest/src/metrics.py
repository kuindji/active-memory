from __future__ import annotations
import json
from pathlib import Path


def contains_any(response: str, answer_keys: list[str]) -> bool:
    low = response.lower()
    return any(key.lower() in low for key in answer_keys)


def load_probes(path: str | Path) -> list[dict]:
    out: list[dict] = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line))
    return out


def score_probes(probes: list[dict], responses: list[str]) -> tuple[float, list[bool]]:
    assert len(probes) == len(responses)
    hits = [contains_any(r, p["answer_keys"]) for p, r in zip(probes, responses)]
    rate = sum(hits) / len(hits) if hits else 0.0
    return rate, hits


def retention_delta(
    base_hits: list[bool], adapter_hits: list[bool]
) -> tuple[float, int, int]:
    """Fraction of base-correct probes that are NO LONGER correct with adapter loaded.

    Returns (regression_rate, originally_correct, still_correct).
    """
    originally = sum(base_hits)
    if originally == 0:
        return 0.0, 0, 0
    still = sum(1 for b, a in zip(base_hits, adapter_hits) if b and a)
    regression = (originally - still) / originally
    return regression, originally, still
