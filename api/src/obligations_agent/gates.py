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


class Regulation(BaseModel):
    """A regulation that the result groups its results under, and the gate that decides whether it applies, or none for a regulation that the result assumes to apply (MEMO-6)."""

    model_config = TEXT_REQUIRED

    id: str
    name: str
    gate: str | None = None


class Gate(Table):
    model_config = TEXT_REQUIRED

    id: str
    label: str
    regulation: str
    under: str | None = None
    derogation: Derogation | None = None


class Statement(BaseModel):
    model_config = TEXT_REQUIRED

    text: str
    links: list[str]


class Needs(BaseModel):
    """What a row needs besides its result: the result of another gate, or the answer "yes" of a slot."""

    gate: str | None = None
    slot: str | None = None


class Obligation(BaseModel):
    """A row of a result: its unit, its label, the id of its date, what else it needs, and whether its obligation needs legal drafting (MEMO-5)."""

    model_config = TEXT_REQUIRED

    gate: str
    unit: str
    label: str
    date: str
    needs: Needs | None = None
    drafting: bool = False


class Start(BaseModel):
    """A date from which obligations apply, the unit that sets it, and a unit that the user decides as a condition of that date."""

    id: str
    date: str
    unit: str
    condition: str | None = None


class Gates(BaseModel):
    units: list[Unit]
    regulations: list[Regulation] = []
    gates: list[Gate]
    assumptions: list[Statement]
    not_checked: list[Statement]
    dates: list[Start] = []
    obligations: list[Obligation] = []


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


class Need(BaseModel):
    """What a row needs besides its result, as it decided the row: the answer of a slot, or None while the slot is open, or the status of another gate."""

    slot: str | None = None
    value: str | None = None
    gate: str | None = None
    status: str | None = None


class ObligationRow(BaseModel):
    """A row as the result shows it: its label, its status, its unit quoted and linked, the date from which it applies with the unit that sets it, the condition of that date, what else it needed, and whether it needs legal drafting (MEMO-5, MEMO-6)."""

    id: str
    label: str
    status: Literal["applies", "conditional"]
    unit: Cited
    date: str
    date_unit: Cited
    condition: Cited | None = None
    needs: Need | None = None
    drafting: bool


class Outcome(BaseModel):
    """The result of one gate: the status (GATE-2), the result of its row, or none while its slot is open, the result of Article 6(3) for an area of Annex III, the answers of its slots, the open slots it depends on, the units it quotes, and its rows."""

    gate: str
    label: str
    regulation: str
    status: Literal["applies", "does_not_apply", "conditional"]
    result: str | None
    derogation: str | None = None
    answers: dict[str, str]
    conditions: list[Condition]
    quotes: list[Cited]
    rows: list[ObligationRow] = []


class Shown(BaseModel):
    text: str
    links: list[Cited]


class Result(BaseModel):
    assumptions: list[Shown]
    regulations: list[Regulation]
    gates: list[Outcome]
    not_checked: list[Shown]


def parse_gates(text: str, schema: Schema) -> Gates:
    """Reads the gates from YAML text, and checks that each table has each value of its slot except "not sure" in exactly one row, and that each slot, unit and gate that the file names exists."""
    data = load_yaml(text, GatesError)
    gates = Gates(
        units=read_items(Unit, "unit", data["units"], GatesError),
        regulations=read_items(
            Regulation, "regulation", data["regulations"], GatesError
        ),
        gates=read_items(Gate, "gate", data["gates"], GatesError),
        assumptions=read_items(
            Statement, "assumption", data["assumptions"], GatesError
        ),
        not_checked=read_items(Statement, "item", data["not_checked"], GatesError),
        dates=read_items(Start, "date", data["dates"], GatesError),
        obligations=read_items(
            Obligation, "obligation", data["obligations"], GatesError
        ),
    )
    slots = {slot.id: slot for slot in [*schema.slots, *schema.follow_up_slots]}
    quoted = [unit.id for unit in gates.units if unit.quote is not None]
    regulations = [regulation.id for regulation in gates.regulations]
    earlier: list[str] = []
    for gate in gates.gates:
        if gate.regulation not in regulations:
            raise GatesError(
                f"gate {gate.id}: the regulation {gate.regulation} is not in gates.yaml"
            )
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
    # A regulation's gate decides whether it applies, so it is one of the regulation's own gates.
    owners = {gate.id: gate.regulation for gate in gates.gates}
    for regulation in gates.regulations:
        if regulation.gate is not None and owners.get(regulation.gate) != regulation.id:
            raise GatesError(
                f"regulation {regulation.id}: the gate {regulation.gate} is not one of its gates"
            )
    linked = [unit.id for unit in gates.units]
    for statement in [*gates.assumptions, *gates.not_checked]:
        for unit_id in statement.links:
            if unit_id not in linked:
                raise GatesError(f"the unit {unit_id} is not in gates.yaml")
    for start in gates.dates:
        if start.unit not in linked:
            raise GatesError(
                f"date {start.id}: the unit {start.unit} is not in gates.yaml"
            )
        if start.condition is not None and start.condition not in quoted:
            raise GatesError(
                f"date {start.id}: the unit {start.condition} has no quote"
            )
    dates = [start.id for start in gates.dates]
    for obligation in gates.obligations:
        name = f"obligation {obligation.gate} {obligation.unit}"
        if obligation.gate not in earlier:
            raise GatesError(f"{name}: the gate is not in gates.yaml")
        if obligation.unit not in quoted:
            raise GatesError(f"{name}: the unit has no quote")
        if obligation.date not in dates:
            raise GatesError(f"{name}: the date {obligation.date} is not in gates.yaml")
        needs = obligation.needs
        if needs is not None and (
            (needs.gate is None) == (needs.slot is None)
            or (needs.gate is not None and needs.gate not in earlier)
            or (needs.slot is not None and needs.slot not in slots)
        ):
            raise GatesError(f"{name}: needs names one gate or one slot that exists")
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
                regulation=gate.regulation,
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
    # The rows of each result that applies or is conditional: a row is conditional when its result is,
    # or when what else it needs is open or conditional, and it is left out when that does not apply
    # or is "no" (MEMO-5, MEMO-6).
    starts = {start.id: start for start in gates.dates}
    by_gate = {outcome.gate: outcome for outcome in outcomes}
    for obligation in gates.obligations:
        outcome = by_gate.get(obligation.gate)
        if outcome is None or outcome.status == "does_not_apply":
            continue
        open_need = False
        need: Need | None = None
        needs = obligation.needs
        if needs is not None and needs.slot is not None:
            value = answers.get(needs.slot)
            if value == "no":
                continue
            need = Need(slot=needs.slot, value=value)
            open_need = value != "yes"
        elif needs is not None and needs.gate is not None:
            other = by_gate.get(needs.gate)
            if other is None or other.status == "does_not_apply":
                continue
            need = Need(gate=needs.gate, status=other.status)
            open_need = other.status == "conditional"
        start = starts[obligation.date]
        row_status: Literal["applies", "conditional"] = (
            "conditional" if outcome.status == "conditional" or open_need else "applies"
        )
        outcome.rows.append(
            ObligationRow(
                id=f"{obligation.gate}:{obligation.unit}",
                label=obligation.label,
                status=row_status,
                unit=cited([obligation.unit])[0],
                date=start.date,
                date_unit=cited([start.unit])[0],
                condition=cited([start.condition])[0] if start.condition else None,
                needs=need,
                drafting=obligation.drafting,
            )
        )
    return Result(
        assumptions=[
            Shown(text=item.text, links=cited(item.links)) for item in gates.assumptions
        ],
        regulations=gates.regulations,
        gates=outcomes,
        not_checked=[
            Shown(text=item.text, links=cited(item.links)) for item in gates.not_checked
        ],
    )
