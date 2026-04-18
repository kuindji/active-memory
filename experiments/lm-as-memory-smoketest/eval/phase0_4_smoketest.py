"""Phase 0.4 end-to-end: baseline -> GRACE edits -> recall + retention + paraphrase -> report.

Mirrors eval/phase0_smoketest.py structure, swapped to PyTorch+MPS (transformers
generate) and GRACE (gradient-free codebook insert) via src/grace_engine.py.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from grace_engine import GraceEngine  # noqa: E402
from metrics import load_probes, retention_delta, score_probes  # noqa: E402

CONFIG = ROOT / "configs" / "phase0-4-grace.yaml"
EDITS = ROOT / "data" / "phase0-edits.jsonl"
RECALL = ROOT / "data" / "phase0-recall-probes.jsonl"
BASE = ROOT / "data" / "phase0-base-probes.jsonl"
PARA = ROOT / "data" / "phase0-paraphrases.jsonl"
RESULTS = ROOT / "notes" / "phase0_4-results.md"

PROMPT_TMPL = "Answer the following question concisely.\nQuestion: {q}\nAnswer:"
MAX_NEW_TOKENS = 48


def _load_edits(path: Path) -> list[dict]:
    out: list[dict] = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line))
    return out


def _generate_all(engine: GraceEngine, probes: list[dict]) -> list[str]:
    return [engine.ask(PROMPT_TMPL.format(q=p["probe"]), max_new_tokens=MAX_NEW_TOKENS) for p in probes]


def _verdict(h1: float, h2: float, h3: float) -> str:
    if h1 >= 0.80 and h2 <= 0.05 and h3 >= 0.60:
        return "PASS"
    if h1 < 0.50:
        return "PARK"
    if h1 >= 0.80 and h3 < 0.60:
        return "MIXED"
    return "MIXED"


def main() -> None:
    recall_probes = load_probes(RECALL)
    base_probes = load_probes(BASE)
    para_probes = load_probes(PARA)
    edits = _load_edits(EDITS)

    print(f"[setup] loading base model via src/grace_engine.py")
    t0 = time.time()
    engine = GraceEngine(CONFIG)
    print(f"       ready on device={engine.device} (load {time.time()-t0:.1f}s)")

    print(f"[1/4] Baseline pass — {len(base_probes)} base probes, no edits")
    base_responses = _generate_all(engine, base_probes)
    _, base_hits = score_probes(base_probes, base_responses)
    print(f"       base containment: {sum(base_hits)}/{len(base_hits)}")

    print(f"[2/4] GRACE edit — {len(edits)} records, sequential")
    t0 = time.time()
    engine.apply_edits(edits)
    edit_s = time.time() - t0
    print(f"       edit time: {edit_s:.1f}s  ({edit_s/len(edits):.1f}s/edit)")

    print(f"[3/4] Recall probes with edits — {len(recall_probes)}")
    recall_responses = _generate_all(engine, recall_probes)
    h1_rate, h1_hits = score_probes(recall_probes, recall_responses)
    print(f"       recall containment: {sum(h1_hits)}/{len(h1_hits)} = {h1_rate:.3f}")

    print(f"[4/4] Retention + paraphrase")
    adapter_base_responses = _generate_all(engine, base_probes)
    _, adapter_hits = score_probes(base_probes, adapter_base_responses)
    regression, originally, still = retention_delta(base_hits, adapter_hits)
    print(f"       base-knowledge retained: {still}/{originally} (regression {regression:.3f})")

    para_responses = _generate_all(engine, para_probes)
    h3_rate, h3_hits = score_probes(para_probes, para_responses)
    print(f"       paraphrase containment: {sum(h3_hits)}/{len(h3_hits)} = {h3_rate:.3f}")

    verdict = _verdict(h1_rate, regression, h3_rate)
    print(f"\nVERDICT: {verdict}")

    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Phase 0.4 — {verdict}",
        "",
        f"- method: GRACE (gradient-free codebook)",
        f"- base_model: {engine.model_id}",
        f"- device: {engine.device}",
        f"- inner_params: {engine.hparams.inner_params[0]}",
        f"- n_iter: {engine.hparams.n_iter}, edit_lr: {engine.hparams.edit_lr}, eps: {engine.hparams.eps}",
        f"- edit_time_total: {edit_s:.1f}s ({len(edits)} edits, {edit_s/len(edits):.1f}s/edit)",
        "",
        "| hypothesis | threshold | measured | verdict |",
        "|---|---|---|---|",
        f"| H1 — Recall | ≥ 0.80 | **{h1_rate:.3f}** ({sum(h1_hits)}/{len(h1_hits)}) | **{'PASS' if h1_rate >= 0.80 else 'FAIL'}** |",
        f"| H2 — Retention regression | ≤ 0.05 | **{regression:.3f}** (retained {still}/{originally}) | **{'PASS' if regression <= 0.05 else 'FAIL'}** |",
        f"| H3 — Paraphrase recall | ≥ 0.60 | **{h3_rate:.3f}** ({sum(h3_hits)}/{len(h3_hits)}) | **{'PASS' if h3_rate >= 0.60 else 'FAIL'}** |",
        f"| H4 — Edit cost | ≤ 300s | **{edit_s:.0f}s** | **{'PASS' if edit_s <= 300 else 'FAIL'}** |",
        "",
        "## Per-probe recall",
        "",
    ]
    for p, r, hit in zip(recall_probes, recall_responses, h1_hits):
        mark = "✓" if hit else "✗"
        lines.append(f"- {mark} `{p['probe']}` → `{r.strip()[:120]}`")
    lines.append("")
    lines.append("## Paraphrase recall")
    lines.append("")
    for p, r, hit in zip(para_probes, para_responses, h3_hits):
        mark = "✓" if hit else "✗"
        lines.append(f"- {mark} `{p['probe']}` → `{r.strip()[:120]}`")
    lines.append("")
    lines.append("## Retention regressions (base-correct → edited-wrong)")
    lines.append("")
    for p, b_hit, a_hit in zip(base_probes, base_hits, adapter_hits):
        if b_hit and not a_hit:
            lines.append(f"- {p['probe']} (keys: {p['answer_keys']})")

    RESULTS.write_text("\n".join(lines) + "\n")
    print(f"Wrote {RESULTS}")


if __name__ == "__main__":
    main()
