"""Phase 0.4 GRACE engine — MPS-friendly wrapper around vendor/EasyEdit's GRACE.

Upstream `BaseEditor.apply_grace_to_model` hardcodes `torch.device(f'cuda:{...}')`.
This module bypasses that entry point and drives the `GRACE` class directly so it
can run on Apple Silicon (MPS). The underlying edit algorithm, adapter geometry,
and loss loop are unchanged from upstream.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

_ROOT = Path(__file__).resolve().parent.parent
_VENDOR = _ROOT / "vendor" / "EasyEdit"
if str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

from easyeditor.models.grace.GRACE import GRACE  # noqa: E402
from easyeditor.models.grace.grace_hparams import GraceHyperParams  # noqa: E402
from easyeditor.models.grace.utils import tokenize  # noqa: E402


BASE_MODEL = "Qwen/Qwen2.5-1.5B"


def _resolve_device(preferred: str | None) -> torch.device:
    if preferred:
        return torch.device(preferred)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def load_base(
    model_id: str = BASE_MODEL,
    device: str | torch.device | None = None,
    dtype: torch.dtype = torch.float32,
) -> tuple[AutoModelForCausalLM, AutoTokenizer, torch.device]:
    """Load Qwen2.5-base + tokenizer onto `device`.

    float32 default: GRACE's Adam step + codebook parameters are mixed-precision
    fragile on MPS. Upstream BaseEditor also defaults to fp32 for non-fp16 configs.
    """
    resolved = _resolve_device(device) if isinstance(device, str) or device is None else device
    tok = AutoTokenizer.from_pretrained(
        model_id,
        eos_token="<|endoftext|>",
        pad_token="<|endoftext|>",
        unk_token="<|endoftext|>",
        trust_remote_code=True,
    )
    tok.padding_side = "left"
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=dtype,
        trust_remote_code=True,
    ).to(resolved)
    model.train(False)
    return model, tok, resolved


@dataclass
class EditRequest:
    prompt: str
    target_new: str
    subject: str = ""

    def as_tokenize_batch(self) -> dict:
        return {"prompt": self.prompt, "target_new": self.target_new}


class GraceEngine:
    """Load base model, apply sequential GRACE edits, answer probes.

    Usage:
        engine = GraceEngine("configs/phase0-4-grace.yaml")
        engine.apply_edits([{"prompt": ..., "target_new": ...}, ...])
        engine.ask("...")
    """

    def __init__(
        self,
        hparams_path: str | Path,
        model_id: str | None = None,
        device: str | None = None,
    ) -> None:
        self.hparams: GraceHyperParams = GraceHyperParams.from_hparams(str(hparams_path))
        self.model_id = model_id or self.hparams.model_name or BASE_MODEL
        self.model, self.tok, self.device = load_base(self.model_id, device=device)
        self.editor: GRACE | None = None
        self.n_edits = 0

    def _ensure_editor(self) -> GRACE:
        if self.editor is None:
            # GRACE.__init__ replaces self.hparams.inner_params[0] on self.model
            # with a GRACEAdapter, and freezes all other params.
            self.editor = GRACE(self.hparams, self.model, self.device)
        return self.editor

    def apply_edits(self, edits: Iterable[dict]) -> None:
        for raw in edits:
            req = EditRequest(
                prompt=raw["prompt"],
                target_new=raw["target_new"],
                subject=raw.get("subject", ""),
            )
            editor = self._ensure_editor()
            tokens = tokenize(req.as_tokenize_batch(), tokenizer=self.tok, device=self.device)
            editor.edit(config=self.hparams, tokens=tokens, edit_id=req.target_new)
            self.n_edits += 1

    @torch.inference_mode()
    def ask(self, prompt: str, max_new_tokens: int = 64) -> str:
        inputs = self.tok(prompt, return_tensors="pt").to(self.device)
        generator = self.editor if self.editor is not None else self.model
        out = generator.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            pad_token_id=self.tok.pad_token_id,
            eos_token_id=self.tok.eos_token_id,
        )
        full = self.tok.decode(out[0], skip_special_tokens=True)
        return full[len(prompt):] if full.startswith(prompt) else full
