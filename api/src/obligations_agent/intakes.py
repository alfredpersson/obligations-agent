"""Intakes: the form answers and the description, checked against the fact schema (FACT-2, FACT-4, FACT-5)."""

import secrets
from dataclasses import dataclass

from obligations_agent.schema import NOT_SURE, Schema


@dataclass(frozen=True)
class Intake:
    description: str
    answers: dict[str, str]


class IntakeError(Exception):
    """A refused request. The code is one of the stable error codes of the API."""

    def __init__(self, code: str, field: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.field = field


def create_intake(schema: Schema, answers: dict[str, str], description: str) -> Intake:
    """Checks slots that are not on the form, then each form slot in schema order, then the description."""
    form_slots = [slot.id for slot in schema.slots]
    for slot_id in answers:
        if slot_id not in form_slots:
            raise IntakeError("invalid_slot", slot_id)
    for slot in schema.slots:
        if answers.get(slot.id) not in [value.id for value in slot.values]:
            raise IntakeError("invalid_value", slot.id)
    if not description.strip() or len(description) > schema.description.max_length:
        raise IntakeError("invalid_value", "description")
    return Intake(description, {slot_id: answers[slot_id] for slot_id in form_slots})


def open_slots(intake: Intake) -> list[str]:
    """The slots answered "not sure", in schema order."""
    return [slot_id for slot_id, value in intake.answers.items() if value == NOT_SURE]


def new_intake_id() -> str:
    """A random id of 128 bits, as 22 URL-safe characters."""
    return secrets.token_urlsafe(16)
