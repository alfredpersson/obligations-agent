"""The gates: reads and checks gates.yaml, and works out the result of an intake that has ended: which regulations, roles and risk tiers apply, the answers that decided each one, and the units that each one quotes (GATE-1 to GATE-4, MEMO-6 to MEMO-8 in docs/spec.md)."""

import re
from importlib.resources import files
from typing import Literal
from urllib.parse import quote

from pydantic import BaseModel

from obligations_agent.guidance import TEXT_REQUIRED
from obligations_agent.intakes import Intake, is_relevant
from obligations_agent.schema import NOT_SURE, Schema, load_yaml, read_items

EUR_LEX = "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:"


class GatesError(Exception):
    """A problem in gates.yaml: a key used twice, a part that is missing, an id used twice, a name that does not exist, or a table that does not have each value of its slot in exactly one row."""


class Unit(BaseModel):
    """A unit that the result quotes or links: its citation, the document and the anchor that its link opens on EUR-Lex, and its quote, word for word from the stored copy, or none for a unit that is only linked."""

    model_config = TEXT_REQUIRED

    id: str
    citation: str
    document: str
    anchor: str
    quote: str | None = None


class Row(BaseModel):
    values: list[str]
    result: Literal["applies", "does_not_apply", "listed_use", "always", "unless"]
    quotes: list[str] = []


class Table(BaseModel):
    """A decision table: the result for the values of one slot, and the units that the table quotes for every value."""

    slot: str
    quotes: list[str] = []
    rows: list[Row]


class Derogation(Table):
    """Article 6(3) for an area of Annex III, by the answer about profiling, and the answer that counts when profiling is not asked."""

    not_asked: str


class Gate(Table):
    model_config = TEXT_REQUIRED

    id: str
    label: str
    under: str | None = None
    derogation: Derogation | None = None


class Statement(BaseModel):
    model_config = TEXT_REQUIRED

    text: str
    links: list[str]


class Gates(BaseModel):
    units: list[Unit]
    gates: list[Gate]
    assumptions: list[Statement]
    not_checked: list[Statement]


class Cited(BaseModel):
    """A unit as the result shows it: its citation, its link and its quote."""

    citation: str
    link: str
    quote: str | None = None


class Case(BaseModel):
    values: list[str]
    result: str


class Condition(BaseModel):
    """An open slot that a result depends on, and the gate whose slot it is, with the result for each answer: the result of the gate's own table, or, for the slot of the gate above, this gate's own result where the gate above applies (MEMO-6)."""

    slot: str
    gate: str
    cases: list[Case]


class Outcome(BaseModel):
    """The result of one gate: the status (GATE-2), the result of its row, or none while its slot is open, the result of Article 6(3) for an area of Annex III, the answers of its slots, the open slots it depends on, and the units it quotes."""

    gate: str
    label: str
    status: Literal["applies", "does_not_apply", "conditional"]
    result: str | None
    derogation: str | None = None
    answers: dict[str, str]
    conditions: list[Condition]
    quotes: list[Cited]


class Shown(BaseModel):
    text: str
    links: list[Cited]


class Result(BaseModel):
    assumptions: list[Shown]
    gates: list[Outcome]
    not_checked: list[Shown]


def parse_gates(text: str, schema: Schema) -> Gates:
    """Reads the gates from YAML text, and checks that each table has each value of its slot except "not sure" in exactly one row, and that each slot, unit and gate that the file names exists."""
    data = load_yaml(text, GatesError)
    gates = Gates(
        units=read_items(Unit, "unit", data["units"], GatesError),
        gates=read_items(Gate, "gate", data["gates"], GatesError),
        assumptions=read_items(
            Statement, "assumption", data["assumptions"], GatesError
        ),
        not_checked=read_items(Statement, "item", data["not_checked"], GatesError),
    )
    slots = {slot.id: slot for slot in [*schema.slots, *schema.follow_up_slots]}
    quoted = [unit.id for unit in gates.units if unit.quote is not None]
    earlier: list[str] = []
    for gate in gates.gates:
        for table in [gate, *([gate.derogation] if gate.derogation else [])]:
            slot = slots.get(table.slot)
            if slot is None:
                raise GatesError(
                    f"gate {gate.id}: the slot {table.slot} is not in schema.yaml"
                )
            named = [value for row in table.rows for value in row.values]
            if sorted(named) != sorted(
                value.id for value in slot.values if value.id != NOT_SURE
            ):
                raise GatesError(
                    f"gate {gate.id}: the rows do not name each value of {table.slot} once"
                )
            if isinstance(table, Derogation) and table.not_asked not in named:
                raise GatesError(
                    f"gate {gate.id}: not_asked is not a value of {table.slot}"
                )
            # A gate gives applies, does not apply or a listed use (GATE-2), and the table for
            # Article 6(3) gives always or unless.
            results = (
                ("always", "unless")
                if isinstance(table, Derogation)
                else ("applies", "does_not_apply", "listed_use")
            )
            if any(row.result not in results for row in table.rows):
                raise GatesError(
                    f"gate {gate.id}: a row of {table.slot} has a result that this table does not give"
                )
            for unit_id in [
                *table.quotes,
                *(id for row in table.rows for id in row.quotes),
            ]:
                if unit_id not in quoted:
                    raise GatesError(f"gate {gate.id}: the unit {unit_id} has no quote")
        if gate.under is not None and gate.under not in earlier:
            raise GatesError(f"gate {gate.id}: {gate.under} is not an earlier gate")
        # Each gate names the unit that defines it (GATE-1).
        if not [*gate.quotes, *(unit for row in gate.rows for unit in row.quotes)]:
            raise GatesError(f"gate {gate.id}: the gate names no unit that defines it")
        earlier.append(gate.id)
    linked = [unit.id for unit in gates.units]
    for statement in [*gates.assumptions, *gates.not_checked]:
        for unit_id in statement.links:
            if unit_id not in linked:
                raise GatesError(f"the unit {unit_id} is not in gates.yaml")
    return gates


def load_gates(schema: Schema) -> Gates:
    """Reads gates.yaml from this package."""
    text = files("obligations_agent").joinpath("gates.yaml").read_text(encoding="utf-8")
    return parse_gates(text, schema)


def _text(line: str) -> str:
    # A comma and a hyphen have a meaning in a text directive, so they are encoded as well.
    return quote(" ".join(line.split()), safe="").replace("-", "%2D")


def link(unit: Unit) -> str:
    """The link to the unit on EUR-Lex. For a unit with a quote, the text directive highlights the quote: from its first line to its last line, without a point's letter, since each line is one block of the page and a point's letter is a block of its own (MEMO-7)."""
    url = f"{EUR_LEX}{unit.document}#{unit.anchor}"
    if unit.quote is None:
        return url
    lines = unit.quote.splitlines()
    if len(lines) == 1:
        return f"{url}:~:text={_text(lines[0])}"
    last = re.sub(r"^\([a-z]+\) ", "", lines[-1])
    return f"{url}:~:text={_text(lines[0])},{_text(last)}"


def _cases(table: Table) -> list[Case]:
    """The values of the table's rows grouped by their result, in the order of the rows."""
    cases: list[Case] = []
    for row in table.rows:
        same = next((case for case in cases if case.result == row.result), None)
        if same is None:
            cases.append(Case(values=[*row.values], result=row.result))
        else:
            same.values.extend(row.values)
    return cases


def _evaluate(
    gate: str, table: Table, value: str | None
) -> tuple[str | None, list[Condition], list[str]]:
    """The result of the table's row for the value, and the units that the table and the row quote. An open slot, answered "not sure" or without an answer, matches no row: then there is no result, but a condition on the slot with the result for each answer, and the units of every row (GATE-2, INTAKE-3)."""
    row = next((row for row in table.rows if value in row.values), None)
    if row is None:
        units = [*table.quotes, *(unit for row in table.rows for unit in row.quotes)]
        return None, [Condition(slot=table.slot, gate=gate, cases=_cases(table))], units
    return row.result, [], [*table.quotes, *row.quotes]


def decide(gates: Gates, schema: Schema, intake: Intake) -> Result:
    """The result of an intake that has ended, computed from its answers (GATE-4)."""
    slots = {slot.id: slot for slot in [*schema.slots, *schema.follow_up_slots]}
    units = {unit.id: unit for unit in gates.units}
    answers = intake.answers

    def cited(unit_ids: list[str]) -> list[Cited]:
        return [
            Cited(citation=unit.citation, link=link(unit), quote=unit.quote)
            for unit in (units[unit_id] for unit_id in unit_ids)
        ]

    outcomes: list[Outcome] = []
    for gate in gates.gates:
        if not is_relevant(slots[gate.slot], answers):
            continue
        result, conditions, quotes = _evaluate(gate.id, gate, answers.get(gate.slot))
        derogation: str | None = None
        if gate.derogation and result != "does_not_apply":
            table = gate.derogation
            asked = is_relevant(slots[table.slot], answers)
            value = answers.get(table.slot) if asked else table.not_asked
            derogation, more, cited_too = _evaluate(gate.id, table, value)
            conditions += more
            quotes += cited_too
        above = next(
            (outcome for outcome in outcomes if outcome.gate == gate.under), None
        )
        # A result under a conditional gate is conditional on the same slots, unless its own
        # answer says that it does not apply (MEMO-6). A gate above that is not conditional has
        # no conditions.
        if above is not None and result != "does_not_apply":
            # For each answer of the slot above, this gate's own result where the gate above
            # applies.
            own = "conditional" if result is None else result
            inherited = [
                Condition(
                    slot=condition.slot,
                    gate=condition.gate,
                    cases=[
                        Case(
                            values=case.values,
                            result=own
                            if case.result == "applies"
                            else "does_not_apply",
                        )
                        for case in condition.cases
                    ],
                )
                for condition in above.conditions
            ]
            conditions = [*inherited, *conditions]
        status: Literal["applies", "does_not_apply", "conditional"] = (
            "conditional"
            if conditions or result == "listed_use"
            else "applies"
            if result == "applies"
            else "does_not_apply"
        )
        outcomes.append(
            Outcome(
                gate=gate.id,
                label=gate.label,
                status=status,
                result=result,
                derogation=derogation,
                answers={
                    slot_id: answers[slot_id]
                    for slot_id in [
                        gate.slot,
                        *([gate.derogation.slot] if gate.derogation else []),
                    ]
                    if slot_id in answers
                },
                conditions=conditions,
                quotes=cited(quotes),
            )
        )
    return Result(
        assumptions=[
            Shown(text=item.text, links=cited(item.links)) for item in gates.assumptions
        ],
        gates=outcomes,
        not_checked=[
            Shown(text=item.text, links=cited(item.links)) for item in gates.not_checked
        ],
    )
