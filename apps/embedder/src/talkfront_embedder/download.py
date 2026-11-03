"""Downloads the model files once (at image build time), pinned to a revision and checked by sha256.

    python -m talkfront_embedder download [--variant int8|fp32] [--dir PATH]
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

# intfloat/multilingual-e5-small, ONNX export published by the model authors.
REPO = "intfloat/multilingual-e5-small"
REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"


@dataclass(frozen=True)
class RemoteFile:
    path: str  # path inside the repo
    sha256: str
    size: int


# The SentencePiece model (5 MB): same token ids as tokenizer.json, but about 300 MB less memory.
TOKENIZER = RemoteFile(
    "onnx/sentencepiece.bpe.model", "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865", 5_069_051
)
VARIANTS: dict[str, RemoteFile] = {
    # Dynamic int8 weights: a quarter of the size, runs on x86 and ARM (onnxruntime MLAS int8 kernels).
    "int8": RemoteFile(
        "onnx/model_qint8_avx512_vnni.onnx",
        "dd476dd0c2514e9b9be83aeb3853fac0763e0bdf4a71645407587d77c48a2d88",
        118_346_824,
    ),
    "fp32": RemoteFile(
        "onnx/model.onnx", "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665", 470_268_510
    ),
}

MODEL_FILENAME = "model.onnx"
TOKENIZER_FILENAME = "sentencepiece.bpe.model"
VARIANT_FILENAME = "variant.txt"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _fetch(remote: RemoteFile, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size == remote.size and _sha256(dest) == remote.sha256:
        print(f"ok (cached) {dest.name}")
        return
    url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{remote.path}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 (fixed https URL)
            for block in iter(lambda: resp.read(1 << 20), b""):
                tmp.write(block)
    digest = _sha256(tmp_path)
    if digest != remote.sha256:
        tmp_path.unlink(missing_ok=True)
        raise SystemExit(f"sha256 mismatch for {remote.path}: got {digest}")
    os.replace(tmp_path, dest)
    print(f"ok {dest.name} ({remote.size / 1e6:.0f} MB)")


def download(model_dir: Path, variant: str) -> None:
    if variant not in VARIANTS:
        raise SystemExit(f"unknown variant {variant!r}; choose one of {', '.join(VARIANTS)}")
    _fetch(TOKENIZER, model_dir / TOKENIZER_FILENAME)
    _fetch(VARIANTS[variant], model_dir / MODEL_FILENAME)
    (model_dir / VARIANT_FILENAME).write_text(variant + "\n", encoding="utf-8")


def main(argv: list[str]) -> None:
    variant = os.environ.get("EMBEDDER_VARIANT", "int8")
    model_dir = Path(os.environ.get("EMBEDDER_MODEL_DIR", "").strip() or Path(__file__).resolve().parents[2] / "model")
    it = iter(argv)
    for arg in it:
        if arg == "--variant":
            variant = next(it)
        elif arg == "--dir":
            model_dir = Path(next(it))
        else:
            raise SystemExit(f"unknown argument {arg!r}")
    download(model_dir, variant)


if __name__ == "__main__":
    main(sys.argv[1:])
