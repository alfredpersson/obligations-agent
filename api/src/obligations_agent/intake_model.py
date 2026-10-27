"""The intake model: writes the text and the option labels of the follow-up question that code asks (INTAKE-4, TOOL-1). Without a key, or when the call gives no valid question, the question keeps its default text (INTAKE-1)."""

import json
import logging
from importlib.resources import files
from typing import Literal

import anthropic
from anthropic.types import ToolParam
from pydantic import ValidationError

from obligations_agent.intakes import Intake, Question, default_question
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
    "description": "Asks the user the follow-up question: its text, and one option for each allowed value of the fact.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
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
        "required": ["text", "options"],
        "additionalProperties": False,
    },
}

Reason = Literal["no_key", "timeout", "call_failed", "invalid_output", "invalid_option"]

logger = logging.getLogger(__name__)


def new_client() -> anthropic.Anthropic:
    """The client for the model. It makes no retries, because the user waits for the step."""
    return anthropic.Anthropic(timeout=TIMEOUT, max_retries=0)


def user_message(schema: Schema, slot: Slot, intake: Intake) -> str:
    """The description, the answers so far with their labels, and the slot to ask about, as JSON data (INTAKE-4)."""
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
        "fact_to_ask_about": {
            "label": slot.label,
            "default_question": slot.question,
            "values": [
                {"value": value.id, "label": value.label} for value in slot.values
            ],
        },
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


def ask_model(
    client: anthropic.Anthropic | None, schema: Schema, slot: Slot, intake: Intake
) -> Question | Reason:
    """The question that the model writes, or the reason why there is none."""
    if client is None:
        return "no_key"
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=PROMPT,
            tools=[ASK],
            # The model refuses a forced tool choice, so the prompt asks for the call.
            tool_choice={"type": "auto"},
            messages=[{"role": "user", "content": user_message(schema, slot, intake)}],
        )
    except anthropic.APITimeoutError:
        return "timeout"
    except anthropic.APIError:
        return "call_failed"
    call = next((block for block in response.content if block.type == "tool_use"), None)
    if response.stop_reason != "tool_use" or call is None:
        return "invalid_output"
    try:
        question = Question.model_validate({**call.input, "slot": slot.id})
    except ValidationError:
        return "invalid_output"
    if not question.text.strip() or any(
        not option.label.strip() for option in question.options
    ):
        return "invalid_output"
    # Each allowed value exactly once (TOOL-1), shown in schema order.
    values = [value.id for value in slot.values]
    if sorted(option.value for option in question.options) != sorted(values):
        return "invalid_option"
    question.options.sort(key=lambda option: values.index(option.value))
    return question


def write_question(
    client: anthropic.Anthropic | None, schema: Schema, slot: Slot, intake: Intake
) -> Question:
    """The question about the slot, written by the model or with the default text, and one log line that says which (INTAKE-1)."""
    question = ask_model(client, schema, slot, intake)
    written_by = "model"
    if not isinstance(question, Question):
        written_by = f"default reason={question}"
        question = default_question(slot)
    logger.info(
        "question %d slot=%s model=%s prompt=%s written_by=%s",
        len(intake.questions) + 1,
        slot.id,
        MODEL,
        PROMPT_VERSION,
        written_by,
    )
    return question
