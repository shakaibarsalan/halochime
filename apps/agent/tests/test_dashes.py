import asyncio

import pytest

from talkfront_agent.dashes import DashCleaner, clean_dash_stream, clean_dashes

CASES = [
    # The reported reply (25 Nov) and the plain forms.
    ("Apply a thin coat of oil – choji or camellia oil for katanas.", "Apply a thin coat of oil, choji or camellia oil for katanas."),
    ("We ship worldwide — insured and tracked.", "We ship worldwide, insured and tracked."),
    ("We ship worldwide—insured and tracked.", "We ship worldwide, insured and tracked."),
    # Ranges stay ranges, without spaces.
    ("Packed within 3–5 working days.", "Packed within 3–5 working days."),
    ("Packed within 3 – 5 working days.", "Packed within 3–5 working days."),
    ("Packed within 3—5 working days.", "Packed within 3–5 working days."),
    # No doubled punctuation; a dash after a full stop or colon just goes.
    ("Use oil, – choji works best.", "Use oil, choji works best."),
    ("Note: — we ship insured.", "Note: we ship insured."),
    # Bullets and line ends.
    ("Options:\n– bank transfer\n— cash", "Options:\n- bank transfer\n- cash"),
    ("– bank transfer first", "- bank transfer first"),
    ("Thanks —\nSee you", "Thanks\nSee you"),
    ("Thanks —", "Thanks"),
    # Untouched: hyphens, unspaced en dash between words, plain text, "e.g.,".
    ("A well-kept blade, e.g., a Paris–London route.", "A well-kept blade, e.g., a Paris–London route."),
    ("", ""),
]


@pytest.mark.parametrize(("raw", "want"), CASES)
def test_clean_dashes(raw, want):
    assert clean_dashes(raw) == want


@pytest.mark.parametrize(("raw", "want"), CASES)
def test_streamed_in_any_pieces_gives_the_same_text(raw, want):
    # Every split of the text into pieces of 1, 2, 3 and 5 characters gives the same result.
    for size in (1, 2, 3, 5):
        cleaner = DashCleaner()
        out = "".join(cleaner.push(raw[i : i + size]) for i in range(0, len(raw), size)) + cleaner.flush()
        assert out == want, (size, out)


def test_clean_dash_stream():
    async def pieces():
        for p in ["Apply a thin coat of oil ", "–", " choji or ", "camellia oil, packed in 3", "–5 days."]:
            yield p

    async def run():
        return "".join([p async for p in clean_dash_stream(pieces())])

    assert asyncio.run(run()) == "Apply a thin coat of oil, choji or camellia oil, packed in 3–5 days."


def test_runtime_no_dashes_switch():
    from talkfront_agent.api import parse_runtime_config

    from .test_metadata import runtime_payload

    assert parse_runtime_config(runtime_payload()).agent.no_dashes is False
    data = runtime_payload()
    data["agent"]["noDashes"] = True
    assert parse_runtime_config(data).agent.no_dashes is True
    data["agent"]["noDashes"] = "yes"
    assert parse_runtime_config(data).agent.no_dashes is False
