"""The writer: for each row of an ended intake, a model writes what the clause means for this product and one action, once (MEMO-1 step 4, MEMO-5, RESP-1, RESP-3). Code adds the label, the citation, the quote, the date and the status. One call for each row, all at once, so that the texts of the example product take seconds and a failed call costs one row its texts."""

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from importlib.resources import files

import anthropic
from anthropic.types import ToolParam
from pydantic import BaseModel, ValidationError

from obligations_agent.gates import ObligationRow, Outcome, Result
from obligations_agent.intakes import Intake, Text
from obligations_agent.schema import Schema

MODEL = "claude-sonnet-5-5"
PROMPT = (
    files("obligations_agent").joinpath("writer_prompt.md").read_text(encoding="utf-8")
)
# The first line of the prompt file names its version.
PROMPT_VERSION = PROMPT.split("\n", 1)[0].removeprefix("Version: ")
REASONS = {
    "unclear": "I don't understand the question",
    "unknown": "I don't know this about the product",
}

WRITE: ToolParam = {
    "name": "write",
    "description": "Gives the meaning and one action for each row of the user message, by the row's id.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "meaning": {"type": "string"},
                        "action": {"type": "string"},
                    },
                    "required": ["id", "meaning", "action"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["rows"],
        "additionalProperties": False,
    },
}

logger = logging.getLogger(__name__)


class Written(BaseModel):
    id: str
    meaning: str
    action: str


class Write(BaseModel):
    """The input of the tool write."""

    rows: list[Written]


def depends_on(
    labels: dict[str, str], result: Result, outcome: Outcome, row: ObligationRow
) -> list[str]:
    """What a conditional row depends on, in words: the open slots of its result, a use listed in Annex III, the conditions of Article 6(3), and what else the row needs."""
    depends = [f"the open answer about {labels[c.slot]}" for c in outcome.conditions]
    points = [q.citation for q in outcome.quotes if "Annex III" in q.citation]
    if outcome.result == "listed_use" or any(
        case.result == "listed_use" for c in outcome.conditions for case in c.cases
    ):
        point = points[0] if len(points) == 1 else "a point of AI Act Annex III"
        depends.append(
            f"whether the product's intended use is one of the uses listed in {point}"
        )
    if outcome.derogation == "unless":
        depends.append("whether one of the conditions of AI Act Article 6(3) applies")
    need = row.needs
    if need is not None and need.slot is not None and need.value != "yes":
        depends.append(f"the open answer about {labels[need.slot]}")
    if need is not None and need.gate is not None and need.status == "conditional":
        other = next(o for o in result.gates if o.gate == need.gate)
        for condition in other.conditions:
            text = f"the open answer about {labels[condition.slot]}"
            if text not in depends:
                depends.append(text)
    return depends


def user_message(
    schema: Schema, intake: Intake, result: Result, outcome: Outcome, row: ObligationRow
) -> str:
    """The description, the answers with their labels, the notes, and the row, as JSON data (INTAKE-4)."""
    slots = [*schema.slots, *schema.follow_up_slots]
    labels = {slot.id: slot.label for slot in slots}
    data = {
        "description": {
            field.label: intake.description[field.id] for field in schema.description
        },
        "answers": [
            {"fact": slot.label, "answer": value.label}
            for slot in slots
            for value in slot.values
            if intake.answers.get(slot.id) == value.id
        ],
        "notes": [
            {
                "fact": labels[slot_id],
                "reason": REASONS[entry.reason],
                "note": entry.note,
            }
            for slot_id, entry in intake.not_sure.items()
        ],
        "rows": [
            {
                "id": row.id,
                "result": outcome.label,
                "label": row.label,
                "citation": row.unit.citation,
                "quote": row.unit.quote,
                "status": row.status,
                "depends_on": depends_on(labels, result, outcome, row),
                "legal_drafting": row.drafting,
            }
        ],
    }
    return json.dumps(data, ensure_ascii=False)


def write_row(
    client: anthropic.Anthropic,
    schema: Schema,
    intake: Intake,
    result: Result,
    outcome: Outcome,
    row: ObligationRow,
) -> Text | None:
    """The meaning and the action of one row, or None when the call fails or gives no valid texts for it."""
    reason = "model"
    text: Text | None = None
    try:
        response = client.messages.create(
            model=MODEL,
            # The longest of 133 calls in the probe wrote 427 tokens.
            max_tokens=1024,
            system=PROMPT,
            tools=[WRITE],
            # The model refuses a forced tool choice, so the prompt asks for the call.
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            output_config={"effort": "medium"},
            messages=[
                {
                    "role": "user",
                    "content": user_message(schema, intake, result, outcome, row),
                }
            ],
        )
    except anthropic.APITimeoutError:
        reason = "timeout"
    except anthropic.APIError as error:
        reason = f"call_failed error={type(error).__name__}"
    else:
        call = next(
            (b for b in response.content if b.type == "tool_use" and b.name == "write"),
            None,
        )
        try:
            written = Write.model_validate(call.input if call else None).rows
        except ValidationError:
            written = []
        item = next((item for item in written if item.id == row.id), None)
        if item is None or not item.meaning.strip() or not item.action.strip():
            reason = "invalid_output"
        else:
            text = Text(meaning=item.meaning.strip(), action=item.action.strip())
    logger.info(
        "texts row=%s model=%s prompt=%s written_by=%s",
        row.id,
        MODEL,
        PROMPT_VERSION,
        reason,
    )
    return text


def write_texts(
    client: anthropic.Anthropic, schema: Schema, intake: Intake, result: Result
) -> dict[str, Text | None]:
    """The texts of every row of the result, by the row's id, written by one call for each row, all at once."""
    items = [(outcome, row) for outcome in result.gates for row in outcome.rows]
    if not items:
        return {}
    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=len(items)) as pool:
        futures = [
            pool.submit(write_row, client, schema, intake, result, outcome, row)
            for outcome, row in items
        ]
        texts = [future.result() for future in futures]
    logger.info(
        "texts rows=%d written=%d seconds=%.1f",
        len(items),
        sum(text is not None for text in texts),
        time.monotonic() - start,
    )
    return {row.id: text for (_, row), text in zip(items, texts, strict=True)}
