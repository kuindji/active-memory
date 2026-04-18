#!/usr/bin/env bash
# Phase 0.4 setup — idempotently recreate the GRACE environment.
#
#   1. .venv-grace/ with torch+MPS-capable wheels
#   2. requirements-grace.txt installed
#   3. vendor/EasyEdit/ cloned at the pinned commit (3488a66e)
#   4. Two __init__.py trims applied so `from easyeditor.models.grace.*`
#      imports cleanly without pulling the multimodal cascade
#      (blip2 -> timm, fairscale, opencv-python, av, qwen_vl_utils, zhipuai).
#
# Run from the experiment root:
#   bash scripts/setup_grace.sh
#
# Requires python3.13 on PATH — torch has no Python 3.14 wheels at this pin.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$HERE/vendor/EasyEdit"
VENV="$HERE/.venv-grace"
EASYEDIT_SHA="3488a66ee988d83ee7891a8abbbe6bcb24a77daf"

PY="${PY:-python3.13}"
if ! command -v "$PY" >/dev/null 2>&1; then
    echo "error: $PY not on PATH; install Python 3.13 (brew install python@3.13)" >&2
    exit 1
fi

# --- 1. venv + requirements ---
if [[ ! -x "$VENV/bin/python" ]]; then
    echo "[setup_grace] creating $VENV"
    "$PY" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$HERE/requirements-grace.txt"

# --- 2. vendor clone at pinned SHA ---
if [[ ! -d "$VENDOR/.git" ]]; then
    echo "[setup_grace] cloning EasyEdit into $VENDOR"
    rm -rf "$VENDOR"
    mkdir -p "$HERE/vendor"
    git clone https://github.com/zjunlp/EasyEdit.git "$VENDOR"
fi
( cd "$VENDOR" && git fetch --depth 1 origin "$EASYEDIT_SHA" 2>/dev/null || true )
( cd "$VENDOR" && git checkout --detach "$EASYEDIT_SHA" )

# --- 3. apply __init__.py trims ---
# Upstream easyeditor/__init__.py imports the full trainer/dataset/editors
# tree. For GRACE-on-text we only need a handful of leaf modules, so both
# __init__.py files are blanked (originals preserved alongside as .orig).
apply_trim () {
    local target="$1"
    local orig="$target.orig"
    if [[ ! -f "$orig" ]]; then
        cp "$target" "$orig"
    fi
    cat > "$target" <<'PY_INIT'
# Trimmed for Phase 0.4 (memory-domain) — upstream __init__ preserved in
# __init__.py.orig. The full cascade pulls multimodal trainer code
# (blip2 -> timm, iopath, opencv, fairscale, av, qwen_vl_utils, zhipuai)
# that is unnecessary for GRACE on text. Phase 0.4 imports grace submodules
# directly from src/grace_engine.py, so this package stays empty.
PY_INIT
}
apply_trim "$VENDOR/easyeditor/__init__.py"
apply_trim "$VENDOR/easyeditor/models/__init__.py"

echo "[setup_grace] done."
echo "  venv:   $VENV"
echo "  vendor: $VENDOR (SHA $EASYEDIT_SHA)"
echo "Verify:"
echo "  PYTHONPATH=vendor/EasyEdit $VENV/bin/python -c 'import torch; print(torch.backends.mps.is_available())'"
