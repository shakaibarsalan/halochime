"""Server-side echo cancellation: the delay of the agent's echo is found and the echo taken out."""

from __future__ import annotations

import numpy as np
from livekit import rtc

from talkfront_agent.aec import EchoCanceller

R = 24000


def speechlike(seconds: float, seed: int = 1) -> np.ndarray:
    """Noise shaped into syllables and pauses, loud enough to stand for the agent's voice."""
    rng = np.random.default_rng(seed)
    n = int(R * seconds)
    t = np.arange(n) / R
    envelope = np.clip(np.sin(2 * np.pi * 3.1 * t) * np.sin(2 * np.pi * 0.37 * t + 1.0), 0, None)
    return (rng.standard_normal(n) * envelope * 5000).astype(np.int16)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean((x.astype(np.float64) / 32768) ** 2)))


def run(delay_ms: int, gain: float = 0.1) -> tuple[EchoCanceller, np.ndarray, np.ndarray]:
    agent = speechlike(14.0)
    d = int(R * delay_ms / 1000)
    near = np.zeros(len(agent) + d, dtype=np.int16)
    near[d:] = (agent.astype(np.float64) * gain).astype(np.int16)
    aec = EchoCanceller()
    aec.agent_audio(rtc.AudioFrame(agent.tobytes(), R, 1, len(agent)))  # handed over ahead of time
    step = R // 100
    out = [
        np.frombuffer(bytes(f.data), dtype=np.int16)
        for i in range(0, len(near) - step + 1, step)
        for f in aec.process(rtc.AudioFrame(near[i : i + step].tobytes(), R, 1, step))
    ]
    return aec, near, np.concatenate(out)


def test_echo_late_by_the_network_is_measured_and_removed() -> None:
    aec, near, out = run(800)
    assert aec.measured_ms is not None and abs(aec.measured_ms - 800) <= 30
    assert aec.delay_chunks * 10 == aec.measured_ms - 200  # held back so it arrives 200 ms after its reference
    last = slice(-16000 * 3, None)  # the last 3 s (output is 16 kHz)
    assert rms(out[last]) < 0.2 * rms(near[-R * 3 :])


def test_echo_within_the_cancellers_reach_moves_nothing() -> None:
    aec, near, out = run(250)
    assert aec.delay_chunks == 0
    assert rms(out[-16000 * 3 :]) < 0.2 * rms(near[-R * 3 :])


def test_the_agent_cut_off_leaves_no_reference_behind() -> None:
    aec = EchoCanceller()
    aec.agent_audio(rtc.AudioFrame(speechlike(2.0).tobytes(), R, 1, R * 2))
    aec.agent_cleared()
    assert aec._next_reference().any() == False  # noqa: E712
