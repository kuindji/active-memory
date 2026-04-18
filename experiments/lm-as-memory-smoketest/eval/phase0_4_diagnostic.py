"""Phase 0.4 diagnostic — isolate whether GRACE learned vs. prompt-form brittleness.

Main smoketest reported H1=0.05. Responses look like pristine baseline Qwen, not
injected-edit continuations. The recall probes are Q&A-wrapped, but the edits were
trained on bare completion stubs. GRACE keys store the last-token activation at
the *edit* prompt; Q&A-wrapped queries produce very different activations, which
may miss the codebook lookup. This script re-tests under three conditions:

  exact    — generate continuation of the edit prompt itself (maximum key match)
  q_and_a  — same Q&A-wrapped form used by the main smoketest (current H1 signal)
  para     — paraphrase probes used for H3

If exact >> q_and_a ≈ para, the mechanism is prompt-form brittleness (MIXED).
If exact is also ~0, GRACE genuinely didn't learn (clean PARK).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from grace_engine import GraceEngine  # noqa: E402
from metrics import contains_any  # noqa: E402

CONFIG = ROOT / "configs" / "phase0-4-grace.yaml"
EDITS = ROOT / "data" / "phase0-edits.jsonl"
RECALL = ROOT / "data" / "phase0-recall-probes.jsonl"
PARA = ROOT / "data" / "phase0-paraphrases.jsonl"
RESULTS = ROOT / "notes" / "phase0_4-diagnostic.md"

PROMPT_TMPL = "Answer the following question concisely.\nQuestion: {q}\nAnswer:"
MAX_NEW_TOKENS = 32


def _load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def main() -> None:
    edits = _load_jsonl(EDITS)
    recall = _load_jsonl(RECALL)
    para = _load_jsonl(PARA)

    print(f"[setup] loading + re-editing (23 records, ~90s)")
    t0 = time.time()
    engine = GraceEngine(CONFIG)
    print(f"       ready on device={engine.device} (load {time.time()-t0:.1f}s)")
    t0 = time.time()
    engine.apply_edits(edits)
    print(f"       edits applied in {time.time()-t0:.1f}s")

    print(f"\n[1/3] exact-form recall — use each edit's own prompt as probe ({len(edits)})")
    exact_hits: list[tuple[bool, str, str, str]] = []
    for e in edits:
        resp = engine.ask(e["prompt"], max_new_tokens=MAX_NEW_TOKENS)
        hit = contains_any(resp, [e["target_new"]])
        exact_hits.append((hit, e["prompt"], e["target_new"], resp.strip()[:160]))
    exact_rate = sum(h for h, *_ in exact_hits) / len(exact_hits)
    print(f"       exact containment: {sum(h for h, *_ in exact_hits)}/{len(exact_hits)} = {exact_rate:.3f}")

    print(f"\n[2/3] q_and_a-form recall — Q&A-template probes ({len(recall)})")
    qa_hits: list[tuple[bool, str, list, str]] = []
    for p in recall:
        resp = engine.ask(PROMPT_TMPL.format(q=p["probe"]), max_new_tokens=MAX_NEW_TOKENS)
        hit = contains_any(resp, p["answer_keys"])
        qa_hits.append((hit, p["probe"], p["answer_keys"], resp.strip()[:160]))
    qa_rate = sum(h for h, *_ in qa_hits) / len(qa_hits)
    print(f"       q&a containment: {sum(h for h, *_ in qa_hits)}/{len(qa_hits)} = {qa_rate:.3f}")

    print(f"\n[3/3] para-form recall — paraphrased probes ({len(para)})")
    para_hits: list[tuple[bool, str, list, str]] = []
    for p in para:
        resp = engine.ask(PROMPT_TMPL.format(q=p["probe"]), max_new_tokens=MAX_NEW_TOKENS)
        hit = contains_any(resp, p["answer_keys"])
        para_hits.append((hit, p["probe"], p["answer_keys"], resp.strip()[:160]))
    para_rate = sum(h for h, *_ in para_hits) / len(para_hits)
    print(f"       para containment: {sum(h for h, *_ in para_hits)}/{len(para_hits)} = {para_rate:.3f}")

    # Inspect GRACE codebook state — did keys actually get stored?
    adapter = engine.editor.model
    for name in engine.hparams.inner_params[0].rsplit(".", 1)[0].split("."):
        if "[" in name:
            attr, idx = name[:-1].split("[")
            adapter = getattr(adapter, attr)[int(idx)]
        else:
            adapter = getattr(adapter, name)
    nkeys = len(adapter.keys) if hasattr(adapter, "keys") else 0
    print(f"\n[codebook] adapter class={type(adapter).__name__} nkeys={nkeys}")

    if exact_rate >= 0.80 and qa_rate <= 0.15:
        interpretation = "prompt-form brittleness — GRACE learned but Q&A wrapper defeats key lookup (MIXED, not clean PARK)"
    elif exact_rate >= 0.50:
        interpretation = "partial learning, strong prompt-form brittleness — GRACE marginally works"
    elif exact_rate < 0.20:
        interpretation = "GRACE did not learn — clean PARK for parametric line"
    else:
        interpretation = "ambiguous"

    print(f"\nINTERPRETATION: {interpretation}")

    # Write markdown
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Phase 0.4 — Diagnostic",
        "",
        f"Purpose: isolate mechanism behind H1=0.05 in main smoketest.",
        "",
        "| probe form | containment | rate |",
        "|---|---|---|",
        f"| exact (edit prompt → target_new) | {sum(h for h,*_ in exact_hits)}/{len(exact_hits)} | **{exact_rate:.3f}** |",
        f"| q_and_a (template-wrapped) | {sum(h for h,*_ in qa_hits)}/{len(qa_hits)} | **{qa_rate:.3f}** |",
        f"| para (paraphrased + template) | {sum(h for h,*_ in para_hits)}/{len(para_hits)} | **{para_rate:.3f}** |",
        "",
        f"Codebook size after edits: {nkeys} keys (input 23 edits)",
        "",
        f"**Interpretation:** {interpretation}",
        "",
        "## Exact-form per-probe",
        "",
    ]
    for hit, prompt, tgt, resp in exact_hits:
        mark = "✓" if hit else "✗"
        lines.append(f"- {mark} `{prompt}` → `{resp}`  _(target: `{tgt}`)_")
    lines.append("")
    lines.append("## Q&A-form per-probe")
    lines.append("")
    for hit, probe, keys, resp in qa_hits:
        mark = "✓" if hit else "✗"
        lines.append(f"- {mark} `{probe}` → `{resp}`  _(keys: {keys})_")
    lines.append("")
    lines.append("## Para-form per-probe")
    lines.append("")
    for hit, probe, keys, resp in para_hits:
        mark = "✓" if hit else "✗"
        lines.append(f"- {mark} `{probe}` → `{resp}`  _(keys: {keys})_")

    RESULTS.write_text("\n".join(lines) + "\n")
    print(f"\nWrote {RESULTS}")


if __name__ == "__main__":
    main()
