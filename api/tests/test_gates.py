"""Tests for the gates: reading gates.yaml, each gate table against the regulation text, the result of an intake that has ended, and the quote and the link of each unit (issue #37: GATE-1 to GATE-4, MEMO-6 to MEMO-8, VALID-2), and the rows of the obligations with their dates and the grouping by regulation (issue #41: MEMO-5, MEMO-6), the category of each row (issue #52: GATE-5, MEMO-5), and the deployer, the marking of generated content, their rows and the conditions of their dates (issue #45: GATE-4, GATE-5, MEMO-5, MEMO-8), and the changes that one or more changed answers would make to the result (issue #44: QA-1, GATE-1, INTAKE-1, INTAKE-3)."""

import re
from collections.abc import Sequence
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import pytest
import yaml

from obligations_agent.gates import (
    EUR_LEX,
    AppliedAnswer,
    Case,
    Condition,
    GatesError,
    Need,
    Needs,
    ObligationRow,
    Outcome,
    Refused,
    Result,
    ResultChange,
    RowChange,
    State,
    Unit,
    WhatIf,
    decide,
    link,
    load_gates,
    parse_gates,
    what_if,
)
from obligations_agent.intakes import Intake, NotSure, Requested
from obligations_agent.schema import load_schema

SCHEMA = load_schema()
GATES = load_gates(SCHEMA)
COPIES = Path(__file__).resolve().parents[2] / "docs" / "regulations"
# The stored copy of each document that a quote is taken from: the Official Journal text.
COPY = {
    "32024R1689": "ai-act.txt",
    "32016R0679": "gdpr.txt",
    "32026R1744": "ai-act-2026-1744.txt",
}
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


# AI Act Article 3(4): "'deployer' means a natural or legal person, public authority, agency or other
# body using an AI system under its authority except where the AI system is used in the course of a
# personal non-professional activity;".
@pytest.mark.parametrize(
    ("answer", "status"), [("yes", "applies"), ("no", "does_not_apply")]
)
def test_the_deployer_uses_the_product_under_its_own_authority(
    answer: str, status: str
) -> None:
    item = shown("deployer", {"own_use": answer})

    assert item.status == status
    assert citations(item) == ["AI Act Article 3(4)"]


# AI Act Article 50(2): "Providers of AI systems, including general-purpose AI systems, generating
# synthetic audio, image, video or text content, shall ensure that the outputs of the AI system are
# marked in a machine-readable format and detectable as artificially generated or manipulated."
@pytest.mark.parametrize(
    ("answer", "status"), [("yes", "applies"), ("no", "does_not_apply")]
)
def test_a_provider_whose_product_generates_synthetic_content_must_mark_its_outputs(
    answer: str, status: str
) -> None:
    item = shown(
        "transparency_content", {"under_own_name": "yes", "generates_content": answer}
    )

    assert item.status == status
    assert citations(item) == ["AI Act Article 50(2)"]


@pytest.mark.parametrize("answer", ["not_sure", None], ids=["not_sure", "no_answer"])
@pytest.mark.parametrize(
    ("gate", "slot", "answers"),
    [
        ("deployer", "own_use", {}),
        ("transparency_content", "generates_content", {"under_own_name": "yes"}),
    ],
    ids=["deployer", "generated_content"],
)
def test_an_open_answer_makes_the_deployer_or_the_marking_of_generated_content_conditional(
    gate: str, slot: str, answers: dict[str, str], answer: str | None
) -> None:
    item = shown(gate, answers if answer is None else {**answers, slot: answer})

    assert item.status == "conditional"
    assert item.result is None
    assert item.conditions == [Condition(slot=slot, gate=gate, cases=YES)]


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
        (
            "transparency_content",
            {"under_own_name": "not_sure", "generates_content": "yes"},
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
            ["transparency_interaction", "transparency_content"],
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
        "own_use": "yes",
        "decides_purposes": "yes",
        "processes_for_customer": "no",
        "interacts_with_people": "no",
        "generates_content": "no",
    }

    # The provider's results, then the deployer (MEMO-6: by regulation, then by role).
    assert [item.gate for item in result_of(answers).gates] == [
        "gdpr_applies",
        "controller",
        "processor",
        "provider",
        "high_risk_annex_iii",
        "transparency_interaction",
        "transparency_content",
        "deployer",
    ]


def test_the_result_states_two_assumptions_and_six_items_not_checked_each_with_its_links() -> (
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
        ("Prohibited practices", ["AI Act Article 5"]),
        ("High-risk under Annex I", ["AI Act Article 6(1)"]),
        # The intake does not ask whether the interaction is obvious, nor about systems authorised by
        # law for criminal offences.
        ("The exceptions in Article 50(1)", ["AI Act Article 50(1)"]),
        # Article 50(2): "This obligation shall not apply to the extent the AI systems perform an
        # assistive function for standard editing or do not substantially alter the input data
        # provided by the deployer or the semantics thereof, or where authorised by law to detect,
        # prevent, investigate or prosecute criminal offences." The intake asks none of these.
        ("The exceptions in Article 50(2)", ["AI Act Article 50(2)"]),
        (
            "Transparency: emotion recognition and biometric categorisation, deepfakes",
            ["AI Act Article 50(3) and 50(4)"],
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
    """The document that a unit links to: the Official Journal text, of which the copies hold the quotes, that of Regulation (EU) 2026/1744 for a unit that it replaced, or for an AI Act unit without a quote the AI Act as amended by that regulation. No act amends the GDPR."""
    if unit.id.startswith("gdpr:"):
        return "32016R0679"
    if unit.quote is None:
        return CONSOLIDATED
    return (
        "32026R1744" if "Regulation (EU) 2026/1744" in unit.citation else "32024R1689"
    )


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
    "label": "GDPR",
    "regulation": "gdpr",
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
# A second gate of the same regulation, for a row under a gate that does not decide whether its
# regulation applies.
ROLE = {**GATE, "id": "controller", "label": "Controller", "slot": "decides_purposes"}
# A regulation without a gate, so that a file without the gate gdpr_applies is valid too.
REGULATION = {"id": "gdpr", "name": "GDPR"}
START = {"id": "gdpr", "date": "2018-05-25", "unit": "gdpr:art3"}
OBLIGATION = {
    "gate": "gdpr_applies",
    "unit": "gdpr:art2(1)",
    "label": "A row",
    "category": "organisation",
    "date": "gdpr",
}


def gates_text(
    gates: Sequence[dict[str, Any]] = (GATE,),
    units: Sequence[dict[str, Any]] = (UNIT, LINKED),
    statements: Sequence[dict[str, Any]] = (STATEMENT,),
    regulations: Sequence[dict[str, Any]] = (REGULATION,),
    dates: Sequence[dict[str, Any]] = (START,),
    obligations: Sequence[dict[str, Any]] = (),
) -> str:
    """A gates.yaml text with the given gates, units, assumptions and items not checked, regulations, dates and rows."""
    return yaml.safe_dump(
        {
            "units": list(units),
            "regulations": list(regulations),
            "gates": list(gates),
            "assumptions": list(statements),
            "not_checked": list(statements),
            "dates": list(dates),
            "obligations": list(obligations),
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


# A gate for the use-case area with its table for Article 6(3), which gives "always" or "unless" for
# an area of Annex III.
HIGH_RISK: dict[str, Any] = {
    **GATE,
    "id": "high_risk_annex_iii",
    "slot": "use_case_area",
    "rows": [
        {"values": [area for area, _, _ in ANNEX_III], "result": "listed_use"},
        {"values": ["none"], "result": "does_not_apply"},
    ],
    "derogation": {
        "slot": "profiling",
        "not_asked": "no",
        "quotes": ["gdpr:art2(1)"],
        "rows": [
            {"values": ["yes"], "result": "always"},
            {"values": ["no"], "result": "unless"},
        ],
    },
}


def test_a_gate_with_a_table_for_article_6_3_is_read() -> None:
    gates = parse_gates(gates_text([HIGH_RISK]), SCHEMA)

    derogation = gates.gates[0].derogation
    assert derogation is not None and derogation.not_asked == "no"


def test_a_derogation_whose_value_when_not_asked_is_not_in_its_rows_is_refused() -> (
    None
):
    area = {
        **HIGH_RISK,
        "derogation": {**HIGH_RISK["derogation"], "not_asked": "maybe"},
    }

    with pytest.raises(
        GatesError, match=r"\bgate high_risk_annex_iii\b.*\bnot_asked\b"
    ):
        parse_gates(gates_text([area]), SCHEMA)


@pytest.mark.parametrize("table", ["gate", "derogation"])
def test_a_row_with_a_result_of_the_other_kind_of_table_is_refused_with_the_gate(
    table: str,
) -> None:
    # A gate gives applies, does not apply or a listed use (GATE-2), and the table for Article 6(3)
    # gives always or unless.
    if table == "gate":
        rows = [HIGH_RISK["rows"][0], {"values": ["none"], "result": "always"}]
        area = {**HIGH_RISK, "rows": rows}
    else:
        rows = [
            {"values": ["yes"], "result": "applies"},
            HIGH_RISK["derogation"]["rows"][1],
        ]
        area = {**HIGH_RISK, "derogation": {**HIGH_RISK["derogation"], "rows": rows}}

    with pytest.raises(GatesError, match=r"\bgate high_risk_annex_iii\b.*\bresult\b"):
        parse_gates(gates_text([area]), SCHEMA)


def test_a_gate_that_quotes_no_unit_is_refused_with_its_name() -> None:
    # Each gate names the unit that defines it (GATE-1).
    with pytest.raises(GatesError, match=r"\bgate gdpr_applies\b.*\bunit\b"):
        parse_gates(gates_text([{**GATE, "quotes": []}]), SCHEMA)


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
        (
            [without(GATE, "regulation")],
            [UNIT, LINKED],
            "gate gdpr_applies",
            "regulation",
        ),
        ([GATE], [without(UNIT, "anchor"), LINKED], r"unit gdpr:art2\(1\)", "anchor"),
        ([GATE], [{**UNIT, "quote": ""}, LINKED], r"unit gdpr:art2\(1\)", "quote"),
    ],
    ids=[
        "gate_id",
        "gate_label",
        "gate_rows",
        "gate_regulation",
        "unit_anchor",
        "empty_quote",
    ],
)
def test_an_item_without_a_part_is_refused_with_its_name_and_the_part(
    gates: list[dict[str, Any]], units: list[dict[str, Any]], name: str, part: str
) -> None:
    # A name can end with ")", after which a word boundary cannot match.
    with pytest.raises(GatesError, match=rf"(?s)\b{name}.*\b{part}\b"):
        parse_gates(gates_text(gates, units), SCHEMA)


# The rows of the obligations under each result (issue #41: MEMO-5, MEMO-6).
# Every answer "yes", and the area of employment, so that every result with rows applies or is
# conditional.
ALL_YES = {
    "personal_data": "yes",
    "under_own_name": "yes",
    "use_case_area": "employment",
    "own_use": "yes",
    **{slot.id: "yes" for slot in SCHEMA.follow_up_slots},
}

# Each result's rows, in the order shown: the unit of each row, and the words of its quote that name
# whom or what the obligation binds, from the regulation text, so that a row with another unit fails.
ROWS: dict[str, list[tuple[str, str]]] = {
    "controller": [
        ("gdpr:art6(1)", "Processing shall be lawful only if"),
        (
            "gdpr:art12(2)",
            "The controller shall facilitate the exercise of data subject rights",
        ),
        ("gdpr:art13(1)", "are collected from the data subject, the controller shall"),
        (
            "gdpr:art14(1)",
            "have not been obtained from the data subject, the controller shall provide",
        ),
        (
            "gdpr:art25(1)",
            "the controller shall, both at the time of the determination of the means",
        ),
        (
            "gdpr:art28(1)",
            "the controller shall use only processors providing sufficient guarantees",
        ),
        ("gdpr:art32(1)", "the controller and the processor shall implement"),
        ("gdpr:art33(1)", "the controller shall without undue delay"),
        (
            "gdpr:art35(1)",
            "the controller shall, prior to the processing, carry out an assessment",
        ),
        (
            "gdpr:art9(1)",
            "data concerning a natural person's sex life or sexual orientation shall be prohibited",
        ),
        (
            "gdpr:art22(1)",
            "the right not to be subject to a decision based solely on automated processing",
        ),
    ],
    "processor": [
        ("gdpr:art28(3)", "Processing by a processor shall be governed by a contract"),
        ("gdpr:art28(2)", "The processor shall not engage another processor"),
        ("gdpr:art32(1)", "the controller and the processor shall implement"),
        ("gdpr:art33(2)", "The processor shall notify the controller"),
    ],
    "provider": [
        # Regulation (EU) 2026/1744, Article 1, point (5): the new Article 4(1).
        (
            "aia:art4(1)",
            "Providers and deployers of AI systems shall take measures to support the development of AI literacy",
        ),
    ],
    "transparency_interaction": [
        (
            "aia:art50(5)",
            "The information referred to in paragraphs 1 to 4 shall be provided to the natural persons concerned",
        ),
    ],
    "transparency_content": [
        (
            "aia:art50(2)",
            "shall ensure that the outputs of the AI system are marked in a machine-readable format",
        ),
    ],
    "deployer": [
        (
            "aia:art4(1)",
            "Providers and deployers of AI systems shall take measures to support the development of AI literacy",
        ),
        (
            "aia:art26(1)",
            "Deployers of high-risk AI systems shall take appropriate technical and organisational measures to ensure they use such systems in accordance with the instructions for use",
        ),
        (
            "aia:art26(2)",
            "Deployers shall assign human oversight to natural persons who have the necessary competence, training and authority",
        ),
        (
            "aia:art26(5)",
            "Deployers shall monitor the operation of the high-risk AI system on the basis of the instructions for use",
        ),
        (
            "aia:art26(6)",
            "Deployers of high-risk AI systems shall keep the logs automatically generated by that high-risk AI system",
        ),
        (
            "aia:art26(7)",
            "deployers who are employers shall inform workers’ representatives and the affected workers",
        ),
        (
            "aia:art26(11)",
            "deployers of high-risk AI systems referred to in Annex III that make decisions or assist in making decisions related to natural persons shall inform the natural persons",
        ),
    ],
    "high_risk_annex_iii": [
        (
            "aia:art9(1)",
            "A risk management system shall be established, implemented, documented and maintained in relation to high-risk AI systems",
        ),
        (
            "aia:art10(2)",
            "Training, validation and testing data sets shall be subject to data governance",
        ),
        (
            "aia:art11(1)",
            "The technical documentation of a high-risk AI system shall be drawn up",
        ),
        (
            "aia:art12(1)",
            "High-risk AI systems shall technically allow for the automatic recording of events",
        ),
        (
            "aia:art13(1)",
            "High-risk AI systems shall be designed and developed in such a way as to ensure that their operation is sufficiently transparent",
        ),
        (
            "aia:art14(1)",
            "High-risk AI systems shall be designed and developed in such a way, including with appropriate human-machine interface tools",
        ),
        (
            "aia:art15(1)",
            "an appropriate level of accuracy, robustness, and cybersecurity",
        ),
        (
            "aia:art17(1)",
            "Providers of high-risk AI systems shall put a quality management system in place",
        ),
        (
            "aia:art43(2)",
            "providers shall follow the conformity assessment procedure based on internal control",
        ),
        (
            "aia:art49(1)",
            "shall register themselves and their system in the EU database",
        ),
        (
            "aia:art72(1)",
            "Providers shall establish and document a post-market monitoring system",
        ),
        (
            "aia:art73(1)",
            "Providers of high-risk AI systems placed on the Union market shall report any serious incident",
        ),
    ],
}
EACH_ROW = [(gate, unit, words) for gate, rows in ROWS.items() for unit, words in rows]


def rows_of(result: Result) -> dict[str, list[str]]:
    """The units of the rows of each result that has rows, in the order shown."""
    return {
        item.gate: [row.id.split(":", 1)[1] for row in item.rows]
        for item in result.gates
        if item.rows
    }


def row_of(result: Result, gate: str, unit: str) -> ObligationRow | None:
    """The row of the unit under the result of the gate, or None when it is not shown."""
    return next(
        (
            row
            for item in result.gates
            if item.gate == gate
            for row in item.rows
            if row.id == f"{gate}:{unit}"
        ),
        None,
    )


def test_each_result_that_applies_or_is_conditional_shows_the_rows_of_its_obligations() -> (
    None
):
    assert rows_of(result_of(ALL_YES)) == {
        gate: [unit for unit, _ in rows] for gate, rows in ROWS.items()
    }


@pytest.mark.parametrize(
    ("gate", "unit", "words"),
    EACH_ROW,
    ids=[f"{gate}-{unit}" for gate, unit, _ in EACH_ROW],
)
def test_each_row_quotes_the_unit_that_binds_its_result(
    gate: str, unit: str, words: str
) -> None:
    row = row_of(result_of(ALL_YES), gate, unit)

    assert row is not None and row.unit.quote is not None
    assert normalized(words) in normalized(row.unit.quote)
    assert row.label


def test_a_result_that_does_not_apply_shows_no_rows() -> None:
    # The controller, the provider and the deployer do not apply, and no area of Annex III, so only
    # the processor has rows; the transparency results are not asked without the provider.
    result = result_of(
        {
            **ALL_YES,
            "decides_purposes": "no",
            "under_own_name": "no",
            "use_case_area": "none",
            "own_use": "no",
        }
    )

    assert list(rows_of(result)) == ["processor"]


def test_the_rows_of_a_conditional_result_are_conditional_and_those_of_a_result_that_applies_are_not() -> (
    None
):
    sure = result_of(ALL_YES)
    unsure = result_of(
        {**ALL_YES, "personal_data": "not_sure"}, {"personal_data": NotSure()}
    )

    for result, status in [(sure, "applies"), (unsure, "conditional")]:
        controller = next(item for item in result.gates if item.gate == "controller")
        assert controller.status == status
        assert {row.status for row in controller.rows} == {status}


@pytest.mark.parametrize(
    ("answer", "status"),
    [
        ("yes", "applies"),
        ("no", None),
        ("not_sure", "conditional"),
        (None, "conditional"),
    ],
    ids=["yes", "no", "not_sure", "no_answer"],
)
@pytest.mark.parametrize(
    ("slot", "unit"),
    [("special_categories", "gdpr:art9(1)"), ("automated_decisions", "gdpr:art22(1)")],
    ids=["article_9", "article_22"],
)
def test_a_row_that_needs_the_answer_yes_of_a_fact_is_left_out_on_no_and_conditional_while_it_is_open(
    slot: str, unit: str, answer: str | None, status: str | None
) -> None:
    answers = {key: value for key, value in ALL_YES.items() if key != slot}
    if answer is not None:
        answers[slot] = answer
    not_sure = {slot: NotSure()} if answer == "not_sure" else {}

    row = row_of(result_of(answers, not_sure), "controller", unit)

    assert (row.status if row else None) == status
    if row is not None:
        # The answer that decided the row, or none while the fact has no answer (MEMO-5).
        assert row.needs == Need(slot=slot, value=answer)


@pytest.mark.parametrize(
    ("answer", "shown", "provider"),
    [("yes", True, "applies"), ("no", False, None), ("not_sure", True, "conditional")],
    ids=["provider", "not_provider", "provider_open"],
)
def test_the_rows_of_high_risk_need_the_provider_result(
    answer: str, shown: bool, provider: str | None
) -> None:
    not_sure = {"under_own_name": NotSure()} if answer == "not_sure" else {}
    result = result_of({**ALL_YES, "under_own_name": answer}, not_sure)

    rows = rows_of(result).get("high_risk_annex_iii", [])
    assert len(rows) == (12 if shown else 0)
    for unit in rows:
        row = row_of(result, "high_risk_annex_iii", unit)
        # A use listed in Annex III is for the user to decide, so these rows are always conditional.
        assert row is not None and row.status == "conditional"
        assert row.needs == Need(gate="provider", status=provider)


# AI Act Article 26 binds "deployers of high-risk AI systems": its rows need high-risk under Annex
# III, whose listed use the user decides, so they are always conditional, and they are left out
# without an area of Annex III.
@pytest.mark.parametrize(("area", "shown"), [("employment", True), ("none", False)])
def test_the_rows_of_article_26_need_high_risk_under_annex_iii(
    area: str, shown: bool
) -> None:
    result = result_of({**ALL_YES, "use_case_area": area})

    rows = [
        unit
        for unit in rows_of(result).get("deployer", [])
        if unit.startswith("aia:art26")
    ]
    assert len(rows) == (6 if shown else 0)
    for unit in rows:
        row = row_of(result, "deployer", unit)
        assert row is not None and row.status == "conditional"
        assert row.needs == Need(gate="high_risk_annex_iii", status="conditional")


# AI Act Article 4(1), as replaced by Regulation (EU) 2026/1744: "Providers and deployers of AI
# systems shall take measures to support the development of AI literacy of their staff".
def test_ai_literacy_shows_under_each_role_that_applies() -> None:
    both = result_of(ALL_YES)
    deployer_only = result_of({**ALL_YES, "under_own_name": "no"})

    assert row_of(both, "provider", "aia:art4(1)") is not None
    assert row_of(both, "deployer", "aia:art4(1)") is not None
    assert row_of(deployer_only, "provider", "aia:art4(1)") is None
    assert row_of(deployer_only, "deployer", "aia:art4(1)") is not None


def test_a_row_that_needs_a_conditional_result_is_conditional_under_a_result_that_applies() -> (
    None
):
    # In gates.yaml, only the rows of high-risk under Annex III need another result, and they are
    # conditional by their own result. Here a row of the controller, which applies, needs the
    # provider, which is open.
    first = next(item for item in GATES.obligations if item.gate == "controller")
    obligations = [
        item.model_copy(update={"needs": Needs(gate="provider")})
        if item is first
        else item
        for item in GATES.obligations
    ]
    intake = Intake(
        answers={**ALL_YES, "under_own_name": "not_sure"},
        description=DESCRIPTION,
        not_sure={"under_own_name": NotSure()},
    )

    result = decide(
        GATES.model_copy(update={"obligations": obligations}), SCHEMA, intake
    )

    row = row_of(result, "controller", first.unit)
    assert row is not None and row.status == "conditional"
    assert row.needs == Need(gate="provider", status="conditional")


# The conformity assessment and the registration depend on the point of Annex III, which the answer
# about the area gives. AI Act Article 43(1) is for point 1, Article 43(2) for points 2 to 8, Article
# 49(1) for every point but point 2, and Article 49(5) for point 2, in the words of each quote.
AREA_WORDS = {
    "aia:art43(1)": "For high-risk AI systems listed in point 1 of Annex III",
    "aia:art43(2)": "For high-risk AI systems referred to in points 2 to 8 of Annex III",
    "aia:art49(1)": "with the exception of high-risk AI systems referred to in point 2 of Annex III",
    "aia:art49(5)": "High-risk AI systems referred to in point 2 of Annex III shall be registered at national level.",
}


@pytest.mark.parametrize(
    ("area", "units"),
    [
        ("biometrics", ["aia:art43(1)", "aia:art49(1)"]),
        ("critical_infrastructure", ["aia:art43(2)", "aia:art49(5)"]),
        ("employment", ["aia:art43(2)", "aia:art49(1)"]),
        # While the area is open, each row of a point that it may be.
        ("not_sure", list(AREA_WORDS)),
    ],
    ids=["point_1", "point_2", "point_4", "open"],
)
def test_the_conformity_assessment_and_the_registration_follow_the_point_of_annex_iii(
    area: str, units: list[str]
) -> None:
    not_sure = {"use_case_area": NotSure()} if area == "not_sure" else {}
    result = result_of({**ALL_YES, "use_case_area": area}, not_sure)

    shown = rows_of(result)["high_risk_annex_iii"]
    assert [unit for unit in shown if unit in AREA_WORDS] == units
    for unit in units:
        row = row_of(result, "high_risk_annex_iii", unit)
        assert row is not None and row.unit.quote is not None
        assert normalized(AREA_WORDS[unit]) in normalized(row.unit.quote)
        assert row.date == date_of("high_risk_annex_iii", unit)


# The dates (MEMO-5): the sentence that sets each one, in a stored copy. GDPR Article 99(2); AI Act
# Article 113, second paragraph; and Article 113, third paragraph, points (a) and (c)(i), as replaced
# by Regulation (EU) 2026/1744, Article 1, point (40).
DATES = {
    "2018-05-25": ("32016R0679", "It shall apply from 25 May 2018."),
    "2026-08-02": ("32024R1689", "It shall apply from 2 August 2026."),
    "2025-02-02": ("32026R1744", "Chapters I and II shall apply from 2 February 2025"),
    "2027-12-02": (
        "32026R1744",
        "2 December 2027 as regards AI systems classified as high-risk pursuant to Article 6(2) and Annex III",
    ),
}


@cache
def chapters() -> dict[int, tuple[str, str | None]]:
    """The chapter and the section of each article of the AI Act, by the headings of the stored copy."""
    text = (
        (COPIES / COPY["32024R1689"]).read_text(encoding="utf-8").split("\n---\n", 1)[1]
    )
    found: dict[int, tuple[str, str | None]] = {}
    chapter, section = "", None
    for line in (normalized(line) for line in text.splitlines()):
        if line.startswith("CHAPTER "):
            chapter, section = line.removeprefix("CHAPTER "), None
        elif line.startswith("SECTION "):
            section = line.removeprefix("SECTION ")
        elif line.startswith("Article ") and line.removeprefix("Article ").isdigit():
            found.setdefault(int(line.removeprefix("Article ")), (chapter, section))
    return found


def date_of(gate: str, unit: str) -> str:
    """The date from which the obligation of a row applies, from the regulation text."""
    if unit.startswith("gdpr:"):
        return "2018-05-25"
    # The rows of high-risk under Annex III bind only high-risk systems, and a system under Annex III
    # is classified as high-risk by Article 6, in Chapter III, Section 1, so they apply from the date
    # of that section for Annex III, also those of Articles 43, 49, 72 and 73 outside it (the issue's
    # reading of Article 113).
    article = (
        6 if gate == "high_risk_annex_iii" else int(unit.split("art")[1].split("(")[0])
    )
    chapter, section = chapters()[article]
    if chapter == "I":
        return "2025-02-02"
    if chapter == "III" and section in ("1", "2", "3"):
        return "2027-12-02"
    return "2026-08-02"


def test_each_date_is_set_by_a_sentence_of_the_regulations() -> None:
    for document, sentence in DATES.values():
        text, _ = copy_of(document)
        assert normalized(sentence) in text
    assert chapters()[4] == ("I", None)
    assert chapters()[6] == ("III", "1")


@pytest.mark.parametrize(
    ("gate", "unit", "words"),
    EACH_ROW,
    ids=[f"{gate}-{unit}" for gate, unit, _ in EACH_ROW],
)
def test_each_row_applies_from_the_date_of_its_unit(
    gate: str, unit: str, words: str
) -> None:
    row = row_of(result_of(ALL_YES), gate, unit)

    assert row is not None
    assert row.date == date_of(gate, unit)


def test_each_date_links_to_the_article_that_sets_it() -> None:
    for item in result_of(ALL_YES).gates:
        for row in item.rows:
            if row.id.split(":", 1)[1].startswith("gdpr:"):
                assert row.date_unit.citation == "GDPR Article 99(2)"
                assert row.date_unit.link == f"{EUR_LEX}32016R0679#099.002"
            else:
                assert row.date_unit.citation.startswith("AI Act Article 113")
                assert row.date_unit.link == f"{EUR_LEX}{CONSOLIDATED}#art_113"


# Article 111(2), as replaced by Regulation (EU) 2026/1744, Article 1, point (39)(a): a high-risk
# system placed on the market or put into service before the date of application of Chapter III is
# covered "only if, as from that date, those systems are subject to significant changes in their
# designs". Article 111(4), added by point (39)(b): providers of systems generating synthetic content
# "that have been placed on the market before 2 August 2026 shall take the necessary steps in order to
# comply with Article 50(2) by 2 December 2026". Each is a condition of a date that the user decides.
CONDITIONS = {
    "111.002": "only if, as from that date, those systems are subject to significant changes in their designs",
    "111.004": "that have been placed on the market before 2 August 2026 shall take the necessary steps in order to comply with Article 50(2) by 2 December 2026",
}


def test_the_rows_of_chapter_iii_state_article_111_2_the_row_of_article_50_2_states_article_111_4_and_no_other_row_a_condition() -> (
    None
):
    for item in result_of(ALL_YES).gates:
        for row in item.rows:
            unit = row.id.split(":", 1)[1]
            anchor = (
                "111.002"
                if item.gate == "high_risk_annex_iii" or unit.startswith("aia:art26")
                else "111.004"
                if unit == "aia:art50(2)"
                else None
            )
            if anchor is None:
                assert row.condition is None
                continue
            assert row.condition is not None and row.condition.quote is not None
            assert CONDITIONS[anchor] in normalized(row.condition.quote)
            assert row.condition.link.startswith(
                f"{EUR_LEX}32026R1744#{anchor}:~:text="
            )


def test_the_marking_of_generated_content_applies_from_2_august_2026_and_by_2_december_2026_for_a_product_already_on_the_market() -> (
    None
):
    row = row_of(result_of(ALL_YES), "transparency_content", "aia:art50(2)")

    assert row is not None and row.condition is not None
    assert row.date == "2026-08-02"
    assert row.condition.title == "For a system already on the market before that date"
    assert (
        row.condition.text
        == "A system placed on the market before that date must meet it by 2 December 2026. You decide this."
    )


def test_the_condition_of_the_date_of_chapter_iii_says_in_short_what_article_111_2_says() -> (
    None
):
    row = row_of(result_of(ALL_YES), "deployer", "aia:art26(1)")

    assert row is not None and row.condition is not None
    assert (
        row.condition.title
        == "For a system already on the market or in service before that date"
    )
    assert row.condition.text == (
        "For a system placed on the market or put into service before that date, these rows apply only if its design changes significantly from that date. A system intended to be used by public authorities must meet them by 2 August 2030 in any case. You decide this."
    )


def test_ai_literacy_quotes_paragraph_1_of_the_new_article_4_from_the_amending_act() -> (
    None
):
    # Regulation (EU) 2026/1744, Article 1, point (5), replaces Article 4. Its paragraph 1 binds
    # providers and deployers; paragraphs 2 and 3 bind the Commission, the Member States and the
    # Board.
    unit = next(unit for unit in GATES.units if unit.id == "aia:art4(1)")

    assert unit.document == "32026R1744" and unit.anchor == "004.001"
    assert unit.quote is not None
    assert "The Commission and the Member States" not in unit.quote
    assert normalized(unit.quote).endswith(
        "This obligation does not require providers or deployers to guarantee any specific level of AI literacy of any individual."
    )


# The obligations that need legal drafting ("What it is" in docs/brief.md), by the words of their
# quotes: information to provide to people, a written authorisation, a contract, written policies.
DRAFTING = {
    (
        "controller",
        "gdpr:art13(1)",
    ): "provide the data subject with all of the following information",
    (
        "controller",
        "gdpr:art14(1)",
    ): "shall provide the data subject with the following information",
    ("processor", "gdpr:art28(2)"): "written authorisation of the controller",
    (
        "processor",
        "gdpr:art28(3)",
    ): "shall be governed by a contract or other legal act",
    (
        "high_risk_annex_iii",
        "aia:art17(1)",
    ): "in the form of written policies, procedures and instructions",
    (
        "deployer",
        "aia:art26(11)",
    ): "shall inform the natural persons that they are subject to the use of the high-risk AI system",
}


def test_the_rows_that_need_legal_drafting_are_marked_and_no_other() -> None:
    result = result_of(ALL_YES)
    marked = {
        (item.gate, row.id.split(":", 1)[1])
        for item in result.gates
        for row in item.rows
        if row.drafting
    }

    assert marked == set(DRAFTING)
    for (gate, unit), words in DRAFTING.items():
        row = row_of(result, gate, unit)
        assert row is not None and row.unit.quote is not None
        assert words in normalized(row.unit.quote)


# The category of each row (issue #52): who carries out its action, set by hand in gates.yaml as in
# the issue's table, and organisation for AI Act Articles 43(1) and 49(5), which the table does not
# have (the plan).
CATEGORIES: dict[tuple[str, str], str] = {
    ("controller", "gdpr:art6(1)"): "legal",
    ("controller", "gdpr:art12(2)"): "technical",
    ("controller", "gdpr:art13(1)"): "legal",
    ("controller", "gdpr:art14(1)"): "legal",
    ("controller", "gdpr:art25(1)"): "technical",
    ("controller", "gdpr:art28(1)"): "organisation",
    ("controller", "gdpr:art32(1)"): "technical",
    ("controller", "gdpr:art33(1)"): "organisation",
    ("controller", "gdpr:art35(1)"): "legal",
    ("controller", "gdpr:art9(1)"): "legal",
    ("controller", "gdpr:art22(1)"): "legal",
    ("processor", "gdpr:art28(3)"): "legal",
    ("processor", "gdpr:art28(2)"): "legal",
    ("processor", "gdpr:art32(1)"): "technical",
    ("processor", "gdpr:art33(2)"): "organisation",
    ("provider", "aia:art4(1)"): "organisation",
    ("transparency_interaction", "aia:art50(5)"): "technical",
    ("high_risk_annex_iii", "aia:art9(1)"): "organisation",
    ("high_risk_annex_iii", "aia:art10(2)"): "technical",
    ("high_risk_annex_iii", "aia:art11(1)"): "technical",
    ("high_risk_annex_iii", "aia:art12(1)"): "technical",
    ("high_risk_annex_iii", "aia:art13(1)"): "technical",
    ("high_risk_annex_iii", "aia:art14(1)"): "technical",
    ("high_risk_annex_iii", "aia:art15(1)"): "technical",
    ("high_risk_annex_iii", "aia:art17(1)"): "legal",
    ("high_risk_annex_iii", "aia:art43(1)"): "organisation",
    ("high_risk_annex_iii", "aia:art43(2)"): "organisation",
    ("high_risk_annex_iii", "aia:art49(1)"): "organisation",
    ("high_risk_annex_iii", "aia:art49(5)"): "organisation",
    ("high_risk_annex_iii", "aia:art72(1)"): "organisation",
    ("high_risk_annex_iii", "aia:art73(1)"): "organisation",
    # The table of #45.
    ("transparency_content", "aia:art50(2)"): "technical",
    ("deployer", "aia:art4(1)"): "organisation",
    ("deployer", "aia:art26(1)"): "organisation",
    ("deployer", "aia:art26(2)"): "organisation",
    ("deployer", "aia:art26(5)"): "organisation",
    ("deployer", "aia:art26(6)"): "technical",
    ("deployer", "aia:art26(7)"): "organisation",
    ("deployer", "aia:art26(11)"): "legal",
}


def test_each_row_has_the_category_of_the_issue() -> None:
    assert {
        (row.gate, row.unit): row.category for row in GATES.obligations
    } == CATEGORIES


# A row that needs legal drafting is a task for a legal representative.
def test_every_row_that_needs_legal_drafting_is_legal() -> None:
    drafting = [row for row in GATES.obligations if row.drafting]

    assert len(drafting) == len(DRAFTING)
    assert all(row.category == "legal" for row in drafting)


def test_each_row_of_the_result_has_the_category_of_its_row_in_the_file() -> None:
    result = result_of(ALL_YES)
    rows = [(item.gate, row) for item in result.gates for row in item.rows]

    assert len(rows) == 37
    for gate, row in rows:
        assert row.category == CATEGORIES[(gate, row.id.split(":", 1)[1])]


# The grouping by regulation (MEMO-6): each result belongs to the regulation of the unit that defines
# it, and the gate that decides whether the GDPR applies is the GDPR's head.
def test_the_result_groups_its_results_under_the_regulation_of_the_unit_that_defines_each() -> (
    None
):
    documents = {"32016R0679": "gdpr", "32024R1689": "ai_act"}
    units = {unit.id: unit for unit in GATES.units}
    result = result_of(ALL_YES)

    assert [(item.id, item.name, item.gate) for item in result.regulations] == [
        ("gdpr", "GDPR", "gdpr_applies"),
        ("ai_act", "AI Act", None),
    ]
    for item in result.gates:
        gate = next(gate for gate in GATES.gates if gate.id == item.gate)
        assert item.regulation == documents[units[gate.quotes[0]].document]
    assert (
        next(item for item in result.gates if item.gate == "gdpr_applies").label
        == "GDPR"
    )


# Reading the rows, the dates and the regulations of gates.yaml.
def test_a_valid_file_with_a_row_is_read() -> None:
    gates = parse_gates(
        gates_text(
            [GATE, ROLE],
            regulations=[{**REGULATION, "gate": "gdpr_applies"}],
            obligations=[{**OBLIGATION, "gate": "controller", "values": ["yes"]}],
        ),
        SCHEMA,
    )

    assert [
        (row.gate, row.unit, row.date, row.values) for row in gates.obligations
    ] == [("controller", "gdpr:art2(1)", "gdpr", ["yes"])]
    assert [(item.id, item.gate) for item in gates.regulations] == [
        ("gdpr", "gdpr_applies")
    ]


@pytest.mark.parametrize(
    ("obligation", "name"),
    [
        ({**OBLIGATION, "gate": "not_a_gate"}, "not_a_gate"),
        ({**OBLIGATION, "unit": "gdpr:art3"}, "gdpr:art3"),
        ({**OBLIGATION, "unit": "not_a_unit"}, "not_a_unit"),
        ({**OBLIGATION, "date": "not_a_date"}, "not_a_date"),
        (
            {**OBLIGATION, "needs": {"gate": "gdpr_applies", "slot": "personal_data"}},
            "needs",
        ),
        ({**OBLIGATION, "needs": {}}, "needs"),
        ({**OBLIGATION, "needs": {"gate": "not_a_gate"}}, "needs"),
        ({**OBLIGATION, "needs": {"slot": "not_a_slot"}}, "needs"),
        # A row needs the answer "yes" of a slot, which the area does not have.
        ({**OBLIGATION, "needs": {"slot": "use_case_area"}}, "needs"),
        ({**OBLIGATION, "values": ["not_a_value"]}, "values"),
    ],
    ids=[
        "unknown_gate",
        "unit_without_quote",
        "unknown_unit",
        "unknown_date",
        "needs_both",
        "needs_neither",
        "needs_unknown_gate",
        "needs_unknown_slot",
        "needs_slot_without_yes",
        "unknown_value",
    ],
)
def test_a_row_that_names_what_the_file_does_not_have_is_refused_with_the_row(
    obligation: dict[str, Any], name: str
) -> None:
    with pytest.raises(GatesError, match=rf"(?s)\bobligation\b.*{name}"):
        parse_gates(gates_text(obligations=[obligation]), SCHEMA)


# A row without a category, or with another value, is refused with its position in the list and the
# part, as a row without a label is (issue #52).
@pytest.mark.parametrize(
    ("obligation", "error"),
    [
        (
            without(OBLIGATION, "category"),
            "Field required",
        ),
        (
            {**OBLIGATION, "category": "tax"},
            "Input should be 'legal', 'technical' or 'organisation'",
        ),
        (
            {**OBLIGATION, "category": "Legal"},
            "Input should be 'legal', 'technical' or 'organisation'",
        ),
    ],
    ids=["no_category", "another_value", "another_case"],
)
def test_a_row_without_a_category_or_with_another_value_is_refused(
    obligation: dict[str, Any], error: str
) -> None:
    with pytest.raises(
        GatesError,
        match=rf"(?s)^obligation 1: 1 validation error for Obligation\ncategory\n\s+{re.escape(error)}",
    ):
        parse_gates(gates_text(obligations=[obligation]), SCHEMA)


def test_a_row_that_needs_legal_drafting_and_is_not_legal_is_refused_with_the_row() -> (
    None
):
    with pytest.raises(
        GatesError,
        match=r"\bobligation gdpr_applies gdpr:art2\(1\): a row that needs legal drafting is legal\b",
    ):
        parse_gates(
            gates_text(
                obligations=[{**OBLIGATION, "drafting": True, "category": "technical"}]
            ),
            SCHEMA,
        )


# Two rows with the same gate and unit would have the same id, and one would lose its texts.
def test_a_row_in_the_file_twice_is_refused_with_the_row() -> None:
    with pytest.raises(
        GatesError, match=r"\bobligation gdpr_applies gdpr:art2\(1\).*\btwice\b"
    ):
        parse_gates(gates_text(obligations=[OBLIGATION, OBLIGATION]), SCHEMA)


# The result shows the gate that decides whether a regulation applies as the regulation's head, with
# no rows under it, so a row there would never show.
def test_a_row_under_the_gate_of_a_regulation_is_refused_with_the_row() -> None:
    with pytest.raises(
        GatesError, match=r"\bobligation gdpr_applies\b.*\bregulation gdpr\b"
    ):
        parse_gates(
            gates_text(
                regulations=[{**REGULATION, "gate": "gdpr_applies"}],
                obligations=[OBLIGATION],
            ),
            SCHEMA,
        )


CONDITION = {
    "unit": "gdpr:art2(1)",
    "title": "For a system already on the market before that date",
    "text": "It must meet it by a later date.",
}


@pytest.mark.parametrize(
    ("start", "name"),
    [
        ({**START, "unit": "not_a_unit"}, "not_a_unit"),
        ({**START, "condition": {**CONDITION, "unit": "gdpr:art3"}}, "gdpr:art3"),
        ({**START, "condition": without(CONDITION, "title")}, "title"),
        ({**START, "condition": {**CONDITION, "text": ""}}, "text"),
    ],
    ids=[
        "unknown_unit",
        "condition_without_quote",
        "condition_without_title",
        "condition_with_an_empty_sentence",
    ],
)
def test_a_date_that_names_what_the_file_does_not_have_is_refused_with_the_date(
    start: dict[str, Any], name: str
) -> None:
    with pytest.raises(GatesError, match=rf"(?s)\bdate gdpr\b.*{name}"):
        parse_gates(gates_text(dates=[start]), SCHEMA)


def test_a_gate_whose_regulation_is_not_in_the_file_is_refused_with_its_name() -> None:
    with pytest.raises(
        GatesError, match=r"\bgate gdpr_applies\b.*\bnot_a_regulation\b"
    ):
        parse_gates(gates_text([{**GATE, "regulation": "not_a_regulation"}]), SCHEMA)


@pytest.mark.parametrize(
    ("regulations", "name"),
    [
        (
            [{**REGULATION, "gate": "not_a_gate"}],
            r"\bregulation gdpr\b.*\bnot_a_gate\b",
        ),
        (
            [REGULATION, {"id": "ai_act", "name": "AI Act", "gate": "gdpr_applies"}],
            r"\bregulation ai_act\b.*\bgdpr_applies\b",
        ),
    ],
    ids=["unknown_gate", "gate_of_another_regulation"],
)
def test_a_regulation_whose_gate_is_not_one_of_its_own_is_refused_with_its_name(
    regulations: list[dict[str, Any]], name: str
) -> None:
    with pytest.raises(GatesError, match=name):
        parse_gates(gates_text(regulations=regulations), SCHEMA)


# A product with three open answers, in the area of employment (issue #44).
WHAT_IF = {
    "personal_data": "yes",
    "under_own_name": "not_sure",
    "use_case_area": "employment",
    "own_use": "yes",
    "decides_purposes": "yes",
    "processes_for_customer": "not_sure",
    "special_categories": "no",
    "automated_decisions": "no",
    "interacts_with_people": "yes",
    "generates_content": "no",
    "profiling": "yes",
}
# A product without personal data, under its own name, outside the areas of Annex III.
WITHOUT_DATA = {
    "personal_data": "no",
    "under_own_name": "yes",
    "use_case_area": "none",
    "own_use": "no",
    "interacts_with_people": "yes",
    "generates_content": "no",
}
PROCESSOR_ROWS = [item.label for item in GATES.obligations if item.gate == "processor"]


def changes_of(answers: dict[str, str], *changes: tuple[str, str]) -> WhatIf:
    """What the changes, each a fact and a value, would make of the result of an intake that has ended with these answers."""
    intake = Intake(answers=answers, description=DESCRIPTION)
    return what_if(
        GATES,
        SCHEMA,
        intake,
        [Requested(fact=fact, value=value) for fact, value in changes],
    )


def citation_of(unit_id: str) -> str:
    return next(unit.citation for unit in GATES.units if unit.id == unit_id)


def test_under_own_name_no_removes_the_rows_of_the_provider_and_its_follow_up_questions() -> (
    None
):
    changes = changes_of(WHAT_IF, ("under_own_name", "no"))

    assert changes.changed == [
        AppliedAnswer(
            fact="Under own name or trademark",
            fact_id="under_own_name",
            value="no",
            now="Not sure",
            to="No",
        )
    ]
    assert changes.refused == []
    assert changes.results == [
        ResultChange(
            result="Provider",
            regulation="AI Act",
            before=State(
                status="conditional",
                open=["Under own name or trademark"],
                article_6_3=None,
            ),
            after=State(status="does_not_apply", open=[], article_6_3=None),
        ),
        ResultChange(
            result="Transparency: people interact with the product",
            regulation="AI Act",
            before=State(
                status="conditional",
                open=["Under own name or trademark"],
                article_6_3=None,
            ),
            after=None,
        ),
        ResultChange(
            result="Transparency: the product generates content",
            regulation="AI Act",
            before=State(status="does_not_apply", open=[], article_6_3=None),
            after=None,
        ),
    ]
    assert changes.rows_removed[0] == RowChange(
        label="AI literacy of staff",
        result="Provider",
        category="organisation",
        status="conditional",
        citation=citation_of("aia:art4(1)"),
        date="2 February 2025",
    )
    removed = [(row.result, row.label) for row in changes.rows_removed]
    assert (
        "Transparency: people interact with the product",
        "Information at the first interaction",
    ) in removed
    # Each row of the high-risk tier needs the provider, and the deployer's rows stay.
    assert [result for result, _ in removed].count("High-risk under Annex III") == 12
    assert "Deployer" not in [result for result, _ in removed]
    assert changes.rows_added == [] and changes.rows_changed == []
    assert changes.no_longer_asked == [
        "Interacts with people",
        "Generates synthetic content",
    ]
    assert changes.now_open == []


def test_personal_data_no_gives_the_questions_that_would_no_longer_be_asked() -> None:
    changes = changes_of(
        {**WHAT_IF, "personal_data": "not_sure"}, ("personal_data", "no")
    )

    assert changes.no_longer_asked == [
        "Decides why and how personal data is processed",
        "Processes personal data for a customer",
        "Special categories of personal data",
        "Automated decisions about people",
        "Profiling",
    ]
    assert [item.result for item in changes.results] == [
        "GDPR",
        "Controller",
        "Processor",
        "High-risk under Annex III",
    ]
    assert changes.results[0].before == State(
        status="conditional", open=["Personal data"], article_6_3=None
    )
    assert changes.results[0].after == State(
        status="does_not_apply", open=[], article_6_3=None
    )
    assert changes.results[2].before == State(
        status="conditional",
        open=["Personal data", "Processes personal data for a customer"],
        article_6_3=None,
    )
    assert changes.results[2].after is None
    # Without the question of profiling, a listed use is high-risk unless a condition of Article
    # 6(3) is met.
    assert changes.results[3].before == State(
        status="conditional", open=[], article_6_3="always"
    )
    assert changes.results[3].after == State(
        status="conditional", open=[], article_6_3="unless"
    )
    assert {row.result for row in changes.rows_removed} == {"Controller", "Processor"}
    assert changes.rows_added == [] and changes.now_open == []


def test_processing_for_a_customer_yes_changes_the_status_of_the_processors_rows() -> (
    None
):
    changes = changes_of(WHAT_IF, ("processes_for_customer", "yes"))

    assert changes.results == [
        ResultChange(
            result="Processor",
            regulation="GDPR",
            before=State(
                status="conditional",
                open=["Processes personal data for a customer"],
                article_6_3=None,
            ),
            after=State(status="applies", open=[], article_6_3=None),
        )
    ]
    assert [(row.label, row.before, row.status) for row in changes.rows_changed] == [
        (label, "conditional", "applies") for label in PROCESSOR_ROWS
    ]
    assert changes.rows_changed[0].date == "25 May 2018"
    assert changes.rows_added == [] and changes.rows_removed == []


def test_an_answer_that_makes_four_questions_relevant_makes_them_open() -> None:
    changes = changes_of(WITHOUT_DATA, ("personal_data", "yes"))

    assert changes.now_open == [
        "Decides why and how personal data is processed",
        "Processes personal data for a customer",
        "Special categories of personal data",
        "Automated decisions about people",
    ]
    assert changes.results[1] == ResultChange(
        result="Controller",
        regulation="GDPR",
        before=None,
        after=State(
            status="conditional",
            open=["Decides why and how personal data is processed"],
            article_6_3=None,
        ),
    )
    assert {row.status for row in changes.rows_added} == {"conditional"}
    assert {row.result for row in changes.rows_added} == {"Controller", "Processor"}


def test_several_answers_change_together_in_the_order_of_the_facts() -> None:
    # Decides why and how is asked only once the product processes personal data.
    changes = changes_of(
        WITHOUT_DATA, ("decides_purposes", "yes"), ("personal_data", "yes")
    )

    assert changes.changed == [
        AppliedAnswer(
            fact="Personal data",
            fact_id="personal_data",
            value="yes",
            now="No",
            to="Yes",
        ),
        AppliedAnswer(
            fact="Decides why and how personal data is processed",
            fact_id="decides_purposes",
            value="yes",
            now="no answer",
            to="Yes",
        ),
    ]
    assert changes.refused == []
    assert changes.now_open == [
        "Processes personal data for a customer",
        "Special categories of personal data",
        "Automated decisions about people",
    ]
    assert changes.results[1].after == State(
        status="applies", open=[], article_6_3=None
    )
    added = {(row.result, row.label): row for row in changes.rows_added}
    legal_basis = added[("Controller", "A legal basis for each purpose")]
    assert (legal_basis.status, legal_basis.category, legal_basis.date) == (
        "applies",
        "legal",
        "25 May 2018",
    )
    assert legal_basis.citation == citation_of("gdpr:art6(1)")
    # A row that also needs an open answer is conditional.
    assert {
        row.status for (result, _), row in added.items() if result == "Processor"
    } == {"conditional"}


def test_a_fact_named_by_its_label_is_applied() -> None:
    changes = changes_of(WITHOUT_DATA, ("Generates synthetic content", "yes"))

    assert [item.fact_id for item in changes.changed] == ["generates_content"]
    assert changes.refused == []
    assert [row.label for row in changes.rows_added] == [
        "Machine-readable marking of generated content"
    ]


@pytest.mark.parametrize(
    ("change", "error"),
    [
        (("price", "yes"), "unknown_fact"),
        (("profiling", "yes"), "not_asked"),
        (("personal_data", "maybe"), "unknown_value"),
        (("under_own_name", "yes"), "same_answer"),
    ],
    ids=["unknown_fact", "not_asked", "unknown_value", "same_answer"],
)
def test_a_change_that_cannot_be_applied_is_refused_and_changes_nothing(
    change: tuple[str, str], error: str
) -> None:
    changes = changes_of(WITHOUT_DATA, change)

    assert changes == WhatIf(
        changed=[],
        refused=[
            Refused.model_validate(
                {"fact": change[0], "value": change[1], "error": error}
            )
        ],
        results=[],
        rows_added=[],
        rows_removed=[],
        rows_changed=[],
        now_open=[],
        no_longer_asked=[],
    )


def test_a_refused_change_leaves_the_others_applied() -> None:
    changes = changes_of(WITHOUT_DATA, ("price", "yes"), ("generates_content", "yes"))

    assert [item.fact_id for item in changes.changed] == ["generates_content"]
    assert [item.error for item in changes.refused] == ["unknown_fact"]


def test_the_intake_is_unchanged_after_the_changes_are_computed() -> None:
    intake = Intake(answers=WHAT_IF, description=DESCRIPTION, confirmed=True)
    before = intake.model_copy(deep=True)

    what_if(
        GATES,
        SCHEMA,
        intake,
        [
            Requested(fact="personal_data", value="no"),
            Requested(fact="under_own_name", value="no"),
        ],
    )

    assert intake == before
    assert decide(GATES, SCHEMA, intake) == decide(GATES, SCHEMA, before)


def test_an_open_question_that_a_change_makes_irrelevant_is_no_longer_asked() -> None:
    # Personal data "Not sure" with the questions that follow from it not answered yet.
    answers = {
        "personal_data": "not_sure",
        "under_own_name": "no",
        "use_case_area": "none",
        "own_use": "no",
    }

    changes = changes_of(answers, ("personal_data", "no"))

    assert changes.no_longer_asked == [
        "Decides why and how personal data is processed",
        "Processes personal data for a customer",
        "Special categories of personal data",
        "Automated decisions about people",
    ]
