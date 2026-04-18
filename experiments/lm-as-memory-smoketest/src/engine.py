from __future__ import annotations
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

BASE_MODEL = "Qwen/Qwen2.5-1.5B"


@dataclass
class IngestConfig:
    iters: int = 300
    batch_size: int = 2
    lora_layers: int = 16
    learning_rate: float = 1e-4
    lora_rank: int = 8


def _prepare_train_data(facts_path: Path, data_dir: Path) -> None:
    """MLX LoRA expects train.jsonl + valid.jsonl in a single dir."""
    data_dir.mkdir(parents=True, exist_ok=True)
    facts: list[str] = []
    with open(facts_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            facts.append(row["fact"])

    train_lines = [json.dumps({"text": f"Fact: {fact}"}) for fact in facts]
    (data_dir / "train.jsonl").write_text("\n".join(train_lines) + "\n")
    # MLX requires a valid split; reuse last 2 for loss tracking (smoketest only).
    valid_lines = train_lines[-2:]
    (data_dir / "valid.jsonl").write_text("\n".join(valid_lines) + "\n")


def ingest(
    facts_path: str | Path,
    adapter_dir: str | Path,
    config: IngestConfig | None = None,
    model_id: str = BASE_MODEL,
) -> None:
    """Fine-tune a LoRA adapter on the given fact batch."""
    cfg = config or IngestConfig()
    facts_path = Path(facts_path)
    adapter_dir = Path(adapter_dir)
    adapter_dir.mkdir(parents=True, exist_ok=True)
    data_dir = adapter_dir / "_train_data"
    _prepare_train_data(facts_path, data_dir)

    cmd = [
        sys.executable, "-m", "mlx_lm", "lora",
        "--model", model_id,
        "--train",
        "--data", str(data_dir),
        "--iters", str(cfg.iters),
        "--batch-size", str(cfg.batch_size),
        "--num-layers", str(cfg.lora_layers),
        "--learning-rate", str(cfg.learning_rate),
        "--adapter-path", str(adapter_dir),
    ]
    subprocess.run(cmd, check=True)


def ingest_with_config(
    facts_path: str | Path,
    adapter_dir: str | Path,
    config_path: str | Path,
) -> None:
    """Fine-tune a LoRA adapter using a full mlx_lm YAML config.

    All hyperparameters (rank, alpha, keys, iters, lr, layers, etc.) live in the
    YAML. Only data dir and adapter output path are overridden on the CLI.
    """
    facts_path = Path(facts_path)
    adapter_dir = Path(adapter_dir)
    adapter_dir.mkdir(parents=True, exist_ok=True)
    data_dir = adapter_dir / "_train_data"
    _prepare_train_data(facts_path, data_dir)

    cmd = [
        sys.executable, "-m", "mlx_lm", "lora",
        "-c", str(config_path),
        "--train",
        "--data", str(data_dir),
        "--adapter-path", str(adapter_dir),
    ]
    subprocess.run(cmd, check=True)


def ask(
    prompt: str,
    adapter_dir: str | Path | None = None,
    max_tokens: int = 128,
    model_id: str = BASE_MODEL,
) -> str:
    """Generate a response. If adapter_dir is provided, load it on top of base."""
    # Import inside to avoid forcing mlx_lm availability for pure scoring.
    from mlx_lm import load, generate

    kwargs = {"adapter_path": str(adapter_dir)} if adapter_dir else {}
    model, tokenizer = load(model_id, **kwargs)
    return generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        verbose=False,
    )


def build_context(prompt: str) -> str:
    """Phase 0: passthrough. Phase 1+: will fuse adapter context, episodic weights, etc."""
    return prompt
