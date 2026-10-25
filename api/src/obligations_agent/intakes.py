"""Intakes: the form answers and the description, checked against the fact schema (FACT-2, FACT-4, FACT-5)."""

from typing import Literal

from pydantic import BaseModel

from obligations_agent.schema import NOT_SURE, Schema

ErrorCode = Literal["invalid_slot", "invalid_value", "not_found"]


class Intake(BaseModel):
    """The form answers and the description: the body of POST /intakes, and the stored intake."""

    answers: dict[str, str]
    description: dict[str, str]


class IntakeError(Exception):
    """A refused request, with one of the stable error codes of the API."""

    def __init__(self, code: ErrorCode, field: str | None = None) -> None:
        super().__init__(code)
        self.code: ErrorCode = code
        self.field = field


def create_intake(
    schema: Schema, answers: dict[str, str], description: dict[str, str]
) -> Intake:
    """Checks the answers, then the description: first ids that are not in the schema, then each entry in schema order."""
    form_slots = [slot.id for slot in schema.slots]
    for slot_id in answers:
        if slot_id not in form_slots:
            raise IntakeError("invalid_slot", slot_id)
    for slot in schema.slots:
        if answers.get(slot.id) not in [value.id for value in slot.values]:
            raise IntakeError("invalid_value", slot.id)
    fields = [field.id for field in schema.description]
    for field_id in description:
        if field_id not in fields:
            raise IntakeError("invalid_value", field_id)
    for field in schema.description:
        text = description.get(field.id, "")
        if not text.strip() or len(text) > field.max_length:
            raise IntakeError("invalid_value", field.id)
    return Intake(
        answers={slot_id: answers[slot_id] for slot_id in form_slots},
        description={field_id: description[field_id] for field_id in fields},
    )


def open_slots(intake: Intake) -> list[str]:
    """The slots answered "not sure", in schema order."""
    return [slot_id for slot_id, value in intake.answers.items() if value == NOT_SURE]
