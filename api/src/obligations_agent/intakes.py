"""Intakes: the form answers and the description, checked against the fact schema (FACT-2, FACT-4, FACT-5), and the follow-up questions with their limits (INTAKE-1 to INTAKE-3)."""

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel

from obligations_agent.schema import NOT_SURE, Schema, Slot

ErrorCode = Literal["invalid_slot", "invalid_value", "not_found"]
# Why the model may not ask about a slot (TOOL-1).
Refusal = Literal["not_askable", "limit_reached"]

# Follow-up questions per intake, and questions per slot, where the form's question is the first
# question about a slot on the form (INTAKE-3).
QUESTION_LIMIT = 8
SLOT_LIMIT = 2


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
    """A stored intake. The answers hold one current value for each slot, the follow-up answers included. questions holds each follow-up question, in the order asked, and replies the answer to each question that has one, in the same order."""

    questions: list[Question] = []
    replies: list[str] = []


Writer = Callable[[Intake], Question | None]


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


def asked_before(intake: Intake, slot: Slot) -> list[str]:
    """The texts of the questions about the slot so far: the form's question for a slot on the form, then each follow-up question about it."""
    form = [slot.question] if slot.relevant == "always" else []
    return form + [
        question.text for question in intake.questions if question.slot == slot.id
    ]


def check_slot(intake: Intake, slot: Slot) -> Refusal | None:
    """Why the model may not ask about the slot now, or None when it may: the slot is relevant, has no answer or the answer "not sure", and has had fewer than two questions (INTAKE-2, INTAKE-3)."""
    if intake.answers.get(slot.id, NOT_SURE) != NOT_SURE or not is_relevant(
        slot, intake.answers
    ):
        return "not_askable"
    if len(asked_before(intake, slot)) >= SLOT_LIMIT:
        return "limit_reached"
    return None


def askable(schema: Schema, intake: Intake) -> list[Slot]:
    """The slots that the model may ask about now, in schema order."""
    return [
        slot
        for slot in [*schema.slots, *schema.follow_up_slots]
        if check_slot(intake, slot) is None
    ]


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
    return ask_next(intake, write)


def ask_next(intake: Intake, write: Writer) -> Intake:
    """Adds the next follow-up question. When the writer gives none, the intake has ended."""
    question = write(intake)
    if question is None:
        return intake
    return intake.model_copy(update={"questions": [*intake.questions, question]})


def waiting(intake: Intake) -> int | None:
    """The number of the question that waits for an answer, or None when the intake has ended."""
    if len(intake.replies) < len(intake.questions):
        return len(intake.questions)
    return None


def record_answer(
    schema: Schema, intake: Intake, question: int, value: str, write: Writer
) -> Intake:
    """Records the answer to a question, removes the answers of slots that are no longer relevant (INTAKE-1), and asks the next question. The value is checked first. An answer to a question that already has an answer changes nothing, so a repeated request acts once."""
    if not 1 <= question <= len(intake.questions):
        raise IntakeError("invalid_value", "question")
    asked = intake.questions[question - 1]
    if value not in [option.value for option in asked.options]:
        raise IntakeError("invalid_value", "value")
    if question <= len(intake.replies):
        return intake
    answers = {**intake.answers, asked.slot: value}
    # A condition names only earlier slots, so one pass in schema order also follows a chain.
    for slot in schema.follow_up_slots:
        if not is_relevant(slot, answers):
            answers.pop(slot.id, None)
    replies = [*intake.replies, value]
    return ask_next(
        intake.model_copy(update={"answers": answers, "replies": replies}), write
    )


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
