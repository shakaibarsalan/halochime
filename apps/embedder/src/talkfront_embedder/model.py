"""multilingual-e5-small on onnxruntime (CPU): tokenize, run, mean-pool, L2-normalise."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Literal

import numpy as np
import onnxruntime as ort
import sentencepiece as spm

from .download import MODEL_FILENAME, TOKENIZER_FILENAME, VARIANT_FILENAME

Kind = Literal["query", "passage"]

DIMENSIONS = 384
MAX_TOKENS = 512  # the model's position limit (XLM-R), special tokens included
# e5 was trained with these prefixes; leaving them out costs retrieval quality.
PREFIX: dict[str, str] = {"query": "query: ", "passage": "passage: "}

# XLM-RoBERTa ids on top of SentencePiece ids (what transformers' XLMRobertaTokenizer does):
# <s>=0, <pad>=1, </s>=2, <unk>=3, and every other piece is its SentencePiece id + 1.
BOS, PAD, EOS, UNK = 0, 1, 2, 3


class XlmrTokenizer:
    def __init__(self, model_file: Path, max_tokens: int) -> None:
        self._sp = spm.SentencePieceProcessor(model_file=str(model_file))
        self.max_tokens = max_tokens

    def encode(self, text: str) -> list[int]:
        """Token ids with <s> ... </s>, truncated to ``max_tokens`` in total."""
        ids = [i + 1 if i != 0 else UNK for i in self._sp.encode(text)]
        return [BOS, *ids[: self.max_tokens - 2], EOS]


class Embedder:
    """Thread-safe. Inference is serialised; queries jump ahead of the backfill (see ``priority``)."""

    def __init__(self, model_dir: Path, *, threads: int = 1, max_tokens: int = MAX_TOKENS) -> None:
        variant_file = model_dir / VARIANT_FILENAME
        variant = variant_file.read_text(encoding="utf-8").strip() if variant_file.exists() else "custom"
        self.model_name = f"multilingual-e5-small-{variant}"
        self.max_tokens = max_tokens

        self._tokenizer = XlmrTokenizer(model_dir / TOKENIZER_FILENAME, max_tokens)

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, threads)
        opts.inter_op_num_threads = 1
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # The arena keeps the biggest batch's buffers forever; off keeps memory flat after long chunks.
        opts.enable_cpu_mem_arena = False
        self._session = ort.InferenceSession(
            str(model_dir / MODEL_FILENAME), sess_options=opts, providers=["CPUExecutionProvider"]
        )
        self._input_names = {i.name for i in self._session.get_inputs()}

        self._lock = threading.Lock()
        self._waiting_queries = 0
        self._queries_done = threading.Condition(threading.Lock())

    # -- priority ---------------------------------------------------------------------------------

    def wait_for_queries(self, timeout: float = 5.0) -> None:
        """Background work calls this before each item so a live query never waits behind a batch."""
        with self._queries_done:
            self._queries_done.wait_for(lambda: self._waiting_queries == 0, timeout=timeout)

    # -- embedding --------------------------------------------------------------------------------

    def count_tokens(self, text: str) -> int:
        return len(self._tokenizer.encode(text))

    def embed(self, texts: list[str], kind: Kind) -> np.ndarray:
        """Returns float32 [len(texts), 384], each row of unit length, in the order given."""
        out = np.zeros((len(texts), DIMENSIONS), dtype=np.float32)
        if not texts:
            return out
        prefix = PREFIX[kind]
        encodings = [self._tokenizer.encode(prefix + " ".join(t.split())) for t in texts]

        is_query = kind == "query"
        if is_query:
            with self._queries_done:
                self._waiting_queries += 1
        try:
            # One text per run. The int8 model quantises activations per run, so a text batched
            # with others (and their padding) gets a slightly different vector; one at a time keeps
            # vectors reproducible, and on one CPU thread it is also faster than padded batches.
            for i, enc in enumerate(encodings):
                out[i] = self._run([enc])[0]
        finally:
            if is_query:
                with self._queries_done:
                    self._waiting_queries -= 1
                    self._queries_done.notify_all()
        return out

    def _run(self, encodings: list[list[int]]) -> np.ndarray:
        width = max(len(e) for e in encodings)
        ids = np.full((len(encodings), width), PAD, dtype=np.int64)
        mask = np.zeros((len(encodings), width), dtype=np.int64)
        for row, enc in enumerate(encodings):
            ids[row, : len(enc)] = enc
            mask[row, : len(enc)] = 1
        feeds: dict[str, np.ndarray] = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self._input_names:
            feeds["token_type_ids"] = np.zeros_like(ids)
        with self._lock:
            hidden = self._session.run(None, feeds)[0]  # [rows, tokens, 384]
        m = mask[..., None].astype(np.float32)
        pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        return (pooled / np.clip(norms, 1e-12, None)).astype(np.float32)
