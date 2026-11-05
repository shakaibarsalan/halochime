from __future__ import annotations

from talkfront_agent.echo import ECHO_LAG_S, STT_DELAY_S, EchoGuard, echo_coverage, script_of

SAID = (
    "Yes. Talkfront can recognize the visitor's language automatically, with the default realtime voices. "
    "If you're all set and don't need anything else, I'll end the chat."
)
SAID_URDU = "بالکل! Talkfront کو آپ کی ویب سائٹ پر لگانا آسان ہے۔"


class Clock:
    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


def guard_speaking(said: str = SAID) -> tuple[EchoGuard, Clock]:
    clock = Clock()
    guard = EchoGuard(clock=clock)
    guard.set_agent_speaking(True)
    guard.agent_said(said)
    clock.t += 3
    return guard, clock


def test_echo_with_transcription_mistakes_is_recognised() -> None:
    assert echo_coverage("talk front can recognise the visitor language automatically", SAID) > 0.9
    assert echo_coverage("if your all set and dont need anything else ill and the chat", SAID) > 0.9


def test_visitor_question_about_the_same_topic_is_not_echo() -> None:
    assert echo_coverage("could you also tell me that you can automatically convert the language", SAID) < 0.6


def test_script_of_mixed_text_is_its_main_script() -> None:
    assert script_of(SAID_URDU) == "ARABIC"
    assert script_of("बिल्कुल, टॉकफंड को आपकी") == "DEVANAGARI"
    assert script_of("Velkol.") == "LATIN"


def test_agents_own_words_are_ignored_while_it_speaks() -> None:
    guard, _ = guard_speaking()
    heard: list[int] = []
    guard.on_visitor_words = lambda: heard.append(1)
    assert guard.heard("with the default real time voices", duration=1.5) is False
    assert guard.heard("Yes,", duration=0.3) is False  # a one-word echo
    assert guard.heard("Asked the", final=False, duration=0.5) is False  # short and garbled
    assert heard == []


def test_urdu_echo_written_in_another_script_is_ignored() -> None:
    # Seen in a test call: Urdu replies came back as Hindi or as made-up Latin words.
    guard, _ = guard_speaking(SAID_URDU)
    assert guard.is_echo("बिल्कुल, टॉकफंड को आपकी", duration=1.2)
    assert guard.is_echo("Velkol.", duration=0.4)


def test_visitor_barging_in_is_heard() -> None:
    guard, _ = guard_speaking()
    heard: list[int] = []
    guard.on_visitor_words = lambda: heard.append(1)
    assert guard.heard("wait, how much does it cost", duration=1.2) is True
    assert guard.heard("stop", duration=0.3) is True
    assert heard == [1, 1]
    assert not guard.visitor_silent_while_agent_spoke()


def test_last_words_echo_reported_late_still_counts() -> None:
    guard, clock = guard_speaking()
    guard.set_agent_speaking(False)
    # "I'll end the chat" said in the last moment, reported 1.5 s later.
    clock.t += 1.5
    assert guard.is_echo("I'll end the chat", duration=1.5 - STT_DELAY_S + 0.2)


def test_visitor_reply_after_the_agent_stops_is_heard_in_any_script() -> None:
    guard, clock = guard_speaking()
    guard.set_agent_speaking(False)
    clock.t += ECHO_LAG_S + STT_DELAY_S + 1.0
    assert not guard.is_echo("haan, ek aur sawal", duration=0.8)
    assert not guard.is_echo("हाँ, एक और सवाल", duration=0.8)
    assert not guard.is_echo("I'll end the chat", duration=0.5)  # repeating the agent long after it spoke
    assert guard.visitor_silent_while_agent_spoke()


def test_speech_that_began_before_the_agent_spoke_is_the_visitors() -> None:
    clock = Clock()
    guard = EchoGuard(clock=clock)
    clock.t += 3
    guard.set_agent_speaking(True)
    guard.agent_said(SAID)
    clock.t += 1
    # Four seconds of speech ending now: it started well before the agent did.
    assert not guard.is_echo("हाँ, एक और सवाल", duration=4.0)


def test_badly_heard_echo_and_unfinished_words_wait() -> None:
    guard, _ = guard_speaking(
        "No, you don't need a credit card to get started. New workspaces get 30 free voice minutes with no card needed."
    )
    # Seen in a test call: echo heard with mistakes, most words still the agent's.
    assert guard.is_echo("new workspaces get thirty free voice minutes with no commitment", duration=2.0)
    # Unfinished words partly like the agent's are held until their final words arrive.
    assert guard.is_echo("credit card to get star", final=False, duration=1.0)
    assert not guard.is_echo("can you tell me the price", final=False, duration=1.0)


def test_late_words_are_placed_by_their_audio_time() -> None:
    guard, clock = guard_speaking()
    spoke_at = clock.t - 1.0
    guard.set_agent_speaking(False)
    # A busy server hands the echo over 6 s late: its audio time still puts it in the agent's turn.
    clock.t += 6.0
    assert guard.is_echo("with the default real time voices", started_at=spoke_at, duration=1.5)
    # The visitor's reply long after, even repeating the agent, is theirs.
    assert not guard.is_echo("with the default real time voices", started_at=clock.t - 1.0, duration=1.0)


def test_echo_of_the_first_words_timed_slightly_early_still_counts() -> None:
    guard, clock = guard_speaking()
    started = clock.t - 3
    assert guard.is_echo("yes talkfront can recognize", started_at=started - 0.2, duration=1.0)


def test_echo_timed_early_by_a_busy_server_still_counts() -> None:
    # 5 Nov: the agent's goodbye came back word for word, timed 1.5 s before the agent began speaking.
    clock = Clock()
    guard = EchoGuard(clock=clock)
    guard.set_agent_speaking(True)
    began_speaking = clock.t
    guard.agent_said("Thanks for staying with me. I'm glad you shared this.")
    clock.t += 3
    assert guard.is_echo("thanks for staying with me", started_at=began_speaking - 1.5, duration=1.4)
    # A short reply or the visitor's own words that early are still theirs.
    assert not guard.is_echo("thanks", started_at=began_speaking - 1.5, duration=0.4)
    assert not guard.is_echo("can you stay with me on this", started_at=began_speaking - 1.5, duration=1.4)
    # Said long ago: not echo whatever the timing.
    guard.set_agent_speaking(False)
    clock.t += 20
    guard.set_agent_speaking(True)
    assert not guard.is_echo("thanks for staying with me", started_at=clock.t - 1.5, duration=1.4)


def test_talking_over_the_agent_is_reported() -> None:
    guard, _ = guard_speaking()
    calls: list[int] = []
    guard.talked_over()  # nobody listening: nothing happens
    guard.on_talked_over = lambda: calls.append(1)
    guard.talked_over()
    assert calls == [1]


def test_nothing_is_echo_before_the_agent_said_anything() -> None:
    guard = EchoGuard()
    guard.set_agent_speaking(True)
    assert not guard.is_echo("hello can you hear me", duration=1.0)


def _tone(rms: float, seconds: float = 0.1, rate: int = 16000):  # type: ignore[no-untyped-def]
    import numpy as np

    n = int(rate * seconds)
    return (np.sin(np.arange(n) * 0.3) * rms * 2**0.5 * 32767).astype(np.int16)


def second_turn(guard: EchoGuard, clock: Clock) -> None:
    guard.set_agent_speaking(False)
    clock.t += 2
    guard.set_agent_speaking(True)


def test_visitor_talking_over_the_agent_is_recognised_by_loudness() -> None:
    guard, clock = guard_speaking()
    second_turn(guard, clock)
    for _ in range(40):  # 4 s of quiet echo while the agent talks
        clock.t += 0.1
        guard.hear_audio(_tone(0.004), 16000, clock.t)
    assert not guard.visitor_loud_now()
    loud_from = clock.t
    for _ in range(4):  # the visitor, much louder
        clock.t += 0.1
        guard.hear_audio(_tone(0.08), 16000, clock.t)
    assert guard.visitor_loud_now()
    # Their words count, even in another script than the agent's.
    assert not guard.is_echo("हाँ, एक मिनट रुको", started_at=loud_from + 0.05, duration=0.8)


def test_echo_level_rises_with_loud_echo_so_it_never_counts_as_the_visitor() -> None:
    guard, clock = guard_speaking()
    for _ in range(30):  # loud echo (speakers up, no echo cancellation)
        clock.t += 0.1
        guard.hear_audio(_tone(0.05), 16000, clock.t)
    assert not guard.visitor_loud_now()


def test_loudness_needs_the_echo_level_first() -> None:
    guard, clock = guard_speaking()
    for _ in range(4):
        clock.t += 0.1
        guard.hear_audio(_tone(0.08), 16000, clock.t)
    assert not guard.visitor_loud_now()  # nothing learned yet: only words can stop the agent


def test_echo_after_a_silent_start_is_not_taken_for_the_visitor() -> None:
    # The loop seen in a test call: the level was learned from the silence before the echo arrived.
    clock = Clock()
    guard = EchoGuard(clock=clock)
    guard.set_agent_speaking(True)
    guard.agent_said(SAID)
    for _ in range(10):  # the echo is still on its way
        clock.t += 0.1
        guard.hear_audio(_tone(0.0), 16000, clock.t)
    for _ in range(40):  # then loud echo for 4 s
        clock.t += 0.1
        guard.hear_audio(_tone(0.04), 16000, clock.t)
    assert not guard.visitor_loud_now()


def test_loud_words_that_repeat_the_agent_are_still_echo() -> None:
    guard, clock = guard_speaking()
    second_turn(guard, clock)
    for _ in range(40):
        clock.t += 0.1
        guard.hear_audio(_tone(0.004), 16000, clock.t)
    loud_from = clock.t
    for _ in range(5):
        clock.t += 0.1
        guard.hear_audio(_tone(0.08), 16000, clock.t)
    assert guard.is_echo("with the default real time voices", started_at=loud_from, duration=0.5)
    # ... and the bar for "loud" goes up, so the same echo won't stop the agent next time.
    assert guard._loud_threshold() > 0.03 * 1.5


def test_hindi_words_keep_their_vowel_signs_and_hindi_echo_is_caught() -> None:
    from talkfront_agent.echo import _words

    assert _words("मासिक प्लान") == ["मासिक", "प्लान"]
    said = "मैं सीधा और साफ बताता हूँ: अभी Talkfront के लिए कोई फिक्स्ड मासिक प्लान या कीमत प्रकाशित नहीं है।"
    guard, _ = guard_speaking(said)
    # Seen in a test call: Tara's Hindi came back with words garbled.
    heard = "मेसीरा और सॉफ्ट डाटा अभी डॉक फ्रंट के लिए कोई फिक्स्ड मासिक प्लान या कीमत प्रकाशित नहीं है।"
    assert guard.is_echo(heard, duration=3.0)


def test_no_stopping_for_loudness_during_the_greeting() -> None:
    guard, clock = guard_speaking()
    for _ in range(40):
        clock.t += 0.1
        guard.hear_audio(_tone(0.004), 16000, clock.t)
    for _ in range(5):
        clock.t += 0.1
        guard.hear_audio(_tone(0.1), 16000, clock.t)
    assert not guard.visitor_loud_now()


def test_held_audio_is_echo_until_something_like_the_visitor_is_heard() -> None:
    guard, clock = guard_speaking()
    for _ in range(50):  # 3 s to learn the echo's level, then 2 s of only echo
        clock.t += 0.1
        guard.hear_audio(_tone(0.004), 16000, clock.t)
    assert guard.held_audio_is_echo()
    clock.t += 0.1
    guard.hear_audio(_tone(0.03), 16000, clock.t)  # a quieter voice, still well over the echo
    assert not guard.held_audio_is_echo()
