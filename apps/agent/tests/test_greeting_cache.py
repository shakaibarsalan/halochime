from __future__ import annotations

import asyncio

from talkfront_agent import greeting_cache


def test_cached_greeting_round_trip(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("GREETING_CACHE_DIR", str(tmp_path))
    assert greeting_cache.cached("marin", "Hi there") is None
    key = greeting_cache._key("marin", "Hi there")
    (tmp_path / f"{key}.pcm").write_bytes(b"\x01\x00" * 1000)
    assert greeting_cache.cached("marin", "Hi there") == b"\x01\x00" * 1000
    # Another voice or text is another greeting.
    assert greeting_cache.cached("cedar", "Hi there") is None
    assert greeting_cache.cached("marin", "Hello") is None


def test_frames_are_20_ms_and_padded() -> None:
    async def collect() -> list:  # type: ignore[type-arg]
        return [f async for f in greeting_cache.frames(b"\x00\x01" * 700)]

    frames = asyncio.run(collect())
    assert len(frames) == 2
    assert all(f.samples_per_channel == 480 and f.sample_rate == 24000 for f in frames)
