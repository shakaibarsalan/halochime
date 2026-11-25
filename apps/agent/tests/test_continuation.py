from talkfront_agent.api import parse_runtime_config

from .test_metadata import runtime_payload


def test_runtime_continuation_is_off_unless_sent():
    assert parse_runtime_config(runtime_payload()).continuation is None
    for bad in ("yes", {}, {"opener": ""}, {"opener": "   "}, {"opener": 3}):
        data = runtime_payload()
        data["continuation"] = bad
        assert parse_runtime_config(data).continuation is None


def test_runtime_reads_the_continuation_opener():
    data = runtime_payload()
    data["continuation"] = {"opener": "Pick up where you left off."}
    rt = parse_runtime_config(data)
    assert rt.continuation is not None
    assert rt.continuation.opener == "Pick up where you left off."
