"""CLI: train a LoRA adapter on a fact batch."""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from engine import IngestConfig, ingest  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--facts", required=True, help="Path to facts.jsonl")
    p.add_argument("--adapter", required=True, help="Output adapter dir")
    p.add_argument("--iters", type=int, default=300)
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--lora-layers", type=int, default=16)
    p.add_argument("--lr", type=float, default=1e-4)
    args = p.parse_args()

    cfg = IngestConfig(
        iters=args.iters,
        batch_size=args.batch_size,
        lora_layers=args.lora_layers,
        learning_rate=args.lr,
    )
    ingest(args.facts, args.adapter, config=cfg)
    print(f"Adapter saved → {args.adapter}")


if __name__ == "__main__":
    main()
