"""Live captions are numbered by the realtime model's messages; cut replies are reported to the widget."""

from __future__ import annotations

from talkfront_agent.agent import on_audio_commit, reply_played_s
from talkfront_agent.live_captions import LiveCaptions


def captions() -> LiveCaptions:
    c = LiveCaptions.__new__(LiveCaptions)  # no Deepgram connection needed for the turn logic
    c._init_turns()
    return c


def heard(c: LiveCaptions, text: str, *, final: bool) -> int:
    """What _run does with a caption that is not echo: its turn, and the sentence left open or not."""
    turn = c._turn_for(final)
    c._sentence_open = not final
    if final:
        c._finals.append(text)
    return turn


def test_a_caption_turn_lasts_until_the_audio_is_committed() -> None:
    c = captions()
    assert heard(c, "so I wanted to ask", final=True) == 0
    assert heard(c, "about your prices", final=True) == 0  # a short pause, no commit: same turn
    c.committed()
    assert heard(c, "and the delivery", final=False) == 1
    assert c._finals == []  # the new turn shows only its own words


def test_commits_without_caption_words_skip_their_turn_numbers() -> None:
    c = captions()
    assert heard(c, "hello", final=True) == 0
    c.committed()
    c.committed()  # a message with no caption words (all taken as echo, say) still gets a transcript
    assert heard(c, "are you there", final=True) == 2  # caption turn 2 is the model's third message


def test_a_sentence_open_at_the_commit_keeps_its_final_words_in_the_old_turn() -> None:
    c = captions()
    c._finals = ["first words"]
    assert heard(c, "and then", final=False) == 0  # an interim was shown, its final not yet in
    c.committed()
    assert heard(c, "and then some", final=True) == 0  # the final words of that sentence
    assert c._finals == ["first words", "and then some"]
    assert heard(c, "next", final=False) == 1  # the visitor speaks again: next turn
    assert c._finals == []

    c._sentence_open = False
    c.committed()
    assert heard(c, "new sentence", final=True) == 2  # nothing was open: a new sentence, a new turn


def test_the_agent_starting_to_answer_no_longer_ends_a_caption_turn() -> None:
    # Realtime replies rarely say "thinking", and a reply resumed after a false interruption says
    # "speaking" again: the agent's state is not the model's messages. Only a commit moves the turn.
    c = captions()
    assert not hasattr(c, "end_turn")
    assert heard(c, "one", final=True) == 0
    assert heard(c, "two", final=False) == 0
    assert heard(c, "two three", final=True) == 0
    c.committed()
    c.committed()
    assert heard(c, "four", final=True) == 2  # two messages since: turn 1 had no caption words


class FakeRealtime:
    """The parts of the OpenAI realtime session the commit hook uses."""

    def __init__(self) -> None:
        self._pushed_duration_s = 0.0
        self.sent = 0
        self.handlers: dict[str, object] = {}

    def commit_audio(self) -> None:
        if self._pushed_duration_s > 0.1:  # as the plugin: OpenAI needs at least 100 ms of audio
            self.sent += 1
            self._pushed_duration_s = 0

    def on(self, event: str, callback: object) -> None:
        self.handlers[event] = callback


def test_only_real_commits_end_a_caption_turn() -> None:
    rt = FakeRealtime()
    c = captions()
    on_audio_commit(rt, c.committed, server_turns=False)  # type: ignore[arg-type]
    rt._pushed_duration_s = 0.05
    rt.commit_audio()  # too little audio: nothing sent, no message
    assert (rt.sent, c._commits) == (0, 0)
    rt._pushed_duration_s = 1.4
    rt.commit_audio()
    assert (rt.sent, c._commits) == (1, 1)


def test_openai_turn_detection_commits_when_the_visitor_stops() -> None:
    rt = FakeRealtime()
    c = captions()
    on_audio_commit(rt, c.committed, server_turns=True)  # type: ignore[arg-type]
    rt.handlers["input_speech_stopped"](object())  # type: ignore[operator]
    assert c._commits == 1


def test_played_seconds_of_a_cut_reply() -> None:
    assert reply_played_s({"started_speaking_at": 100.0, "stopped_speaking_at": 101.234}) == 1.23
    assert reply_played_s({"started_speaking_at": 100.0}) is None
    assert reply_played_s(None) is None
