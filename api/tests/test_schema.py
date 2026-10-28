"""Tests for reading schema.yaml: acceptance criterion 1 of issue #7 (FACT-1, FACT-2), the description fields of issue #12, and the relevance conditions of issue #16."""

from collections.abc import Sequence
from typing import Any

import pytest
import yaml

from obligations_agent.schema import SchemaError, parse_schema

DESCRIPTION = [
    {
        "id": "what_it_does",
        "label": "What it does",
        "question": "What does the product do?",
        "max_length": 500,
    },
]

YES_NO_NOT_SURE = [
    {"id": "yes", "label": "Yes"},
    {"id": "no", "label": "No"},
    {"id": "not_sure", "label": "Not sure"},
]

FIRST_SLOT = {
    "id": "under_own_name",
    "label": "Under own name or trademark",
    "question": "Do you place the product on the market under your own name?",
    "relevant": "always",
    "unit": "aia:art3(3)",
    "values": YES_NO_NOT_SURE,
}

SECOND_SLOT = {
    "id": "personal_data",
    "label": "Personal data",
    "question": "Does the product process personal data?",
    "relevant": "always",
    "unit": "gdpr:art4(1)",
    "values": YES_NO_NOT_SURE,
}

# Relevant when under_own_name, the first slot, is yes or not sure.
FOLLOW_UP_SLOT = {
    "id": "interacts_with_people",
    "label": "Interacts with people",
    "question": "Do people interact with the product directly?",
    "relevant": {"under_own_name": ["yes", "not_sure"]},
    "unit": "aia:art50(1)",
    "values": YES_NO_NOT_SURE,
}


def schema_text(
    second_slot: dict[str, Any],
    description: list[dict[str, Any]] = DESCRIPTION,
    later_slots: Sequence[dict[str, Any]] = (),
) -> str:
    """A schema.yaml text with the given description fields, a valid first slot, the given second slot and any later slots."""
    return yaml.safe_dump(
        {
            "description": description,
            "slots": [FIRST_SLOT, second_slot, *later_slots],
        }
    )


def test_a_valid_schema_is_read() -> None:
    schema = parse_schema(schema_text(SECOND_SLOT))

    assert [slot.id for slot in schema.slots] == ["under_own_name", "personal_data"]


def test_the_description_fields_are_read_in_order() -> None:
    second_field = {**DESCRIPTION[0], "id": "who_uses_it", "max_length": 300}

    schema = parse_schema(schema_text(SECOND_SLOT, [*DESCRIPTION, second_field]))

    assert [(field.id, field.max_length) for field in schema.description] == [
        ("what_it_does", 500),
        ("who_uses_it", 300),
    ]


def test_a_description_field_id_used_twice_is_refused_with_its_name() -> None:
    with pytest.raises(SchemaError, match=r"\bdescription field what_it_does\b"):
        parse_schema(schema_text(SECOND_SLOT, [*DESCRIPTION, DESCRIPTION[0]]))


def test_a_description_field_id_that_is_also_a_slot_id_is_refused_with_its_name() -> (
    None
):
    field = {**DESCRIPTION[0], "id": "personal_data"}

    with pytest.raises(SchemaError, match=r"\bdescription field personal_data\b"):
        parse_schema(schema_text(SECOND_SLOT, [field]))


@pytest.mark.parametrize(
    ("field", "name"),
    [
        # A slot without an id is named by its position in the list.
        ("id", "2"),
        ("label", "personal_data"),
        ("question", "personal_data"),
        ("values", "personal_data"),
        ("relevant", "personal_data"),
        ("unit", "personal_data"),
    ],
)
def test_a_slot_without_a_field_is_refused_with_its_name(field: str, name: str) -> None:
    slot = {key: value for key, value in SECOND_SLOT.items() if key != field}

    with pytest.raises(SchemaError, match=rf"\bslot {name}\b"):
        parse_schema(schema_text(slot))


def test_a_slot_without_the_value_not_sure_is_refused_with_its_name() -> None:
    slot = {
        **SECOND_SLOT,
        "values": [{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}],
    }

    with pytest.raises(SchemaError, match=r"\bslot personal_data\b"):
        parse_schema(schema_text(slot))


def test_an_unquoted_yes_is_refused_with_the_slot_name() -> None:
    # PyYAML reads yes without quotes as the boolean true, not as text.
    text = """
description: [{id: what_it_does, label: What it does, question: "What does the product do?", max_length: 500}]
slots:
  - id: personal_data
    label: Personal data
    question: Does the product process personal data?
    relevant: always
    unit: "gdpr:art4(1)"
    values:
      - {id: yes, label: "Yes"}
      - {id: not_sure, label: Not sure}
"""

    with pytest.raises(SchemaError, match=r"\bslot personal_data\b"):
        parse_schema(text)


def test_a_second_slots_key_is_refused_with_its_line() -> None:
    # Without the check, PyYAML keeps only the last value of a repeated key.
    text = """\
description: [{id: what_it_does, label: What it does, question: "What does the product do?", max_length: 500}]
slots:
  - {id: a, label: A, question: Q, relevant: always, unit: u, values: [{id: not_sure, label: Not sure}]}
slots:
  - {id: b, label: B, question: Q, relevant: always, unit: u, values: [{id: not_sure, label: Not sure}]}
"""

    with pytest.raises(SchemaError, match=r"\bline 4\b.*\bslots\b"):
        parse_schema(text)


def test_a_second_label_line_in_a_slot_is_refused_with_its_line() -> None:
    text = """\
description: [{id: what_it_does, label: What it does, question: "What does the product do?", max_length: 500}]
slots:
  - id: personal_data
    label: Personal data
    label: Personal data processing
    question: Does the product process personal data?
    relevant: always
    unit: "gdpr:art4(1)"
    values:
      - {id: not_sure, label: Not sure}
"""

    with pytest.raises(SchemaError, match=r"\bline 5\b.*\blabel\b"):
        parse_schema(text)


def test_a_slot_id_used_twice_is_refused_with_its_name() -> None:
    slot = {**SECOND_SLOT, "id": "under_own_name"}

    with pytest.raises(SchemaError, match=r"\bslot under_own_name\b"):
        parse_schema(schema_text(slot))


def test_a_value_id_used_twice_in_a_slot_is_refused_with_its_name() -> None:
    slot = {
        **SECOND_SLOT,
        "values": [
            {"id": "yes", "label": "Yes"},
            {"id": "yes", "label": "No"},
            {"id": "not_sure", "label": "Not sure"},
        ],
    }

    with pytest.raises(SchemaError, match=r"\bslot personal_data\b"):
        parse_schema(schema_text(slot))


def test_a_relevance_condition_is_read() -> None:
    schema = parse_schema(schema_text(FOLLOW_UP_SLOT))

    assert schema.follow_up_slots[0].relevant == {"under_own_name": ["yes", "not_sure"]}


@pytest.mark.parametrize(
    ("relevant", "later_slots"),
    [
        pytest.param({"personal_data": ["yes"]}, [SECOND_SLOT], id="a later slot"),
        pytest.param({"interacts_with_people": ["yes"]}, [], id="the slot itself"),
        pytest.param({"uses_camera": ["yes"]}, [], id="an id that is not a slot"),
        pytest.param({"what_it_does": ["yes"]}, [], id="a description field"),
        pytest.param(
            {"under_own_name": ["maybe"]}, [], id="a value that the slot does not have"
        ),
        pytest.param({}, [], id="an empty condition"),
        pytest.param({"under_own_name": []}, [], id="an empty list of values"),
        pytest.param("sometimes", [], id="a text other than always"),
    ],
)
def test_a_broken_relevance_condition_is_refused_with_the_slot_name(
    relevant: dict[str, list[str]] | str, later_slots: list[dict[str, Any]]
) -> None:
    slot = {**FOLLOW_UP_SLOT, "relevant": relevant}

    with pytest.raises(SchemaError, match=r"\bslot interacts_with_people\b"):
        parse_schema(schema_text(slot, later_slots=later_slots))


def test_an_unquoted_yes_in_a_relevance_condition_is_refused_with_the_slot_name() -> (
    None
):
    # PyYAML reads yes without quotes as the boolean true, not as text.
    text = """
description: [{id: what_it_does, label: What it does, question: "What does the product do?", max_length: 500}]
slots:
  - id: under_own_name
    label: Under own name or trademark
    question: Do you place the product on the market under your own name?
    relevant: always
    unit: "aia:art3(3)"
    values:
      - {id: "yes", label: "Yes"}
      - {id: not_sure, label: Not sure}
  - id: interacts_with_people
    label: Interacts with people
    question: Do people interact with the product directly?
    relevant:
      under_own_name: [yes, not_sure]
    unit: "aia:art50(1)"
    values:
      - {id: "yes", label: "Yes"}
      - {id: not_sure, label: Not sure}
"""

    with pytest.raises(SchemaError, match=r"\bslot interacts_with_people\b"):
        parse_schema(text)
