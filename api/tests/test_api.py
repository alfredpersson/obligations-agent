"""Tests for GET /schema, POST /intakes and GET /intakes/{id}: acceptance criteria 2 to 7 of issue #7, and the three description fields of issue #12."""

import re

import pytest
from fastapi.testclient import TestClient

from obligations_agent.intakes import Intake
from obligations_agent.schema import load_schema
from obligations_agent.server import create_app

YES_NO_NOT_SURE = [
    {"id": "yes", "label": "Yes"},
    {"id": "no", "label": "No"},
    {"id": "not_sure", "label": "Not sure"},
]

ANSWERS = {
    "personal_data": "yes",
    "under_own_name": "not_sure",
    "use_case_area": "none",
}
DESCRIPTION = {
    "what_it_does": "Answers questions about orders in an online shop.",
    "who_uses_it": "The shop's support team. The shop's customers chat with it.",
    "data_it_handles": "Order numbers, and the names and email addresses of customers.",
}


@pytest.fixture
def intakes() -> dict[str, Intake]:
    return {}


@pytest.fixture
def client(intakes: dict[str, Intake]) -> TestClient:
    return TestClient(create_app(load_schema(), intakes))


def test_get_schema_returns_the_three_description_fields_and_the_three_facts_in_order(
    client: TestClient,
) -> None:
    response = client.get("/schema")

    assert response.status_code == 200
    assert response.json() == {
        "description": [
            {
                "id": "what_it_does",
                "label": "What it does",
                "question": "What does the product do?",
                "max_length": 500,
            },
            {
                "id": "who_uses_it",
                "label": "Who uses it",
                "question": "Who uses the product? If it also talks to or makes decisions about other people, name them too. For example, a company uses a chatbot to answer its own customers.",
                "max_length": 500,
            },
            {
                "id": "data_it_handles",
                "label": "What data it handles",
                "question": "What data does the product handle?",
                "max_length": 500,
            },
        ],
        "slots": [
            {
                "id": "personal_data",
                "label": "Personal data",
                "question": "Does the product process personal data?",
                "values": YES_NO_NOT_SURE,
            },
            {
                "id": "under_own_name",
                "label": "Under own name or trademark",
                "question": "Do you place the product on the market or put it into service under your own name or trademark?",
                "values": YES_NO_NOT_SURE,
            },
            {
                "id": "use_case_area",
                "label": "Use-case area",
                "question": "Which of these areas is the product intended to be used in?",
                "values": [
                    {"id": "biometrics", "label": "Biometrics"},
                    {
                        "id": "critical_infrastructure",
                        "label": "Critical infrastructure",
                    },
                    {"id": "education", "label": "Education and vocational training"},
                    {
                        "id": "employment",
                        "label": "Employment, workers' management and access to self-employment",
                    },
                    {
                        "id": "essential_services",
                        "label": "Access to and enjoyment of essential private services and essential public services and benefits",
                    },
                    {"id": "law_enforcement", "label": "Law enforcement"},
                    {
                        "id": "migration",
                        "label": "Migration, asylum and border control management",
                    },
                    {
                        "id": "justice",
                        "label": "Administration of justice and democratic processes",
                    },
                    {"id": "none", "label": "None of these"},
                    {"id": "not_sure", "label": "Not sure"},
                ],
            },
        ],
    }


def test_post_intakes_returns_the_new_id_and_the_step_ready_to_confirm(
    client: TestClient,
) -> None:
    response = client.post(
        "/intakes", json={"answers": ANSWERS, "description": DESCRIPTION}
    )

    assert response.status_code == 201
    body = response.json()
    # 128 random bits, encoded as 22 URL-safe characters.
    assert re.fullmatch(r"[A-Za-z0-9_-]{22}", body["id"])
    assert body == {"id": body["id"], "step": {"type": "ready_to_confirm"}}


def test_each_intake_is_stored_under_its_own_id(
    client: TestClient, intakes: dict[str, Intake]
) -> None:
    body = {"answers": ANSWERS, "description": DESCRIPTION}

    first = client.post("/intakes", json=body).json()["id"]
    second = client.post("/intakes", json=body).json()["id"]

    assert first != second
    assert sorted(intakes) == sorted([first, second])


def test_post_intakes_accepts_a_description_field_of_exactly_500_characters(
    client: TestClient,
) -> None:
    # é is one character and two bytes in UTF-8: the limit counts characters.
    description = {**DESCRIPTION, "who_uses_it": "é" * 500}

    response = client.post(
        "/intakes", json={"answers": ANSWERS, "description": description}
    )

    assert response.status_code == 201


def test_post_intakes_refuses_a_slot_that_is_not_on_the_form(
    client: TestClient, intakes: dict[str, Intake]
) -> None:
    answers = {**ANSWERS, "uses_biometrics": "yes"}

    response = client.post(
        "/intakes", json={"answers": answers, "description": DESCRIPTION}
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "invalid_slot", "field": "uses_biometrics"}
    }
    assert intakes == {}


@pytest.mark.parametrize(
    ("answers", "description", "field"),
    [
        pytest.param(
            {**ANSWERS, "personal_data": "maybe"},
            DESCRIPTION,
            "personal_data",
            id="value not allowed",
        ),
        pytest.param(
            {**ANSWERS, "personal_data": "biometrics"},
            DESCRIPTION,
            "personal_data",
            id="value of another slot",
        ),
        pytest.param(
            {**ANSWERS, "personal_data": "Yes"},
            DESCRIPTION,
            "personal_data",
            id="value in another case",
        ),
        pytest.param(
            {**ANSWERS, "personal_data": "yes "},
            DESCRIPTION,
            "personal_data",
            id="value with a space",
        ),
        pytest.param(
            {"personal_data": "yes", "use_case_area": "none"},
            DESCRIPTION,
            "under_own_name",
            id="form slot without an answer",
        ),
        pytest.param(
            ANSWERS,
            {"what_it_does": "A chatbot.", "data_it_handles": "Orders."},
            "who_uses_it",
            id="description field missing",
        ),
        pytest.param(
            ANSWERS,
            {**DESCRIPTION, "who_uses_it": ""},
            "who_uses_it",
            id="description field empty",
        ),
        pytest.param(
            ANSWERS,
            {**DESCRIPTION, "who_uses_it": "  \n  "},
            "who_uses_it",
            id="description field only spaces",
        ),
        pytest.param(
            ANSWERS,
            {**DESCRIPTION, "who_uses_it": "a" * 501},
            "who_uses_it",
            id="description field of 501 characters",
        ),
        pytest.param(
            ANSWERS,
            {**DESCRIPTION, "purpose": "Answers questions."},
            "purpose",
            id="description field not in the schema",
        ),
        pytest.param(
            ANSWERS,
            "An assistant in an online shop.",
            "description",
            id="description as one text, as before issue #12",
        ),
    ],
)
def test_post_intakes_refuses_an_invalid_value_and_stores_nothing(
    client: TestClient,
    intakes: dict[str, Intake],
    answers: dict[str, str],
    description: dict[str, str] | str,
    field: str,
) -> None:
    response = client.post(
        "/intakes", json={"answers": answers, "description": description}
    )

    assert response.status_code == 422
    assert response.json() == {"error": {"code": "invalid_value", "field": field}}
    assert intakes == {}


@pytest.mark.parametrize(
    ("answers", "description", "error"),
    [
        pytest.param(
            {
                "personal_data": "maybe",
                "under_own_name": "no",
                "use_case_area": "none",
                "uses_biometrics": "yes",
            },
            {**DESCRIPTION, "who_uses_it": ""},
            {"code": "invalid_slot", "field": "uses_biometrics"},
            id="slots not on the form come first",
        ),
        pytest.param(
            # under_own_name has no answer; the request lists use_case_area first.
            {"use_case_area": "maybe", "personal_data": "maybe"},
            {**DESCRIPTION, "who_uses_it": ""},
            {"code": "invalid_value", "field": "personal_data"},
            id="form slots in schema order, before the description",
        ),
        pytest.param(
            ANSWERS,
            {"what_it_does": "", "purpose": "Answers questions."},
            {"code": "invalid_value", "field": "purpose"},
            id="description fields not in the schema, before the fields of the schema",
        ),
        pytest.param(
            # who_uses_it is missing; the request lists data_it_handles first.
            ANSWERS,
            {"data_it_handles": "", "what_it_does": "A chatbot."},
            {"code": "invalid_value", "field": "who_uses_it"},
            id="description fields in schema order",
        ),
    ],
)
def test_post_intakes_returns_the_first_of_several_problems(
    client: TestClient,
    intakes: dict[str, Intake],
    answers: dict[str, str],
    description: dict[str, str],
    error: dict[str, str],
) -> None:
    response = client.post(
        "/intakes", json={"answers": answers, "description": description}
    )

    assert response.status_code == 422
    assert response.json() == {"error": error}
    assert intakes == {}


def test_post_intakes_answers_a_body_that_is_not_json_in_the_stable_format(
    client: TestClient, intakes: dict[str, Intake]
) -> None:
    response = client.post(
        "/intakes", content=b"answers=yes", headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 422
    assert response.json() == {"error": {"code": "invalid_value"}}
    assert intakes == {}


def test_post_intakes_answers_a_body_of_the_wrong_shape_in_the_stable_format(
    client: TestClient, intakes: dict[str, Intake]
) -> None:
    response = client.post(
        "/intakes", json={"answers": ["yes"], "description": DESCRIPTION}
    )

    assert response.status_code == 422
    assert response.json() == {"error": {"code": "invalid_value", "field": "answers"}}
    assert intakes == {}


def test_get_intake_returns_the_answers_and_the_open_slots_in_schema_order(
    client: TestClient,
) -> None:
    answers = {
        "use_case_area": "not_sure",
        "under_own_name": "no",
        "personal_data": "not_sure",
    }
    description = dict(reversed(DESCRIPTION.items()))
    created = client.post(
        "/intakes", json={"answers": answers, "description": description}
    ).json()

    response = client.get(f"/intakes/{created['id']}")

    assert response.status_code == 200
    # A comparison of dicts ignores their order, so the order of the fields is checked apart.
    assert list(response.json()["description"]) == list(DESCRIPTION)
    assert response.json() == {
        "id": created["id"],
        "description": DESCRIPTION,
        "answers": {
            "personal_data": "not_sure",
            "under_own_name": "no",
            "use_case_area": "not_sure",
        },
        "open_slots": ["personal_data", "use_case_area"],
        "step": {"type": "ready_to_confirm"},
    }


def test_get_intake_with_an_id_that_is_not_stored_returns_not_found(
    client: TestClient,
) -> None:
    response = client.get("/intakes/kq2V8yZx0bP4mT7nLw3sAg")

    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found"}}
