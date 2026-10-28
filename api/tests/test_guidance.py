"""Tests for reading guidance.yaml and for its quotes: the acceptance criteria of issue #29 (FACT-6), and the check that every quote stands under its own heading."""

import re
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from obligations_agent.guidance import (
    Entry,
    GuidanceError,
    load_guidance,
    parse_guidance,
)
from obligations_agent.schema import load_schema

SCHEMA = load_schema()
GUIDANCE = load_guidance(SCHEMA)
COPIES = Path(__file__).resolve().parents[2] / "docs" / "guidance"

SOURCE = {
    "id": "ec_data_protection_explained",
    "title": "Data protection explained",
    "body": "European Commission",
    "link": "https://commission.europa.eu/law/law-topic/data-protection/reform/what-personal-data_en",
    "checked": date(2026, 10, 28),
    "terms": "CC BY 4.0, https://commission.europa.eu/legal-notice_en",
    "stored_copy": "ec-data-protection-explained.txt",
}

ENTRY = {
    "id": "email_address",
    "slot": "personal_data",
    "source": "ec_data_protection_explained",
    "two_sided": True,
    "quotes": [
        {
            "heading": "Examples of personal data",
            "text": "an email address such as 'name.surname@company.com'",
        }
    ],
}


def guidance_text(
    entries: Sequence[dict[str, Any]] = (ENTRY,),
    sources: Sequence[dict[str, Any]] = (SOURCE,),
) -> str:
    """A guidance.yaml text with the given entries and sources."""
    return yaml.safe_dump({"sources": list(sources), "entries": list(entries)})


def without(item: dict[str, Any], part: str) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key != part}


def normalized(text: str) -> str:
    """The text with each run of spaces and line breaks as one space, and none after a hyphen, so that a compound word broken at the end of a line in a PDF still matches."""
    return " ".join(text.split()).replace("- ", "-")


def copy_of(entry: Entry) -> str:
    """The text of the stored copy of the entry's source, after its header, normalized."""
    source = next(source for source in GUIDANCE.sources if source.id == entry.source)
    text = (COPIES / source.stored_copy).read_text(encoding="utf-8")
    return normalized(text.split("\n---\n", 1)[1])


def test_a_valid_file_is_read() -> None:
    guidance = parse_guidance(guidance_text(), SCHEMA)

    assert [entry.id for entry in guidance.entries] == ["email_address"]
    assert guidance.sources[0].checked == date(2026, 10, 28)


def test_a_key_used_twice_is_refused_with_its_line() -> None:
    # Without the check, PyYAML keeps only the last value of a repeated key.
    text = """\
sources: []
entries: []
entries: []
"""

    with pytest.raises(GuidanceError, match=r"\bline 3\b.*\bentries\b"):
        parse_guidance(text, SCHEMA)


@pytest.mark.parametrize(
    ("part", "value"),
    [("slot", "not_a_slot"), ("source", "not_a_source")],
)
def test_an_entry_that_names_a_missing_slot_or_source_is_refused_with_its_name(
    part: str, value: str
) -> None:
    with pytest.raises(GuidanceError, match=r"\bentry email_address\b"):
        parse_guidance(guidance_text([{**ENTRY, part: value}]), SCHEMA)


def test_an_entry_id_used_twice_is_refused_with_the_id() -> None:
    with pytest.raises(GuidanceError, match=r"\bemail_address\b.*\bused twice\b"):
        parse_guidance(guidance_text([ENTRY, ENTRY]), SCHEMA)


def test_a_source_id_used_twice_is_refused_with_the_id() -> None:
    with pytest.raises(
        GuidanceError, match=r"\bec_data_protection_explained\b.*\bused twice\b"
    ):
        parse_guidance(guidance_text(sources=[SOURCE, SOURCE]), SCHEMA)


@pytest.mark.parametrize(
    ("entry", "name", "part"),
    [
        # An entry without an id is named by its position in the list.
        (without(ENTRY, "id"), "1", "id"),
        (without(ENTRY, "slot"), "email_address", "slot"),
        (without(ENTRY, "source"), "email_address", "source"),
        (without(ENTRY, "two_sided"), "email_address", "two_sided"),
        ({**ENTRY, "quotes": []}, "email_address", "quotes"),
        (
            {**ENTRY, "quotes": [{"text": "a name and surname"}]},
            "email_address",
            "heading",
        ),
        (
            {**ENTRY, "quotes": [{"heading": "", "text": "a name and surname"}]},
            "email_address",
            "heading",
        ),
        (
            {**ENTRY, "quotes": [{"heading": "Examples of personal data", "text": ""}]},
            "email_address",
            "text",
        ),
    ],
)
def test_an_entry_without_a_part_is_refused_with_its_name_and_the_part(
    entry: dict[str, Any], name: str, part: str
) -> None:
    with pytest.raises(GuidanceError, match=rf"(?s)\bentry {name}\b.*\b{part}\b"):
        parse_guidance(guidance_text([entry]), SCHEMA)


@pytest.mark.parametrize(
    "part", ["id", "title", "body", "link", "checked", "terms", "stored_copy"]
)
def test_a_source_without_a_part_is_refused_with_its_name_and_the_part(
    part: str,
) -> None:
    # A source without an id is named by its position in the list.
    name = "1" if part == "id" else "ec_data_protection_explained"

    with pytest.raises(GuidanceError, match=rf"(?s)\bsource {name}\b.*\b{part}\b"):
        parse_guidance(guidance_text([], [without(SOURCE, part)]), SCHEMA)


def test_a_source_with_an_empty_title_is_refused_with_its_name() -> None:
    with pytest.raises(
        GuidanceError, match=r"(?s)\bsource ec_data_protection_explained\b.*\btitle\b"
    ):
        parse_guidance(guidance_text([], [{**SOURCE, "title": ""}]), SCHEMA)


def test_an_entry_with_an_empty_id_is_refused() -> None:
    with pytest.raises(GuidanceError, match=r"(?s)\bentry\b.*\bid\b"):
        parse_guidance(guidance_text([{**ENTRY, "id": ""}]), SCHEMA)


def test_every_entry_of_the_file_belongs_to_one_of_the_three_slots() -> None:
    assert {entry.slot for entry in GUIDANCE.entries} == {
        "personal_data",
        "decides_purposes",
        "under_own_name",
    }


@pytest.mark.parametrize("entry", GUIDANCE.entries, ids=lambda entry: entry.id)
def test_every_quote_of_the_file_is_in_the_copy_of_its_source(entry: Entry) -> None:
    copy = copy_of(entry)

    assert [
        quote.text for quote in entry.quotes if normalized(quote.text) not in copy
    ] == []


@pytest.mark.parametrize("entry", GUIDANCE.entries, ids=lambda entry: entry.id)
def test_every_quote_of_the_file_is_under_its_heading(entry: Entry) -> None:
    # Of the headings that the file uses for this source, the last one before the quote must be
    # the quote's own heading. In a list, the heading says on which side an item is.
    copy = copy_of(entry)
    headings = {
        normalized(quote.heading)
        for other in GUIDANCE.entries
        if other.source == entry.source
        for quote in other.quotes
    }

    def heading_before(position: int) -> str:
        index, heading = max(
            (copy.rfind(heading, 0, position), heading) for heading in headings
        )
        return heading if index >= 0 else ""

    assert [
        quote.text
        for quote in entry.quotes
        if not any(
            heading_before(match.start()) == normalized(quote.heading)
            for match in re.finditer(re.escape(normalized(quote.text)), copy)
        )
    ] == []
