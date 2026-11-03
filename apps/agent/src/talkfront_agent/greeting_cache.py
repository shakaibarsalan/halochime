"""Ready-made audio for the agent's greeting, so a realtime call starts talking at once.

A realtime model has to be asked to say the greeting and then speaks it, about two seconds after
the visitor joins. The greeting is the same on every call, so its audio is made once with OpenAI's
speech API in the agent's own voice and kept on disk; later calls play it straight away. The first
call with a new greeting (or after a restart) still asks the model, and the audio is made meanwhile.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path

import aiohttp
from livekit import rtc

logger = logging.getLogger("talkfront.greeting")

TTS_URL = "https://api.openai.com/v1/audio/speech"
TTS_MODEL = "gpt-4o-mini-tts"
TTS_INSTRUCTIONS = "Warm, friendly and natural, like a helpful person answering a call."
SAMPLE_RATE = 24000  # OpenAI's "pcm" format: 24 kHz, 16-bit, mono
FRAME_SAMPLES = 480  # 20 ms
TTS_TIMEOUT_S = 20
# Greetings are short; a cached file far bigger than this is not ours.
MAX_AUDIO_BYTES = 4 * 1024 * 1024

_making: dict[str, asyncio.Task[None]] = {}


def cache_dir() -> Path:
    return Path(os.environ.get("GREETING_CACHE_DIR", "/tmp/talkfront-greetings"))


def _key(voice: str, text: str) -> str:
    return hashlib.sha256(f"{TTS_MODEL}|{voice}|{TTS_INSTRUCTIONS}|{text}".encode()).hexdigest()[:32]


def cached(voice: str, text: str) -> bytes | None:
    path = cache_dir() / f"{_key(voice, text)}.pcm"
    try:
        data = path.read_bytes()
    except OSError:
        return None
    return data if 0 < len(data) <= MAX_AUDIO_BYTES and len(data) % 2 == 0 else None


def make_in_background(voice: str, text: str) -> None:
    """Starts making the greeting's audio for later calls (once per greeting per process)."""
    key = _key(voice, text)
    if key in _making or not os.environ.get("OPENAI_API_KEY"):
        return
    _making[key] = asyncio.ensure_future(_make(voice, text, key))


async def _make(voice: str, text: str, key: str) -> None:
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TTS_TIMEOUT_S)) as http:
            async with http.post(
                TTS_URL,
                headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                json={
                    "model": TTS_MODEL,
                    "voice": voice,
                    "input": text,
                    "instructions": TTS_INSTRUCTIONS,
                    "response_format": "pcm",
                },
            ) as resp:
                if resp.status != 200:
                    logger.warning("greeting audio not made: HTTP %s", resp.status)
                    return
                data = await resp.read()
        if not data or len(data) > MAX_AUDIO_BYTES:
            return
        folder = cache_dir()
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / f"{key}.tmp"
        tmp.write_bytes(data[: len(data) - len(data) % 2])
        tmp.replace(folder / f"{key}.pcm")
        logger.info("greeting audio ready (%.1f s)", len(data) / 2 / SAMPLE_RATE)
    except Exception as e:  # a missing cache only means the model says the greeting
        logger.warning("greeting audio not made: %s", type(e).__name__)
    finally:
        with contextlib.suppress(KeyError):
            del _making[key]


async def frames(pcm: bytes) -> AsyncIterator[rtc.AudioFrame]:
    step = FRAME_SAMPLES * 2
    for start in range(0, len(pcm), step):
        chunk = pcm[start : start + step]
        if len(chunk) < step:
            chunk += b"\x00" * (step - len(chunk))
        yield rtc.AudioFrame(chunk, SAMPLE_RATE, 1, FRAME_SAMPLES)
