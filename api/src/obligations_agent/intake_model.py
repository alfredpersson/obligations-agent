"""The intake model: chooses the slot of each follow-up question among the askable ones, writes the question as three texts (the explanation, the question and what each answer means) and the option labels, and names the examples from guidance that are about the user's text (INTAKE-2, INTAKE-4, TOOL-1, RESP-5, RESP-6). Code ends the intake. Without a key, or when the call gives no valid ask, code asks about the next slot in the queue with its default text, or ends the intake (INTAKE-1)."""

import json
import logging
from importlib.resources import files
from typing import Literal

import anthropic
from anthropic.types import ToolParam
from pydantic import BaseModel, ValidationError

from obligations_agent.guidance import Guidance
from obligations_agent.intakes import (
    QUESTION_LIMIT,
    SLOT_LIMIT,
    Example,
    Group,
    Intake,
    NotSure,
    Option,
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
TIMEOUT = 20.0
PROMPT = (
    files("obligations_agent").joinpath("intake_prompt.md").read_text(encoding="utf-8")
)
# The first line of the prompt file names its version.
PROMPT_VERSION = PROMPT.split("\n", 1)[0].removeprefix("Version: ")

ASK: ToolParam = {
    "name": "ask",
    "description": "Asks the user one question about one of the facts: the id of the fact, the question as three texts (the question alone, the explanation that the user reads before the examples and the question, and what each answer means), one option for each allowed value of the fact, the entries of the fact's guidance that are about the user's text in groups, each with a line about one part of the user's text, and a check line.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "slot": {"type": "string"},
            "text": {"type": "string"},
            "explanation": {"type": "string"},
            "meaning": {"type": "string"},
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
            "examples": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "entries": {"type": "array", "items": {"type": "string"}},
                        "line": {"type": "string"},
                    },
                    "required": ["entries", "line"],
                    "additionalProperties": False,
                },
            },
            "check": {"type": "string"},
        },
        "required": [
            "slot",
            "text",
            "explanation",
            "meaning",
            "options",
            "examples",
            "check",
        ],
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


class Named(BaseModel):
    """A group of entries that the model names for its question: the ids of the entries about one part of the user's text, and its line about that part."""

    entries: list[str]
    line: str


class Asked(BaseModel):
    """The input of the tool ask (TOOL-1)."""

    slot: str
    text: str
    explanation: str = ""
    meaning: str = ""
    options: list[Option]
    examples: list[Named] = []
    check: str = ""


def new_client() -> anthropic.Anthropic:
    """The client for the model. It makes no retries, because the user waits for the step."""
    return anthropic.Anthropic(timeout=TIMEOUT, max_retries=0)


def user_message(
    schema: Schema, guidance: Guidance, intake: Intake, slots: list[Slot]
) -> str:
    """The description, the answers so far with their labels, and the slots that may be asked about with the notes and the entries from guidance, as JSON data (INTAKE-1, INTAKE-4)."""
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
        "facts": [fact(guidance, intake, slot) for slot in slots],
    }
    return json.dumps(data, ensure_ascii=False)


def fact(guidance: Guidance, intake: Intake, slot: Slot) -> dict[str, object]:
    """One slot that may be asked about, for the user message, with the user's note about the earlier questions and the slot's entries from guidance (FACT-6)."""
    earlier = asked_before(intake, slot)
    return {
        "id": slot.id,
        "label": slot.label,
        "default_question": slot.question,
        "values": [{"value": value.id, "label": value.label} for value in slot.values],
        "earlier_questions": [
            question.model_dump(include={"text", "explanation", "meaning"})
            for question in earlier
        ],
        "note": intake.not_sure.get(slot.id, NotSure()).note,
        "questions_left": SLOT_LIMIT - len(earlier),
        "guidance": [
            entry.model_dump(include={"id", "two_sided", "quotes"})
            for entry in guidance.entries
            if entry.slot == slot.id
        ],
    }


def matched(guidance: Guidance, slot: Slot, named: list[Named]) -> list[Group]:
    """The groups that the model names, in its order, each with its line and the entries of the slot that it names, in its order, with their quotes and sources. An id that is not an entry of the slot and an entry named again are left out, and so is a group without a line or without an entry left (TOOL-1, RESP-5)."""
    entries = {entry.id: entry for entry in guidance.entries if entry.slot == slot.id}
    sources = {source.id: source for source in guidance.sources}
    groups: list[Group] = []
    for item in named:
        if not item.line.strip():
            continue
        examples: list[Example] = []
        for entry_id in item.entries:
            # Taken out of the dict, so that each entry shows once.
            entry = entries.pop(entry_id, None)
            if entry is None:
                continue
            examples.append(
                Example(
                    id=entry.id,
                    two_sided=entry.two_sided,
                    quotes=entry.quotes,
                    source=sources[entry.source],
                )
            )
        if examples:
            groups.append(Group(line=item.line, entries=examples))
    return groups


def ask_model(
    client: anthropic.Anthropic | None,
    schema: Schema,
    guidance: Guidance,
    intake: Intake,
    slots: list[Slot],
) -> tuple[Question, int] | Reason:
    """The question that the model asks with the number of entry ids that code left out, or the reason why it made no valid call (TOOL-1)."""
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
            # A question with examples takes about 11 seconds at the default effort, and about 8
            # at medium.
            output_config={"effort": "medium"},
            messages=[
                {
                    "role": "user",
                    "content": user_message(schema, guidance, intake, slots),
                }
            ],
        )
    except anthropic.APITimeoutError:
        return "timeout"
    except anthropic.APIError:
        return "call_failed"
    call = next((block for block in response.content if block.type == "tool_use"), None)
    if response.stop_reason != "tool_use" or call is None or call.name != "ask":
        return "invalid_output"
    try:
        asked = Asked.model_validate(call.input)
    except ValidationError:
        return "invalid_output"
    if not asked.text.strip() or any(
        not option.label.strip() for option in asked.options
    ):
        return "invalid_output"
    slot = next(
        (
            slot
            for slot in [*schema.slots, *schema.follow_up_slots]
            if slot.id == asked.slot
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
    if sorted(option.value for option in asked.options) != sorted(values):
        return "invalid_option"
    asked.options.sort(key=lambda option: values.index(option.value))
    groups = matched(guidance, slot, asked.examples)
    # The check line only for a slot whose entries the model received (RESP-5).
    has_entries = any(entry.slot == slot.id for entry in guidance.entries)
    # The explanation only for a slot that had a question before, which the user did not
    # understand (TOOL-1).
    asked_again = bool(asked_before(intake, slot))
    question = Question(
        slot=slot.id,
        text=asked.text,
        explanation=asked.explanation.strip() if asked_again else "",
        meaning=asked.meaning.strip(),
        options=asked.options,
        examples=groups,
        check=asked.check.strip() if has_entries else "",
    )
    named = sum(len(item.entries) for item in asked.examples)
    return question, named - sum(len(group.entries) for group in groups)


def next_question(
    client: anthropic.Anthropic | None,
    schema: Schema,
    guidance: Guidance,
    intake: Intake,
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
    result = ask_model(client, schema, guidance, intake, slots)
    written_by = "model"
    left_out = 0
    if isinstance(result, tuple):
        question, left_out = result
    elif queue is None:
        return end(intake, result)
    else:
        written_by = f"default reason={result}"
        question = default_question(queue)
    logger.info(
        "question %d slot=%s model=%s prompt=%s written_by=%s examples=%d left_out=%d check=%s",
        len(intake.questions) + 1,
        question.slot,
        MODEL,
        PROMPT_VERSION,
        written_by,
        sum(len(group.entries) for group in question.examples),
        left_out,
        "yes" if question.check else "no",
    )
    return question


def end(intake: Intake, reason: str) -> None:
    """The log line for the end of the intake, with the reason why code ends it."""
    logger.info(
        "end after %d questions model=%s prompt=%s reason=%s",
        len(intake.questions),
        MODEL,
        PROMPT_VERSION,
        reason,
    )
