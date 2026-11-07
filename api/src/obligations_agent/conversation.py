"""The questions about the result of a confirmed intake (QA-3 to QA-9): a model answers each one in a loop with tools that only read (TOOL-2 to TOOL-6) and ends it with the tool answer. Code checks each quote word for word in the stored copies, links each citation to EUR-Lex, and computes the changes of the answers that a change to the product may change."""

import json
import logging
import re
import time
from importlib.resources import files
from typing import Any, Literal

import anthropic
from anthropic.types import MessageParam, ToolParam
from pydantic import BaseModel, ValidationError

from obligations_agent.gates import (
    EUR_LEX,
    Gates,
    ObligationRow,
    Outcome,
    Result,
    Unit,
    WhatIf,
    apply_answers,
    decide,
    in_words,
    link,
    what_if,
)
from obligations_agent.guidance import Guidance
from obligations_agent.intakes import (
    Ending,
    Example,
    Intake,
    Quoted,
    Requested,
    Turn,
    default_question,
    is_relevant,
    last_questions,
    open_slots,
)
from obligations_agent.regulations import (
    Point,
    anchor,
    contents,
    find,
    load_copies,
    name_of,
)
from obligations_agent.schema import NOT_SURE, Schema
from obligations_agent.writer import REASONS, depends_on, open_items

MODEL = "claude-sonnet-5-5"
PROMPT = (
    files("obligations_agent")
    .joinpath("conversation_prompt.md")
    .read_text(encoding="utf-8")
)
PROMPT_VERSION = PROMPT.split("\n", 1)[0].removeprefix("Version: ")
# Tool calls for each question before its answer, seconds after which no new call starts, and
# questions for each intake (QA-2, QA-8).
TOOL_LIMIT = 6
TIME_LIMIT = 60.0
QUESTION_LIMIT = 20
# The message that code sends once when the model ends its turn with plain text, whose quotes code
# could not check.
REMINDER = "End your turn with the answer tool, with the text, quotes, guidance and changes of your answer."
COPIES = load_copies()
# The AI Act as amended by Regulation (EU) 2026/1744, which a citation of a changed or inserted part
# opens.
CONSOLIDATED = "02024R1689-20260727"
STATUS = {
    "applies": "applies",
    "does_not_apply": "does not apply",
    "conditional": "conditional",
    "listed_use": "applies if the intended use is one of the uses listed under the point of Annex III",
}
ARTICLE_6_3 = {
    "always": "Article 6(3): always high-risk where the intended use is listed, because the product profiles people",
    "unless": "Article 6(3): high-risk where the intended use is listed, unless one of the conditions of Article 6(3) is met, which the user decides",
}

KIND = {"type": "string", "enum": ["article", "annex"]}
CHANGES = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {"fact": {"type": "string"}, "value": {"type": "string"}},
        "required": ["fact", "value"],
        "additionalProperties": False,
    },
}
TOOLS: list[ToolParam] = [
    {
        "name": "contents",
        "description": 'The table of contents of the AI Act or the GDPR: each chapter and section, and each article and annex with its number and title, from the stored copy of the Official Journal text. For the AI Act it says which articles and annexes Regulation (EU) 2026/1744 changed or inserted. Use it to find the article on a topic that the result does not name. regulation: "ai_act" or "gdpr".',
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "regulation": {"type": "string", "enum": ["ai_act", "gdpr"]}
            },
            "required": ["regulation"],
            "additionalProperties": False,
        },
    },
    {
        "name": "article",
        "description": 'The text of one article or annex from the stored copy of the Official Journal text, with its title, chapter and section. For an AI Act article or annex that Regulation (EU) 2026/1744 changed, changed_by gives the text of each point of that regulation\'s Article 1 that changes it; for one that it inserted, such as Article 4a, the text comes from that point and inserted_by names it. regulation: "ai_act", "gdpr", or "amending" for the articles of Regulation (EU) 2026/1744 itself; kind: "article" or "annex"; number: the number alone, for example "26", "4a" or "III". An unknown number gives {"error": "not_found"}.',
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "regulation": {
                    "type": "string",
                    "enum": ["ai_act", "gdpr", "amending"],
                },
                "kind": KIND,
                "number": {"type": "string"},
            },
            "required": ["regulation", "kind", "number"],
            "additionalProperties": False,
        },
    },
    {
        "name": "guidance",
        "description": 'The entries of official guidance for one fact of the intake, each with its id, its quotes under their headings and its source. Only some facts have entries. fact: the id of a fact from the data, for example "decides_purposes". An unknown fact gives {"error": "unknown_fact"}; a fact without entries gives an empty list.',
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"fact": {"type": "string"}},
            "required": ["fact"],
            "additionalProperties": False,
        },
    },
    {
        "name": "what_if",
        "description": 'The result with one or more answers of this intake changed together, as the rules in code compute it: each result whose status, open answers or Article 6(3) outcome changes, each row that is added, removed or gets another status, the facts that become open or are no longer asked, and their counts. The intake and its result do not change. changes: each a fact id and a value id as the data gives them, for example [{"fact": "profiling", "value": "yes"}]; they are applied in the order of the facts, so a fact may be one that an earlier change makes asked. A change that cannot be applied is listed under refused with "unknown_fact", "not_asked" (the intake does not ask the fact with the answers before it), "unknown_value" or "same_answer".',
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"changes": CHANGES},
            "required": ["changes"],
            "additionalProperties": False,
        },
    },
    {
        "name": "answer",
        "description": "Ends your turn with the answer that the user sees. text: the answer in plain words, with each citation in square brackets, for example [GDPR Article 21(1)] or [AI Act Annex III, point 4]. quotes: passages to show under the text, each word for word from the result or from a text that the article tool returned, with the regulation, kind and number of its article or annex. guidance: the ids of the guidance entries to show; code adds their quotes and sources. changes: for a described change to the product, each answer that it may change, as a fact id and the value id that it may take; code shows each question and what the rules would give with all of them together; an empty list when the change touches no question or the question is not about a change. Code drops a quote that it does not find word for word in the stored copy.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "quotes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "regulation": {
                                "type": "string",
                                "enum": ["ai_act", "gdpr"],
                            },
                            "kind": KIND,
                            "number": {"type": "string"},
                            "text": {"type": "string"},
                        },
                        "required": ["regulation", "kind", "number", "text"],
                        "additionalProperties": False,
                    },
                },
                "guidance": {"type": "array", "items": {"type": "string"}},
                "changes": CHANGES,
            },
            "required": ["text", "quotes", "guidance", "changes"],
            "additionalProperties": False,
        },
    },
]

logger = logging.getLogger(__name__)


class ToolInput(BaseModel):
    """The input of a tool that reads: each tool fills the fields that it takes."""

    regulation: str = ""
    kind: str = ""
    number: str = ""
    fact: str = ""
    changes: list[Requested] = []


class QuoteInput(BaseModel):
    regulation: Literal["ai_act", "gdpr"]
    kind: Literal["article", "annex"]
    number: str
    text: str


class AnswerInput(BaseModel):
    """The input of the tool answer."""

    text: str
    quotes: list[QuoteInput]
    guidance: list[str]
    changes: list[Requested]


class Segment(BaseModel):
    """A piece of an answer's text, with the link of a citation or none."""

    text: str
    link: str | None


class Paragraph(BaseModel):
    kind: Literal["paragraph"] = "paragraph"
    segments: list[Segment]


class Items(BaseModel):
    """A list of the answer's text, numbered from start when it is ordered."""

    kind: Literal["list"] = "list"
    ordered: bool
    start: int
    items: list[list[Segment]]


Block = Paragraph | Items


def also_needs(
    labels: dict[str, str], result: Result, row: ObligationRow
) -> str | None:
    """What else a row needs: another result, or the answer Yes to a fact."""
    need = row.needs
    if need is not None and need.gate is not None:
        other = next(item for item in result.gates if item.gate == need.gate)
        return f"the result {other.label}, which is {STATUS[other.status]}"
    if need is not None and need.slot is not None:
        return f"the answer Yes to {labels[need.slot]}"
    return None


def result_data(
    labels: dict[str, str],
    values: dict[tuple[str, str], str],
    intake: Intake,
    gates: Gates,
    result: Result,
    outcome: Outcome,
) -> dict[str, Any]:
    """One result as the model receives it: its status, the answers that decided it, its open answers with what each case gives, its quoted units and its rows."""
    names = {regulation.id: regulation.name for regulation in gates.regulations}
    texts = intake.texts or {}
    data: dict[str, Any] = {
        "result": outcome.label,
        "regulation": names[outcome.regulation],
        "status": STATUS[outcome.status],
        "decided_by": [
            {"fact": labels[slot], "answer": values[slot, value]}
            for slot, value in outcome.answers.items()
        ],
        "open_answers": [
            {
                "fact": labels[condition.slot],
                "cases": [
                    {
                        "answers": [
                            values[condition.slot, value] for value in case.values
                        ],
                        "gives": STATUS.get(case.result, case.result),
                    }
                    for case in condition.cases
                ],
            }
            for condition in outcome.conditions
        ],
        "defined_by": [
            {"citation": unit.citation, "quote": unit.quote}
            for unit in outcome.quotes
            if unit.quote
        ],
    }
    if outcome.result == "listed_use":
        data["listed_use"] = (
            "The result is conditional on whether the product's intended use is one of the uses listed under the point of Annex III that it quotes; the user decides this."
        )
    if outcome.derogation:
        data["article_6_3"] = ARTICLE_6_3[outcome.derogation]
    data["rows"] = [
        {
            "label": row.label,
            "category": row.category,
            "status": row.status,
            "citation": row.unit.citation,
            "quote": row.unit.quote,
            "from": in_words(row.date),
            "date_set_by": row.date_unit.citation,
            "date_condition": row.condition.citation if row.condition else None,
            "also_needs": also_needs(labels, result, row),
            "depends_on": depends_on(labels, result, outcome, row),
            "meaning": text.meaning if (text := texts.get(row.id)) else None,
            "action": text.action if text else None,
        }
        for row in outcome.rows
    ]
    return data


def answers_to_check(labels: dict[str, str], result: Result) -> list[dict[str, Any]]:
    """Each open item of the result with the results and the number of conditional rows that depend on it, most rows first (MEMO-6)."""
    results: dict[str, list[str]] = {}
    rows: dict[str, int] = {}
    for outcome in result.gates:
        for item in open_items(labels, outcome):
            results.setdefault(item, []).append(outcome.label)
        for row in outcome.rows:
            if row.status == "conditional":
                for item in depends_on(labels, result, outcome, row):
                    rows[item] = rows.get(item, 0) + 1
                    results.setdefault(item, [])
    return sorted(
        (
            {
                "item": item,
                "results_that_depend_on_it": names,
                "conditional_rows_that_depend_on_it": rows.get(item, 0),
            }
            for item, names in results.items()
        ),
        key=lambda entry: -entry["conditional_rows_that_depend_on_it"],
    )


def user_data(
    schema: Schema, guidance: Guidance, gates: Gates, intake: Intake
) -> dict[str, Any]:
    """The intake as the first user message gives it to the model: the description, each fact, the notes, and the result with its rows and their texts (INTAKE-4, QA-3)."""
    slots = [*schema.slots, *schema.follow_up_slots]
    labels = {slot.id: slot.label for slot in slots}
    values = {
        (slot.id, value.id): value.label for slot in slots for value in slot.values
    }
    result = decide(gates, schema, intake)
    opened = open_slots(schema, intake)
    return {
        "description": {
            field.label: intake.description[field.id] for field in schema.description
        },
        "facts": [
            {
                "id": slot.id,
                "label": slot.label,
                "asked": is_relevant(slot, intake.answers),
                "answer": values[slot.id, intake.answers[slot.id]]
                if slot.id in intake.answers
                else None,
                "open": slot.id in opened,
                "values": [
                    {"id": value.id, "label": value.label} for value in slot.values
                ],
                "guidance_entries": sum(
                    entry.slot == slot.id for entry in guidance.entries
                ),
            }
            for slot in slots
        ],
        "notes": [
            {
                "fact": labels[slot_id],
                "reason": REASONS[entry.reason],
                "note": entry.note,
            }
            for slot_id, entry in intake.not_sure.items()
        ],
        "result": {
            "assumptions": [item.text for item in result.assumptions],
            "results": [
                result_data(labels, values, intake, gates, result, outcome)
                for outcome in result.gates
            ],
            "answers_to_check": answers_to_check(labels, result),
            "not_checked": [
                {"item": item.text, "citations": [unit.citation for unit in item.links]}
                for item in result.not_checked
            ],
        },
    }


def read_contents(regulation: str) -> dict[str, Any]:
    return {"contents": contents(COPIES[regulation])}


def read_article(regulation: str, kind: str, number: str) -> dict[str, Any]:
    """The text of an article or annex, with the points of Regulation (EU) 2026/1744 that change it or the point that inserts it (TOOL-3)."""
    document = COPIES[regulation]
    part = find(document, kind, number)
    if part is None:
        return {"error": "not_found"}
    data: dict[str, Any] = {
        "citation": f"{document.name} {name_of(part)}",
        "title": part.title,
        "chapter": part.chapter,
        "section": part.section,
        "text": "\n".join(part.lines),
    }
    if part.inserted_by:
        data["inserted_by"] = (
            f"Regulation (EU) 2026/1744, Article 1, point ({part.inserted_by.number})"
        )
    if part.changed_by:
        data["changed_by"] = [
            {
                "point": f"Regulation (EU) 2026/1744, Article 1, point ({point.number})",
                "text": "\n".join(point.lines),
            }
            for point in part.changed_by
        ]
    return data


def read_guidance(schema: Schema, guidance: Guidance, fact: str) -> dict[str, Any]:
    """The guidance entries of a fact with their quotes and sources (TOOL-4)."""
    slot = next(
        (slot for slot in [*schema.slots, *schema.follow_up_slots] if slot.id == fact),
        None,
    )
    if slot is None:
        return {"error": "unknown_fact"}
    sources = {source.id: source for source in guidance.sources}
    return {
        "fact": slot.label,
        "entries": [
            {
                **entry.model_dump(include={"id", "two_sided", "quotes"}),
                "source": sources[entry.source].title,
            }
            for entry in guidance.entries
            if entry.slot == fact
        ],
    }


def counted(changes: WhatIf) -> dict[str, Any]:
    """The output of the tool what_if: the changes with their numbers, so that the answer copies them and counts nothing."""
    data = changes.model_dump()
    keys = ["rows_added", "rows_removed", "rows_changed", "now_open", "no_longer_asked"]
    return {**data, "counts": {key: len(data[key]) for key in keys}}


def run_tool(
    schema: Schema,
    guidance: Guidance,
    gates: Gates,
    intake: Intake,
    name: str,
    data: ToolInput,
) -> dict[str, Any]:
    """The output of a tool that reads. Each reads only the intake that the address names (TOOL-2 to TOOL-5)."""
    if name == "contents":
        return read_contents(data.regulation)
    if name == "article":
        return read_article(data.regulation, data.kind, data.number)
    if name == "guidance":
        return read_guidance(schema, guidance, data.fact)
    if name == "what_if":
        return counted(what_if(gates, schema, intake, data.changes))
    return {"error": "unknown_tool"}


def words(text: str) -> str:
    """Any run of whitespace as one space, as the quote tests of gates.yaml count it."""
    return " ".join(text.split())


def locate(lines: list[str], quote: str) -> tuple[int, str] | None:
    """The first line of the quote in the lines, with any run of whitespace as one space, and what the link highlights: the quote, or for a quote over several lines its part on the first line and its part on the last line."""
    joined = ""
    starts: list[int] = []
    for line in lines:
        starts.append(len(joined))
        joined += words(line) + " "
    at = joined.find(quote)
    if at < 0:
        return None
    end = at + len(quote)
    first = max(i for i, start in enumerate(starts) if start <= at)
    last = max(i for i, start in enumerate(starts) if start < end)
    if first == last:
        return first, quote
    head = joined[at : starts[first + 1]].strip()
    return first, f"{head}\n{joined[starts[last] : end].strip()}"


def paragraph(lines: list[str], index: int) -> tuple[str | None, bool]:
    """The number of the paragraph or of the annex's point that the line stands in ("2." at the start of a line), or of the definition ("(7)" on a line of its own), and whether it is a paragraph, which has an anchor of its own on EUR-Lex."""
    for line in reversed(lines[: index + 1]):
        text = line.strip().lstrip("‘")
        match = re.match(r"(\d+)\.(\s|$)", text)
        if match:
            return match.group(1), True
        match = re.fullmatch(r"\((\d+)\)", text)
        if match:
            return match.group(1), False
    return None, False


def check_quote(regulation: str, kind: str, number: str, text: str) -> Quoted | None:
    """The quote as code shows it, with its citation and its link, when it occurs word for word in the stored copy of its article or annex, or in the point of Regulation (EU) 2026/1744 that changes or inserts it; None otherwise (QA-6, MEMO-8)."""
    quote = words(text).strip("\"'“”‘’ ")
    document = COPIES[regulation]
    part = find(document, kind, number)
    if part is None or len(quote.split()) < 3:
        return None
    name = f"{document.name} {name_of(part)}"
    points = [part.inserted_by] if part.inserted_by else part.changed_by
    sources: list[tuple[Point | None, list[str]]] = (
        [] if part.inserted_by else [(None, part.lines)]
    )
    sources += [(point, point.lines) for point in points]
    for point, lines in sources:
        found = locate(lines, quote)
        if found is None:
            continue
        first, highlighted = found
        number_in, own_anchor = paragraph(lines, first)
        if point is not None:
            how = "inserted" if part.inserted_by else "changed"
            cited = f"({number_in})" if number_in and part.kind == "article" else ""
            citation = f"{name}{cited}, as {how} by Regulation (EU) 2026/1744"
            document, target = COPIES["amending"], "art_1"
        elif part.kind == "annex":
            citation = f"{name}, point {number_in}" if number_in else name
            target = anchor(part, None)
        else:
            citation = f"{name}({number_in})" if number_in else name
            target = anchor(part, number_in if own_anchor else None)
        unit = Unit(
            id="quote",
            citation=citation,
            document=document.celex,
            anchor=target,
            quote=highlighted,
        )
        return Quoted(citation=citation, link=link(unit), text=quote)
    return None


# A citation that names its regulation, such as "GDPR Article 21(1)" or "AI Act Annex III, point 4".
NAMED = r"(?P<reg>AI Act|GDPR) (?P<kind>Article|Annex) (?P<num>\d+[a-z]?|[IVXL]+)(?P<par>(?:\(\d+\))*)(?:\([a-z]\))*(?:, point \d+)?"
CITED = re.compile(NAMED)
# A citation in square brackets, one that names its regulation, or an article alone.
CITE = re.compile(
    rf"\[(?P<inner>[^\]]+)\]|{NAMED}|\bArticle (?P<bnum>\d+[a-z]?)(?P<bpar>(?:\(\d+\))*)(?:\([a-z]\))*"
)
REGULATION = {document.name: document.id for document in COPIES.values()}


def link_for(regulation: str, kind: str, number: str, paragraphs: str) -> str | None:
    """The link to an article, a paragraph or an annex on EUR-Lex: the Official Journal text, or the text in force for an AI Act part that Regulation (EU) 2026/1744 changed or inserted, which has no anchors for paragraphs; none for a part that the stored copy does not have (MEMO-7)."""
    document = COPIES[regulation]
    part = find(document, kind, number)
    if part is None:
        return None
    changed = regulation == "ai_act" and bool(part.changed_by or part.inserted_by)
    first = re.match(r"\((\d+)\)", paragraphs)
    target = anchor(part, first.group(1) if first and not changed else None)
    return f"{EUR_LEX}{CONSOLIDATED if changed else document.celex}#{target}"


def segments(text: str, named: dict[str, str]) -> list[Segment]:
    """The text in pieces, each citation a piece with its link: a citation in square brackets without them, one that names its regulation, and an article without its regulation where the named regulations give it one."""
    out: list[Segment] = []
    at = 0
    for match in CITE.finditer(text):
        inner = match.group("inner")
        cited = CITED.match(inner) if inner else match if match.group("reg") else None
        bare = match.group("bnum")
        target = (
            link_for(
                REGULATION[cited.group("reg")],
                cited.group("kind").lower(),
                cited.group("num"),
                cited.group("par"),
            )
            if cited
            else link_for(named[bare], "article", bare, match.group("bpar"))
            if bare in named
            else None
        )
        if target is None and not inner:
            continue
        if match.start() > at:
            out.append(Segment(text=text[at : match.start()], link=None))
        out.append(Segment(text=inner or match.group(0), link=target))
        at = match.end()
    if at < len(text):
        out.append(Segment(text=text[at:], link=None))
    return out


def regulations_of(text: str) -> dict[str, set[str]]:
    """The regulations that the text names with each article number."""
    found: dict[str, set[str]] = {}
    for match in CITED.finditer(text):
        if match.group("kind") == "Article":
            found.setdefault(match.group("num"), set()).add(
                REGULATION[match.group("reg")]
            )
    return found


def blocks(text: str, result: Result) -> list[Block]:
    """The answer's paragraphs and lists, with its citations linked. An article without its regulation takes the one regulation that the answer names with it, or else the one that the result cites with it."""
    cited = " ".join(
        unit.citation
        for outcome in result.gates
        for unit in [
            *outcome.quotes,
            *(row.unit for row in outcome.rows),
            *(row.condition for row in outcome.rows if row.condition),
        ]
    )
    in_text, in_result = regulations_of(text), regulations_of(cited)
    named = {
        number: next(iter(found))
        for number in {*in_text, *in_result}
        if len(found := in_text.get(number) or in_result[number]) == 1
    }
    item = re.compile(r"(-|\d+\.)\s+")
    out: list[Block] = []
    for chunk in re.split(r"\n\s*\n", text.replace("**", "").strip()):
        run: list[str] = []
        for line in [*(line.strip() for line in chunk.split("\n") if line.strip()), ""]:
            if item.match(line):
                run.append(line)
                continue
            if run:
                out.append(
                    Items(
                        ordered=run[0][0].isdigit(),
                        start=int(run[0].split(".")[0]) if run[0][0].isdigit() else 1,
                        items=[
                            segments(item.sub("", entry, count=1), named)
                            for entry in run
                        ],
                    )
                )
                run = []
            if line:
                out.append(Paragraph(segments=segments(line, named)))
    return out


def at_question(intake: Intake, turn: Turn) -> Intake:
    """The intake with the answers that it had when the question was asked."""
    return intake.model_copy(
        update={
            "answers": turn.answers,
            "not_sure": {
                slot: entry
                for slot, entry in intake.not_sure.items()
                if turn.answers.get(slot) == NOT_SURE
            },
        }
    )


def rendered(schema: Schema, intake: Intake, turn: Turn) -> str:
    """An earlier answer as the history of a later question gives it: its text, its quotes, its guidance entries and the answers that it named."""
    if turn.reason != "answered":
        return "This question could not be answered."
    parts = [turn.text]
    if turn.quotes:
        parts.append(
            "Quoted under the answer:\n"
            + "\n".join(f"{quote.citation}: {quote.text}" for quote in turn.quotes)
        )
    if turn.guidance:
        parts.append("Guidance entries shown: " + ", ".join(turn.guidance))
    _, changed, _ = apply_answers(schema, at_question(intake, turn), turn.changes)
    if changed:
        parts.append(
            "Answers that this change may change, as shown under the answer: "
            + "; ".join(f"{item.fact}: {item.to}" for item in changed)
        )
    return "\n\n".join(parts)


def history(
    schema: Schema, guidance: Guidance, gates: Gates, intake: Intake, question: str
) -> list[MessageParam]:
    """The messages of a question: the first holds the intake as data, and each earlier question is followed by its answer."""
    questions = [*(turn.question for turn in intake.conversation), question]
    messages: list[MessageParam] = []
    for index, text in enumerate(questions):
        data = (
            {"intake": user_data(schema, guidance, gates, intake), "question": text}
            if index == 0
            else {"question": text}
        )
        messages.append(
            {"role": "user", "content": json.dumps(data, ensure_ascii=False)}
        )
        if index < len(intake.conversation):
            turn = intake.conversation[index]
            messages.append(
                {"role": "assistant", "content": rendered(schema, intake, turn)}
            )
    return messages


def ask(
    client: anthropic.Anthropic,
    schema: Schema,
    guidance: Guidance,
    gates: Gates,
    intake: Intake,
    question: str,
) -> Turn:
    """One question through the loop: at most TOOL_LIMIT tool calls, no new call after TIME_LIMIT seconds, and one reminder when the model ends its turn without answer; then the turn with its answer, or with the reason why there is none (QA-8). The tools only read, so the intake does not change."""
    messages = history(schema, guidance, gates, intake, question)
    answers = dict(intake.answers)
    start = time.monotonic()
    tools: list[str] = []
    calls = 0
    reminded = False
    reason: Ending = "no_answer"
    error = ""
    turn: Turn | None = None
    try:
        while True:
            if calls and time.monotonic() - start >= TIME_LIMIT:
                reason = "deadline"
                break
            calls += 1
            response = client.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=PROMPT,
                tools=TOOLS,
                # The model refuses a forced tool choice, so the prompt asks for the call of answer.
                tool_choice={"type": "auto", "disable_parallel_tool_use": True},
                output_config={"effort": "medium"},
                # The intake and the earlier turns are the same for each call of a question.
                cache_control={"type": "ephemeral"},
                messages=messages,
            )
            call = next(
                (block for block in response.content if block.type == "tool_use"), None
            )
            if call is None:
                if reminded:
                    break
                reminded = True
                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": REMINDER})
                continue
            if call.name == "answer":
                try:
                    given = AnswerInput.model_validate(call.input)
                except ValidationError:
                    reason = "invalid_answer"
                    break
                if not given.text.strip():
                    reason = "invalid_answer"
                    break
                known = {entry.id for entry in guidance.entries}
                turn = Turn(
                    question=question,
                    reason="answered",
                    text=given.text.strip(),
                    quotes=[
                        quote
                        for item in given.quotes
                        if (
                            quote := check_quote(
                                item.regulation, item.kind, item.number, item.text
                            )
                        )
                    ],
                    guidance=[
                        entry
                        for entry in dict.fromkeys(given.guidance)
                        if entry in known
                    ],
                    changes=given.changes,
                    answers=answers,
                )
                break
            if len(tools) >= TOOL_LIMIT:
                reason = "tool_limit"
                break
            tools.append(call.name)
            try:
                output = run_tool(
                    schema,
                    guidance,
                    gates,
                    intake,
                    call.name,
                    ToolInput.model_validate(call.input),
                )
            except ValidationError:
                output = {"error": "invalid_input"}
            messages.append({"role": "assistant", "content": response.content})
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": call.id,
                            "content": json.dumps(output, ensure_ascii=False),
                        }
                    ],
                }
            )
    except anthropic.APITimeoutError:
        reason = "timeout"
    except anthropic.APIError as failure:
        reason = "call_failed"
        error = f" error={type(failure).__name__}"
    if turn is None:
        turn = Turn(question=question, reason=reason, answers=answers)
    _, _, refused = apply_answers(schema, intake, turn.changes)
    logger.info(
        "question %d model=%s prompt=%s tools=%s reminder=%s reason=%s%s changes=%d refused=%d seconds=%.1f",
        len(intake.conversation) + 1,
        MODEL,
        PROMPT_VERSION,
        ",".join(tools) or "none",
        "yes" if reminded else "no",
        turn.reason,
        error,
        len(turn.changes),
        len(refused),
        time.monotonic() - start,
    )
    return turn


def view_turn(
    schema: Schema,
    guidance: Guidance,
    gates: Gates,
    intake: Intake,
    result: Result,
    turn: Turn,
) -> dict[str, Any]:
    """A turn as GET /intakes/{id} shows it, with the result of the intake: the answer's blocks, its quotes and its guidance entries; for a change, each question that it may change with its text and the entries named for it, and the changes of all of them together, computed for the answers at the time of the question; and whether the answers changed since (QA-4, QA-9). A turn that was not answered has none of them."""
    by_id = {entry.id: entry for entry in guidance.entries}
    sources = {source.id: source for source in guidance.sources}
    # Each entry that the answer shows, by the fact that it is for.
    shown = [
        (
            by_id[entry_id].slot,
            Example(
                id=entry_id,
                two_sided=by_id[entry_id].two_sided,
                quotes=by_id[entry_id].quotes,
                source=sources[by_id[entry_id].source],
            ).model_dump(mode="json"),
        )
        for entry_id in turn.guidance
    ]
    earlier = turn.answers != intake.answers
    scenario: dict[str, Any] | None = None
    if turn.changes:
        changes = what_if(
            gates,
            schema,
            at_question(intake, turn),
            turn.changes,
            None if earlier else result,
        )
        asked = last_questions(schema, intake)
        slots = {slot.id: slot for slot in [*schema.slots, *schema.follow_up_slots]}
        scenario = {
            "questions": [
                {
                    "fact": item.fact,
                    "fact_id": item.fact_id,
                    "question": asked.get(
                        item.fact_id, default_question(slots[item.fact_id])
                    ).text,
                    "now": item.now,
                    "to": item.to,
                    "guidance": [data for slot, data in shown if slot == item.fact_id],
                }
                for item in changes.changed
            ],
            "changes": changes.model_dump(),
        }
    return {
        "question": turn.question,
        "answered": turn.reason == "answered",
        "blocks": [item.model_dump() for item in blocks(turn.text, result)],
        "quotes": [quote.model_dump() for quote in turn.quotes],
        "guidance": [data for _, data in shown],
        "scenario": scenario,
        "for_earlier_answers": earlier,
    }
