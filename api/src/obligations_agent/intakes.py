"""Intakes: the form answers and the description, checked against the fact schema (FACT-2, FACT-4, FACT-5), and the follow-up questions that code asks (INTAKE-1, INTAKE-3)."""

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel

from obligations_agent.schema import NOT_SURE, Schema, Slot

ErrorCode = Literal["invalid_slot", "invalid_value", "not_found"]

# Follow-up questions per intake (INTAKE-3).
QUESTION_LIMIT = 8


class Form(BaseModel):
    """The form answers and the description: the body of POST /intakes."""

    answers: dict[str, str]
    description: dict[str, str]


class Option(BaseModel):
    """A choice in a question: an allowed value of the slot, and the text that the user sees."""

    value: str
    label: str


class Question(BaseModel):
    """A follow-up question: the slot it asks about, its text and its options."""

    slot: str
    text: str
    options: list[Option]


class Intake(Form):
    """A stored intake. The answers include the follow-up answers, and questions holds each follow-up question, in the order asked."""

    questions: list[Question] = []


Writer = Callable[[Slot, Intake], Question]


class Answer(BaseModel):
    """The body of POST /intakes/{id}/answers: the number of a question, and the value of one of its options."""

    question: int
    value: str


class IntakeError(Exception):
    """A refused request, with one of the stable error codes of the API."""

    def __init__(self, code: ErrorCode, field: str | None = None) -> None:
        super().__init__(code)
        self.code: ErrorCode = code
        self.field = field


def is_relevant(slot: Slot, answers: dict[str, str]) -> bool:
    """A slot on the form is always relevant. A follow-up slot is relevant when each slot in its condition has one of the values listed for it (FACT-1)."""
    return slot.relevant == "always" or all(
        answers.get(slot_id) in values for slot_id, values in slot.relevant.items()
    )


def default_question(slot: Slot) -> Question:
    """The question with the default text of the slot, and the label of each value as its option."""
    return Question(
        slot=slot.id,
        text=slot.question,
        options=[Option(value=value.id, label=value.label) for value in slot.values],
    )


def create_intake(
    schema: Schema,
    answers: dict[str, str],
    description: dict[str, str],
    write: Writer,
) -> Intake:
    """Checks the answers, then the description: first ids that are not slots on the form, then each entry in schema order. Then asks the first follow-up question."""
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
    intake = Intake(
        answers={slot_id: answers[slot_id] for slot_id in form_slots},
        description={field_id: description[field_id] for field_id in fields},
    )
    return ask_next(schema, intake, write)


def ask_next(schema: Schema, intake: Intake, write: Writer) -> Intake:
    """Asks about the first relevant follow-up slot without an answer, in schema order, unless the limit is reached (INTAKE-1, INTAKE-3). When no question is asked, the intake has ended."""
    if len(intake.questions) < QUESTION_LIMIT:
        for slot in schema.follow_up_slots:
            if slot.id not in intake.answers and is_relevant(slot, intake.answers):
                questions = [*intake.questions, write(slot, intake)]
                return intake.model_copy(update={"questions": questions})
    return intake


def waiting(intake: Intake) -> int | None:
    """The number of the question that waits for an answer, or None when the intake has ended."""
    if intake.questions and intake.questions[-1].slot not in intake.answers:
        return len(intake.questions)
    return None


def record_answer(
    schema: Schema, intake: Intake, question: int, value: str, write: Writer
) -> Intake:
    """Records the answer to a question and asks the next one. The value is checked first. An answer to a question that already has an answer changes nothing, so a repeated request acts once."""
    if not 1 <= question <= len(intake.questions):
        raise IntakeError("invalid_value", "question")
    asked = intake.questions[question - 1]
    if value not in [option.value for option in asked.options]:
        raise IntakeError("invalid_value", "value")
    if asked.slot in intake.answers:
        return intake
    answers = {**intake.answers, asked.slot: value}
    return ask_next(schema, intake.model_copy(update={"answers": answers}), write)


def open_slots(schema: Schema, intake: Intake) -> list[str]:
    """The slots answered "not sure" and, once the intake has ended, the relevant slots without an answer (INTAKE-3): the form slots first, each in schema order."""
    ended = waiting(intake) is None
    return [
        slot.id
        for slot in [*schema.slots, *schema.follow_up_slots]
        if intake.answers.get(slot.id) == NOT_SURE
        or (
            ended
            and slot.id not in intake.answers
            and is_relevant(slot, intake.answers)
        )
    ]
