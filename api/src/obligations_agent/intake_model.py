"""The intake model: chooses the slot of each follow-up question among the askable ones and writes the text and the option labels (INTAKE-2, INTAKE-4, TOOL-1). Code ends the intake. Without a key, or when the call gives no valid ask, code asks about the next slot in the queue with its default text, or ends the intake (INTAKE-1)."""

import json
import logging
from importlib.resources import files
from typing import Literal

import anthropic
from anthropic.types import ToolParam
from pydantic import ValidationError

from obligations_agent.intakes import (
    QUESTION_LIMIT,
    SLOT_LIMIT,
    Intake,
    NotSure,
    Question,
    Refusal,
    askable,
    asked_before,
    check_slot,
    default_question,
)
from obligations_agent.schema import Schema, Slot

MODEL = "claude-sonnet-5-5"
# Seconds for each phase of a request (connecting, sending, each wait for the answer), not
# for the whole call.
TIMEOUT = 10.0
PROMPT = (
    files("obligations_agent").joinpath("intake_prompt.md").read_text(encoding="utf-8")
)
# The first line of the prompt file names its version.
PROMPT_VERSION = PROMPT.split("\n", 1)[0].removeprefix("Version: ")

ASK: ToolParam = {
    "name": "ask",
    "description": "Asks the user one question about one of the facts: the id of the fact, the question text, and one option for each allowed value of the fact.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "slot": {"type": "string"},
            "text": {"type": "string"},
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "string"},
                        "label": {"type": "string"},
                    },
                    "required": ["value", "label"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["slot", "text", "options"],
        "additionalProperties": False,
    },
}

Reason = (
    Literal[
        "no_key",
        "timeout",
        "call_failed",
        "invalid_output",
        "invalid_slot",
        "invalid_option",
    ]
    | Refusal
)

logger = logging.getLogger(__name__)


def new_client() -> anthropic.Anthropic:
    """The client for the model. It makes no retries, because the user waits for the step."""
    return anthropic.Anthropic(timeout=TIMEOUT, max_retries=0)


def user_message(schema: Schema, intake: Intake, slots: list[Slot]) -> str:
    """The description, the answers so far with their labels, and the slots that may be asked about with the notes, as JSON data (INTAKE-1, INTAKE-4)."""
    data = {
        "description": {
            field.label: intake.description[field.id] for field in schema.description
        },
        "answers": [
            {"fact": other.label, "answer": value.label}
            for other in [*schema.slots, *schema.follow_up_slots]
            for value in other.values
            if intake.answers.get(other.id) == value.id
        ],
        "questions_left": QUESTION_LIMIT - len(intake.questions),
        "facts": [fact(intake, slot) for slot in slots],
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


def fact(intake: Intake, slot: Slot) -> dict[str, object]:
    """One slot that may be asked about, for the user message, with the user's note about the earlier questions."""
    earlier = asked_before(intake, slot)
    return {
        "id": slot.id,
        "label": slot.label,
        "default_question": slot.question,
        "values": [{"value": value.id, "label": value.label} for value in slot.values],
        "earlier_questions": earlier,
        "note": intake.not_sure.get(slot.id, NotSure()).note,
        "questions_left": SLOT_LIMIT - len(earlier),
    }


def ask_model(
    client: anthropic.Anthropic | None,
    schema: Schema,
    intake: Intake,
    slots: list[Slot],
) -> Question | Reason:
    """The question that the model asks, or the reason why it made no valid call (TOOL-1)."""
    if client is None:
        return "no_key"
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=PROMPT,
            tools=[ASK],
            # The model refuses a forced tool choice, so the prompt asks for the call.
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            messages=[{"role": "user", "content": user_message(schema, intake, slots)}],
        )
    except anthropic.APITimeoutError:
        return "timeout"
    except anthropic.APIError:
        return "call_failed"
    call = next((block for block in response.content if block.type == "tool_use"), None)
    if response.stop_reason != "tool_use" or call is None or call.name != "ask":
        return "invalid_output"
    try:
        question = Question.model_validate(call.input)
    except ValidationError:
        return "invalid_output"
    if not question.text.strip() or any(
        not option.label.strip() for option in question.options
    ):
        return "invalid_output"
    slot = next(
        (
            slot
            for slot in [*schema.slots, *schema.follow_up_slots]
            if slot.id == question.slot
        ),
        None,
    )
    if slot is None:
        return "invalid_slot"
    refused = check_slot(intake, slot)
    if refused is not None:
        return refused
    # Each allowed value exactly once (TOOL-1), shown in schema order.
    values = [value.id for value in slot.values]
    if sorted(option.value for option in question.options) != sorted(values):
        return "invalid_option"
    question.options.sort(key=lambda option: values.index(option.value))
    return question


def next_question(
    client: anthropic.Anthropic | None, schema: Schema, intake: Intake
) -> Question | None:
    """The next follow-up question, chosen and written by the model or by code, or None when code ends the intake, and one log line that says which (INTAKE-1, INTAKE-3)."""
    if len(intake.questions) >= QUESTION_LIMIT:
        return end(intake, "question_limit")
    slots = askable(schema, intake)
    if not slots:
        return end(intake, "no_askable_slot")
    # The queue's first slot: the first relevant slot without an answer, in schema order. Code
    # asks about it when the model does not (INTAKE-1).
    queue = next((slot for slot in slots if slot.id not in intake.answers), None)
    result = ask_model(client, schema, intake, slots)
    written_by = "model"
    if not isinstance(result, Question):
        if queue is None:
            return end(intake, result)
        written_by = f"default reason={result}"
        result = default_question(queue)
    logger.info(
        "question %d slot=%s model=%s prompt=%s written_by=%s",
        len(intake.questions) + 1,
        result.slot,
        MODEL,
        PROMPT_VERSION,
        written_by,
    )
    return result


def end(intake: Intake, reason: str) -> None:
    """The log line for the end of the intake, with the reason why code ends it."""
    logger.info(
        "end after %d questions model=%s prompt=%s reason=%s",
        len(intake.questions),
        MODEL,
        PROMPT_VERSION,
        reason,
    )
