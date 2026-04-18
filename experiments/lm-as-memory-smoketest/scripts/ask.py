"""CLI: generate a response, optionally with a loaded adapter."""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from engine import ask  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("prompt", help="Prompt text")
    p.add_argument("--adapter", default=None, help="Optional adapter dir")
    p.add_argument("--max-tokens", type=int, default=128)
    args = p.parse_args()

    out = ask(args.prompt, adapter_dir=args.adapter, max_tokens=args.max_tokens)
    print(out)


if __name__ == "__main__":
    main()
