"""Tests for reading schema.yaml: acceptance criterion 1 of issue #7 (FACT-1, FACT-2), and the description fields of issue #12."""

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


def schema_text(
    second_slot: dict[str, Any], description: list[dict[str, Any]] = DESCRIPTION
) -> str:
    """A schema.yaml text with the given description fields, a valid first slot and the given second slot."""
    return yaml.safe_dump(
        {"description": description, "slots": [FIRST_SLOT, second_slot]}
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
