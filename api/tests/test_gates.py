"""Tests for the gates: reading gates.yaml, each gate table against the regulation text, the result of an intake that has ended, and the quote and the link of each unit (issue #37: GATE-1 to GATE-4, MEMO-6 to MEMO-8, VALID-2)."""

from collections.abc import Sequence
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import pytest
import yaml

from obligations_agent.gates import (
    Case,
    Condition,
    GatesError,
    Outcome,
    Result,
    Unit,
    decide,
    link,
    load_gates,
    parse_gates,
)
from obligations_agent.intakes import Intake, NotSure
from obligations_agent.schema import load_schema

SCHEMA = load_schema()
GATES = load_gates(SCHEMA)
COPIES = Path(__file__).resolve().parents[2] / "docs" / "regulations"
# The stored copy of each document that a quote is taken from: the Official Journal text.
COPY = {"32024R1689": "ai-act.txt", "32016R0679": "gdpr.txt"}
# The AI Act as amended by Regulation (EU) 2026/1744, which a link without a quote opens.
CONSOLIDATED = "02024R1689-20260727"
DESCRIPTION = {
    "what_it_does": "Matches job candidates to open roles.",
    "who_uses_it": "Recruiters at staffing agencies.",
    "data_it_handles": "CVs and email addresses of candidates.",
}
YES = [
    Case(values=["yes"], result="applies"),
    Case(values=["no"], result="does_not_apply"),
]


def result_of(
    answers: dict[str, str], not_sure: dict[str, NotSure] | None = None
) -> Result:
    """The result of an intake that has ended with these answers."""
    intake = Intake(answers=answers, description=DESCRIPTION, not_sure=not_sure or {})
    return decide(GATES, SCHEMA, intake)


def shown(gate: str, answers: dict[str, str]) -> Outcome:
    """The result of one gate, which must be in the result."""
    item = next((item for item in result_of(answers).gates if item.gate == gate), None)
    assert item is not None
    return item


def citations(item: Outcome) -> list[str]:
    return [quote.citation for quote in item.quotes]


# GDPR Article 2(1): "This Regulation applies to the processing of personal data wholly or partly by
# automated means and to the processing other than by automated means of personal data which form
# part of a filing system or are intended to form part of a filing system."
@pytest.mark.parametrize(
    ("answer", "status"), [("yes", "applies"), ("no", "does_not_apply")]
)
def test_the_gdpr_applies_to_a_product_that_processes_personal_data(
    answer: str, status: str
) -> None:
    item = shown("gdpr_applies", {"personal_data": answer})

    assert item.status == status
    assert citations(item) == ["GDPR Article 2(1)"]


# GDPR Article 4(7): "'controller' means the natural or legal person, public authority, agency or
# other body which, alone or jointly with others, determines the purposes and means of the
# processing of personal data".
@pytest.mark.parametrize(
    ("answer", "status"), [("yes", "applies"), ("no", "does_not_apply")]
)
def test_the_controller_decides_why_and_how_personal_data_is_processed(
    answer: str, status: str
) -> None:
    item = shown("controller", {"personal_data": "yes", "decides_purposes": answer})

    assert item.status == status
    assert citations(item) == ["GDPR Article 4(7)"]


# GDPR Article 4(8): "'processor' means a natural or legal person, public authority, agency or
# other body which processes personal data on behalf of the controller".
@pytest.mark.parametrize(
    ("answer", "status"), [("yes", "applies"), ("no", "does_not_apply")]
)
def test_the_processor_processes_personal_data_on_behalf_of_a_customer(
    answer: str, status: str
) -> None:
    item = shown(
        "processor", {"personal_data": "yes", "processes_for_customer": answer}
    )

    assert item.status == status
    assert citations(item) == ["GDPR Article 4(8)"]


# AI Act Article 3(3): "'provider' means a natural or legal person, public authority, agency or
# other body that develops an AI system ... and places it on the market or puts the AI system into
# service under its own name or trademark".
@pytest.mark.parametrize(
    ("answer", "status"), [("yes", "applies"), ("no", "does_not_apply")]
)
def test_the_provider_places_the_product_under_its_own_name(
    answer: str, status: str
) -> None:
    item = shown("provider", {"under_own_name": answer})

    assert item.status == status
    assert citations(item) == ["AI Act Article 3(3)"]


# AI Act Article 50(1): "Providers shall ensure that AI systems intended to interact directly with
# natural persons are designed and developed in such a way that the natural persons concerned are
# informed that they are interacting with an AI system".
@pytest.mark.parametrize(
    ("answer", "status"), [("yes", "applies"), ("no", "does_not_apply")]
)
def test_a_provider_whose_product_interacts_with_people_must_say_that_it_is_an_ai_system(
    answer: str, status: str
) -> None:
    item = shown(
        "transparency_interaction",
        {"under_own_name": "yes", "interacts_with_people": answer},
    )

    assert item.status == status
    assert citations(item) == ["AI Act Article 50(1)"]


# Annex III: "High-risk AI systems pursuant to Article 6(2) are the AI systems listed in any of the
# following areas:", points 1 to 8, each under the heading of its area.
ANNEX_III = [
    ("biometrics", 1, "Biometrics"),
    ("critical_infrastructure", 2, "Critical infrastructure"),
    ("education", 3, "Education and vocational training"),
    ("employment", 4, "Employment, workers’ management and access to self-employment"),
    (
        "essential_services",
        5,
        "Access to and enjoyment of essential private services and essential public services and benefits",
    ),
    ("law_enforcement", 6, "Law enforcement"),
    ("migration", 7, "Migration, asylum and border control management"),
    ("justice", 8, "Administration of justice and democratic processes"),
]


@pytest.mark.parametrize(("area", "point", "heading"), ANNEX_III)
def test_an_area_of_annex_iii_is_conditional_on_the_uses_listed_under_its_point(
    area: str, point: int, heading: str
) -> None:
    item = shown("high_risk_annex_iii", {"personal_data": "no", "use_case_area": area})

    # The use-case area holds the headings of Annex III, not the uses listed under them, so the
    # user decides whether the product's intended use is one of them.
    assert item.status == "conditional"
    assert item.result == "listed_use"
    assert item.conditions == []
    assert citations(item) == [
        "AI Act Article 6(2)",
        f"AI Act Annex III, point {point}",
        "AI Act Article 6(3)",
    ]
    quote = item.quotes[1].quote
    assert quote is not None and quote.startswith(heading)


def test_none_of_the_areas_of_annex_iii_is_not_high_risk_under_annex_iii() -> None:
    item = shown(
        "high_risk_annex_iii", {"personal_data": "yes", "use_case_area": "none"}
    )

    assert item.status == "does_not_apply"
    assert citations(item) == ["AI Act Article 6(2)"]


# Article 6(3), third subparagraph: "Notwithstanding the first subparagraph, an AI system referred
# to in Annex III shall always be considered to be high-risk where the AI system performs profiling
# of natural persons."
def test_a_listed_use_is_always_high_risk_when_the_product_performs_profiling() -> None:
    item = shown(
        "high_risk_annex_iii",
        {"personal_data": "yes", "use_case_area": "employment", "profiling": "yes"},
    )

    assert item.derogation == "always"
    assert "AI Act Article 6(3)" in citations(item)


# Article 6(3), first subparagraph: "By derogation from paragraph 2, an AI system referred to in
# Annex III shall not be considered to be high-risk where it does not pose a significant risk of
# harm ...", where one of the conditions of the second subparagraph is fulfilled. Profiling is
# asked only when the product processes personal data.
@pytest.mark.parametrize(
    "answers",
    [
        {"personal_data": "yes", "use_case_area": "employment", "profiling": "no"},
        {"personal_data": "no", "use_case_area": "employment"},
    ],
    ids=["profiling_no", "profiling_not_asked"],
)
def test_without_profiling_a_listed_use_is_high_risk_unless_a_condition_of_article_6_3_applies(
    answers: dict[str, str],
) -> None:
    item = shown("high_risk_annex_iii", answers)

    assert item.derogation == "unless"
    assert "AI Act Article 6(3)" in citations(item)


def test_the_answers_that_decided_a_result_are_given_with_it() -> None:
    item = shown(
        "high_risk_annex_iii",
        {"personal_data": "yes", "use_case_area": "employment", "profiling": "yes"},
    )

    assert item.answers == {"use_case_area": "employment", "profiling": "yes"}


def test_a_not_sure_answer_makes_the_result_conditional_with_the_result_for_each_answer() -> (
    None
):
    item = shown("gdpr_applies", {"personal_data": "not_sure"})

    assert item.status == "conditional"
    assert item.result is None
    assert item.answers == {"personal_data": "not_sure"}
    assert item.conditions == [
        Condition(slot="personal_data", gate="gdpr_applies", cases=YES)
    ]


def test_a_relevant_slot_without_an_answer_makes_the_result_conditional() -> None:
    # As when the intake reaches its limit of questions before it asks about interaction.
    item = shown("transparency_interaction", {"under_own_name": "yes"})

    assert item.status == "conditional"
    assert item.answers == {}
    assert item.conditions == [
        Condition(
            slot="interacts_with_people", gate="transparency_interaction", cases=YES
        )
    ]


def test_a_not_sure_area_gives_two_cases_and_quotes_every_point_of_annex_iii() -> None:
    item = shown(
        "high_risk_annex_iii",
        {"personal_data": "yes", "use_case_area": "not_sure", "profiling": "yes"},
    )

    assert item.status == "conditional"
    assert item.conditions == [
        Condition(
            slot="use_case_area",
            gate="high_risk_annex_iii",
            cases=[
                Case(values=[area for area, _, _ in ANNEX_III], result="listed_use"),
                Case(values=["none"], result="does_not_apply"),
            ],
        )
    ]
    assert citations(item) == [
        "AI Act Article 6(2)",
        *(f"AI Act Annex III, point {point}" for _, point, _ in ANNEX_III),
        "AI Act Article 6(3)",
    ]


@pytest.mark.parametrize("answer", ["not_sure", None])
def test_a_profiling_slot_that_is_open_makes_a_listed_use_conditional_on_it(
    answer: str | None,
) -> None:
    answers = {"personal_data": "yes", "use_case_area": "employment"}
    if answer is not None:
        answers["profiling"] = answer

    item = shown("high_risk_annex_iii", answers)

    assert item.derogation is None
    assert item.conditions == [
        Condition(
            slot="profiling",
            gate="high_risk_annex_iii",
            cases=[
                Case(values=["yes"], result="always"),
                Case(values=["no"], result="unless"),
            ],
        )
    ]


@pytest.mark.parametrize(
    ("gate", "answers", "slot", "above"),
    [
        (
            "controller",
            {"personal_data": "not_sure", "decides_purposes": "yes"},
            "personal_data",
            "gdpr_applies",
        ),
        (
            "processor",
            {"personal_data": "not_sure", "processes_for_customer": "yes"},
            "personal_data",
            "gdpr_applies",
        ),
        (
            "transparency_interaction",
            {"under_own_name": "not_sure", "interacts_with_people": "yes"},
            "under_own_name",
            "provider",
        ),
    ],
)
def test_a_result_under_a_conditional_gate_is_conditional_on_the_same_slot(
    gate: str, answers: dict[str, str], slot: str, above: str
) -> None:
    item = shown(gate, answers)

    assert item.status == "conditional"
    assert item.result == "applies"
    assert item.conditions == [Condition(slot=slot, gate=above, cases=YES)]


def test_a_result_under_a_conditional_gate_whose_own_fact_is_no_does_not_apply() -> (
    None
):
    # Criterion 6 as changed on #37: the result is the same for either answer about personal data.
    item = shown("controller", {"personal_data": "not_sure", "decides_purposes": "no"})

    assert item.status == "does_not_apply"
    assert item.conditions == []


def test_a_result_under_a_conditional_gate_with_its_own_slot_open_depends_on_both() -> (
    None
):
    item = shown(
        "processor", {"personal_data": "not_sure", "processes_for_customer": "not_sure"}
    )

    assert item.conditions == [
        Condition(
            slot="personal_data",
            gate="gdpr_applies",
            cases=[
                Case(values=["yes"], result="conditional"),
                Case(values=["no"], result="does_not_apply"),
            ],
        ),
        Condition(slot="processes_for_customer", gate="processor", cases=YES),
    ]


@pytest.mark.parametrize(
    ("answers", "left_out"),
    [
        ({"personal_data": "no", "under_own_name": "yes"}, ["controller", "processor"]),
        (
            {"personal_data": "yes", "under_own_name": "no"},
            ["transparency_interaction"],
        ),
    ],
)
def test_a_result_whose_slot_is_not_relevant_is_left_out(
    answers: dict[str, str], left_out: list[str]
) -> None:
    gates = [
        item.gate for item in result_of({**answers, "use_case_area": "none"}).gates
    ]

    assert [gate for gate in left_out if gate in gates] == []


def test_the_result_has_a_gate_for_each_fact_of_the_issue_in_order() -> None:
    answers = {
        "personal_data": "yes",
        "under_own_name": "yes",
        "use_case_area": "none",
        "decides_purposes": "yes",
        "processes_for_customer": "no",
        "interacts_with_people": "no",
    }

    assert [item.gate for item in result_of(answers).gates] == [
        "gdpr_applies",
        "controller",
        "processor",
        "provider",
        "high_risk_annex_iii",
        "transparency_interaction",
    ]


def test_the_result_states_two_assumptions_and_five_items_not_checked_each_with_its_links() -> (
    None
):
    result = result_of(
        {"personal_data": "no", "under_own_name": "no", "use_case_area": "none"}
    )

    assert [
        (item.text, [unit.citation for unit in item.links])
        for item in result.assumptions
    ] == [
        (
            "The product is an AI system as defined in AI Act Article 3(1).",
            ["AI Act Article 3(1)"],
        ),
        (
            "The product is offered or used in the EU.",
            ["AI Act Article 2(1)", "GDPR Article 3"],
        ),
    ]
    assert [
        (item.text, [unit.citation for unit in item.links])
        for item in result.not_checked
    ] == [
        ("Deployer", ["AI Act Article 3(4)"]),
        ("Prohibited practices", ["AI Act Article 5"]),
        ("High-risk under Annex I", ["AI Act Article 6(1)"]),
        (
            "Transparency: synthetic content, emotion recognition and biometric categorisation, deepfakes",
            ["AI Act Article 50(2) to 50(4)"],
        ),
        ("The exclusions from each regulation", ["AI Act Article 2", "GDPR Article 2"]),
    ]


# The quotes and the links of the units (MEMO-7, MEMO-8).
QUOTED = [unit for unit in GATES.units if unit.quote is not None]


def normalized(text: str) -> str:
    """The text with each run of whitespace, also a non-breaking space or a line break, as one space."""
    return " ".join(text.split())


@cache
def copy_of(document: str) -> tuple[str, list[str]]:
    """The stored copy of a document after its header, normalized, and each of its lines normalized. Each copy is read once."""
    text = (COPIES / COPY[document]).read_text(encoding="utf-8").split("\n---\n", 1)[1]
    return normalized(text), [normalized(line) for line in text.splitlines()]


@pytest.mark.parametrize("unit", QUOTED, ids=lambda unit: unit.id)
def test_every_quote_occurs_exactly_once_in_the_copy_of_its_document(
    unit: Unit,
) -> None:
    assert unit.quote is not None
    text, _ = copy_of(unit.document)

    assert text.count(normalized(unit.quote)) == 1


@pytest.mark.parametrize("unit", QUOTED, ids=lambda unit: unit.id)
def test_every_link_highlights_exactly_its_quote(unit: Unit) -> None:
    # A text directive highlights from the first match of its start to the first match of its end
    # after that, without regard to case, and the start and the end must each lie within one block
    # of the page, which is one line of the copy.
    assert unit.quote is not None
    text, lines = copy_of(unit.document)
    text = text.lower()
    parts = [
        normalized(unquote(part)).lower()
        for part in link(unit).split(":~:text=", 1)[1].split(",")
    ]
    start = text.find(parts[0])
    end = (
        start + len(parts[0])
        if len(parts) == 1
        else text.find(parts[-1], start + len(parts[0])) + len(parts[-1])
    )

    assert text[start:end] == normalized(unit.quote).lower()
    assert [
        part for part in parts if not any(part in line.lower() for line in lines)
    ] == []


def document_of(unit: Unit) -> str:
    """The document that a unit links to: the Official Journal text, of which the copies hold the quotes, or for an AI Act unit without a quote the AI Act as amended by Regulation (EU) 2026/1744. No act amends the GDPR."""
    if unit.id.startswith("gdpr:"):
        return "32016R0679"
    return "32024R1689" if unit.quote is not None else CONSOLIDATED


def test_a_quote_links_to_the_official_journal_text_and_a_link_without_one_to_the_text_in_force() -> (
    None
):
    assert [unit.id for unit in GATES.units if unit.document != document_of(unit)] == []
    assert [
        unit.id for unit in GATES.units if unit.quote is None and ":~:" in link(unit)
    ] == []


def test_a_link_opens_the_anchor_and_highlights_from_the_first_line_to_the_last() -> (
    None
):
    # A comma and a hyphen have a meaning in a text directive, and a point's letter is a block of
    # its own on the page.
    unit = Unit(
        id="aia:art6(3)",
        citation="AI Act Article 6(3)",
        document="32024R1689",
        anchor="006.003",
        quote="By derogation, high-risk\nThe first subparagraph shall apply:\n(d) a preparatory task, non-binding.",
    )

    assert link(unit) == (
        "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689#006.003"
        ":~:text=By%20derogation%2C%20high%2Drisk,a%20preparatory%20task%2C%20non%2Dbinding."
    )


def test_a_link_without_a_quote_opens_the_anchor() -> None:
    unit = Unit(
        id="aia:art5",
        citation="AI Act Article 5",
        document=CONSOLIDATED,
        anchor="art_5",
    )

    assert link(unit) == (
        "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727#art_5"
    )


# Reading gates.yaml (GATE-1).
UNIT = {
    "id": "gdpr:art2(1)",
    "citation": "GDPR Article 2(1)",
    "document": "32016R0679",
    "anchor": "002.001",
    "quote": "This Regulation applies to the processing of personal data.",
}
LINKED = {
    "id": "gdpr:art3",
    "citation": "GDPR Article 3",
    "document": "32016R0679",
    "anchor": "art_3",
}
GATE = {
    "id": "gdpr_applies",
    "label": "GDPR applies",
    "slot": "personal_data",
    "quotes": ["gdpr:art2(1)"],
    "rows": [
        {"values": ["yes"], "result": "applies"},
        {"values": ["no"], "result": "does_not_apply"},
    ],
}
STATEMENT = {
    "text": "The product is offered or used in the EU.",
    "links": ["gdpr:art3"],
}


def gates_text(
    gates: Sequence[dict[str, Any]] = (GATE,),
    units: Sequence[dict[str, Any]] = (UNIT, LINKED),
    statements: Sequence[dict[str, Any]] = (STATEMENT,),
) -> str:
    """A gates.yaml text with the given gates, units, assumptions and items not checked."""
    return yaml.safe_dump(
        {
            "units": list(units),
            "gates": list(gates),
            "assumptions": list(statements),
            "not_checked": list(statements),
        }
    )


def without(item: dict[str, Any], part: str) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key != part}


def test_a_valid_file_is_read() -> None:
    gates = parse_gates(gates_text(), SCHEMA)

    assert [gate.id for gate in gates.gates] == ["gdpr_applies"]
    assert [unit.quote for unit in gates.units] == [UNIT["quote"], None]


def test_a_key_used_twice_is_refused_with_its_line() -> None:
    text = gates_text() + "gates: []\n"

    with pytest.raises(GatesError, match=r"\bline \d+\b.*\bgates\b"):
        parse_gates(text, SCHEMA)


@pytest.mark.parametrize(
    "rows",
    [
        [{"values": ["yes"], "result": "applies"}],
        [
            {"values": ["yes", "no"], "result": "applies"},
            {"values": ["no"], "result": "does_not_apply"},
        ],
        [
            {"values": ["yes", "maybe"], "result": "applies"},
            {"values": ["no"], "result": "does_not_apply"},
        ],
        [
            {"values": ["yes", "not_sure"], "result": "applies"},
            {"values": ["no"], "result": "does_not_apply"},
        ],
    ],
    ids=["value_missing", "value_twice", "unknown_value", "not_sure_in_a_row"],
)
def test_rows_that_do_not_name_each_value_of_the_slot_once_are_refused_with_the_gate(
    rows: list[dict[str, Any]],
) -> None:
    with pytest.raises(GatesError, match=r"\bgate gdpr_applies\b.*\bpersonal_data\b"):
        parse_gates(gates_text([{**GATE, "rows": rows}]), SCHEMA)


def test_a_gate_whose_slot_is_not_in_the_schema_is_refused_with_its_name() -> None:
    with pytest.raises(GatesError, match=r"\bgate gdpr_applies\b.*\bnot_a_slot\b"):
        parse_gates(gates_text([{**GATE, "slot": "not_a_slot"}]), SCHEMA)


@pytest.mark.parametrize(
    "quotes", [["gdpr:art3"], ["not_a_unit"]], ids=["no_quote", "unknown"]
)
def test_a_gate_that_quotes_a_unit_without_a_quote_is_refused_with_the_unit(
    quotes: list[str],
) -> None:
    with pytest.raises(GatesError, match=rf"\bgate gdpr_applies\b.*{quotes[0]}"):
        parse_gates(gates_text([{**GATE, "quotes": quotes}]), SCHEMA)


def test_a_link_to_a_unit_that_is_not_in_the_file_is_refused_with_the_unit() -> None:
    with pytest.raises(GatesError, match=r"\bnot_a_unit\b"):
        parse_gates(
            gates_text(statements=[{**STATEMENT, "links": ["not_a_unit"]}]), SCHEMA
        )


def test_a_gate_under_a_gate_that_is_not_earlier_is_refused_with_its_name() -> None:
    controller = {
        **GATE,
        "id": "controller",
        "slot": "decides_purposes",
        "under": "gdpr_applies",
    }

    with pytest.raises(GatesError, match=r"\bgate controller\b.*\bgdpr_applies\b"):
        parse_gates(gates_text([controller, GATE]), SCHEMA)


def test_a_derogation_whose_value_when_not_asked_is_not_in_its_rows_is_refused() -> (
    None
):
    area = {
        **GATE,
        "id": "high_risk_annex_iii",
        "slot": "use_case_area",
        "rows": [
            {"values": [area for area, _, _ in ANNEX_III], "result": "listed_use"},
            {"values": ["none"], "result": "does_not_apply"},
        ],
        "derogation": {
            **without(GATE, "id"),
            "slot": "profiling",
            "not_asked": "maybe",
        },
    }

    with pytest.raises(
        GatesError, match=r"\bgate high_risk_annex_iii\b.*\bnot_asked\b"
    ):
        parse_gates(gates_text([area]), SCHEMA)


@pytest.mark.parametrize(
    ("gates", "units", "name"),
    [
        ([GATE, GATE], [UNIT, LINKED], "gdpr_applies"),
        ([GATE], [UNIT, UNIT, LINKED], r"gdpr:art2\(1\)"),
    ],
    ids=["gate", "unit"],
)
def test_an_id_used_twice_is_refused_with_the_id(
    gates: list[dict[str, Any]], units: list[dict[str, Any]], name: str
) -> None:
    with pytest.raises(GatesError, match=rf"{name}.*\bused twice\b"):
        parse_gates(gates_text(gates, units), SCHEMA)


@pytest.mark.parametrize(
    ("gates", "units", "name", "part"),
    [
        ([without(GATE, "id")], [UNIT, LINKED], "gate 1", "id"),
        ([without(GATE, "label")], [UNIT, LINKED], "gate gdpr_applies", "label"),
        ([without(GATE, "rows")], [UNIT, LINKED], "gate gdpr_applies", "rows"),
        ([GATE], [without(UNIT, "anchor"), LINKED], r"unit gdpr:art2\(1\)", "anchor"),
        ([GATE], [{**UNIT, "quote": ""}, LINKED], r"unit gdpr:art2\(1\)", "quote"),
    ],
    ids=["gate_id", "gate_label", "gate_rows", "unit_anchor", "empty_quote"],
)
def test_an_item_without_a_part_is_refused_with_its_name_and_the_part(
    gates: list[dict[str, Any]], units: list[dict[str, Any]], name: str, part: str
) -> None:
    # A name can end with ")", after which a word boundary cannot match.
    with pytest.raises(GatesError, match=rf"(?s)\b{name}.*\b{part}\b"):
        parse_gates(gates_text(gates, units), SCHEMA)
