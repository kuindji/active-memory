"""Force-pull the base model weights into the HF cache so later calls are offline-ready."""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from engine import BASE_MODEL  # noqa: E402


def main() -> None:
    from mlx_lm import load

    print(f"Loading {BASE_MODEL} (first call downloads ~3GB)...")
    load(BASE_MODEL)
    print("OK — weights cached.")


if __name__ == "__main__":
    main()
