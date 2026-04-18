"""Phase 0 end-to-end: baseline → train adapter → recall + retention → report."""
from __future__ import annotations
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from engine import BASE_MODEL, IngestConfig, ingest  # noqa: E402
from metrics import load_probes, retention_delta, score_probes  # noqa: E402

FACTS = ROOT / "data" / "phase0-facts.jsonl"
RECALL = ROOT / "data" / "phase0-recall-probes.jsonl"
BASE = ROOT / "data" / "phase0-base-probes.jsonl"
ADAPTER = ROOT / "adapters" / "phase0"
RESULTS = ROOT / "notes" / "phase0-results.md"

PROMPT_TMPL = "Answer the following question concisely.\nQuestion: {q}\nAnswer:"


def _generate_all(probes: list[dict], adapter_path: str | None) -> list[str]:
    from mlx_lm import load, generate

    kwargs = {"adapter_path": adapter_path} if adapter_path else {}
    model, tokenizer = load(BASE_MODEL, **kwargs)
    out: list[str] = []
    for p in probes:
        text = generate(
            model,
            tokenizer,
            prompt=PROMPT_TMPL.format(q=p["probe"]),
            max_tokens=64,
            verbose=False,
        )
        out.append(text)
    return out


def _verdict(h1: float, h2: float) -> str:
    if h1 >= 0.80 and h2 <= 0.10:
        return "PASS"
    if h1 < 0.50 or h2 > 0.30:
        return "PARK"
    return "MIXED"


def main() -> None:
    recall_probes = load_probes(RECALL)
    base_probes = load_probes(BASE)

    print(f"[1/4] Baseline pass — {len(base_probes)} base probes, no adapter")
    base_responses = _generate_all(base_probes, adapter_path=None)
    _base_rate, base_hits = score_probes(base_probes, base_responses)
    print(f"       base-model containment: {sum(base_hits)}/{len(base_hits)}")

    print(f"[2/4] Ingest — training LoRA on {FACTS.name}")
    ADAPTER.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    ingest(FACTS, ADAPTER, config=IngestConfig())
    ingest_s = time.time() - t0
    print(f"       ingest time: {ingest_s:.1f}s")

    print(f"[3/4] Recall probes with adapter — {len(recall_probes)} probes")
    recall_responses = _generate_all(recall_probes, adapter_path=str(ADAPTER))
    h1_rate, h1_hits = score_probes(recall_probes, recall_responses)
    print(f"       recall containment: {sum(h1_hits)}/{len(h1_hits)} = {h1_rate:.3f}")

    print(f"[4/4] Retention probes with adapter — {len(base_probes)} probes")
    adapter_base_responses = _generate_all(base_probes, adapter_path=str(ADAPTER))
    _, adapter_hits = score_probes(base_probes, adapter_base_responses)
    regression, originally, still = retention_delta(base_hits, adapter_hits)
    print(f"       base-knowledge retained: {still}/{originally} (regression {regression:.3f})")

    verdict = _verdict(h1_rate, regression)
    print(f"\nVERDICT: {verdict}")

    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Phase 0 — {verdict}",
        "",
        f"- ingest_time: {ingest_s:.1f}s",
        f"- H1 recall containment: **{h1_rate:.3f}** ({sum(h1_hits)}/{len(h1_hits)})",
        f"- H2 base-knowledge regression: **{regression:.3f}** (retained {still}/{originally})",
        "",
        "| hypothesis | threshold | measured | verdict |",
        "|---|---|---|---|",
        f"| H1 — Recall | ≥ 0.80 | **{h1_rate:.3f}** | **{'PASS' if h1_rate >= 0.80 else 'FAIL'}** |",
        f"| H2 — Retention | ≤ 0.10 | **{regression:.3f}** | **{'PASS' if regression <= 0.10 else 'FAIL'}** |",
        f"| H3 — Ingest cost | ≤ 300s | **{ingest_s:.0f}s** | **{'PASS' if ingest_s <= 300 else 'FAIL'}** |",
        "",
        "## Per-probe recall",
        "",
    ]
    for p, r, hit in zip(recall_probes, recall_responses, h1_hits):
        mark = "✓" if hit else "✗"
        lines.append(f"- {mark} `{p['probe']}` → `{r.strip()[:120]}`")
    lines.append("")
    lines.append("## Retention regressions (base-correct → adapter-wrong)")
    lines.append("")
    for p, b_hit, a_hit in zip(base_probes, base_hits, adapter_hits):
        if b_hit and not a_hit:
            lines.append(f"- {p['probe']} (keys: {p['answer_keys']})")

    RESULTS.write_text("\n".join(lines) + "\n")
    print(f"Wrote {RESULTS}")


if __name__ == "__main__":
    main()
