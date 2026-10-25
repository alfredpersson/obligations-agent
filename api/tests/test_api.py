"""Tests for GET /schema, POST /intakes, GET /intakes/{id} and POST /intakes/{id}/answers: acceptance criteria 2 to 7 of issue #7, the three description fields of issue #12, and acceptance criteria 2 to 7 of issue #16."""

import re
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from obligations_agent.intakes import Intake
from obligations_agent.schema import load_schema, parse_schema
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
# Answers that make no follow-up slot relevant.
NO_FOLLOW_UPS = {
    "personal_data": "no",
    "under_own_name": "no",
    "use_case_area": "none",
}
DESCRIPTION = {
    "what_it_does": "Answers questions about orders in an online shop.",
    "who_uses_it": "The shop's support team. The shop's customers chat with it.",
    "data_it_handles": "Order numbers, and the names and email addresses of customers.",
}

# The follow-up facts of issue #16, as GET /schema returns them.
FOLLOW_UP_SLOTS = [
    {
        "id": "decides_purposes",
        "label": "Decides why and how personal data is processed",
        "question": "Do you decide, alone or together with others, what the personal data is used for and how it is processed?",
        "values": YES_NO_NOT_SURE,
    },
    {
        "id": "processes_for_customer",
        "label": "Processes personal data for a customer",
        "question": "Do you process personal data on behalf of a customer, following the customer's instructions?",
        "values": YES_NO_NOT_SURE,
    },
    {
        "id": "special_categories",
        "label": "Special categories of personal data",
        "question": "Does the product process data that shows a person's racial or ethnic origin, political opinions, religious or philosophical beliefs or trade union membership, or genetic data, biometric data used to identify a person, health data, or data about a person's sex life or sexual orientation?",
        "values": YES_NO_NOT_SURE,
    },
    {
        "id": "automated_decisions",
        "label": "Automated decisions about people",
        "question": "Does the product make decisions about people without a person taking part, where the decision has a legal effect on them or affects them in a similarly significant way, for example refusing a credit application or a job application?",
        "values": YES_NO_NOT_SURE,
    },
    {
        "id": "interacts_with_people",
        "label": "Interacts with people",
        "question": "Do people interact with the product directly, for example by chatting with it or talking to it?",
        "values": YES_NO_NOT_SURE,
    },
    {
        "id": "profiling",
        "label": "Profiling",
        "question": "Does the product use personal data to evaluate or predict things about individual people, such as their performance at work, economic situation, health, personal preferences, interests, reliability, behaviour, location or movements?",
        "values": YES_NO_NOT_SURE,
    },
]

OPTIONS = [
    {"value": "yes", "label": "Yes"},
    {"value": "no", "label": "No"},
    {"value": "not_sure", "label": "Not sure"},
]
FIRST_QUESTION = {
    "type": "question",
    "number": 1,
    "slot": "decides_purposes",
    "text": "Do you decide, alone or together with others, what the personal data is used for and how it is processed?",
    "options": OPTIONS,
}
READY_TO_CONFIRM = {"type": "ready_to_confirm"}

# Read once: the tests do not change the schema.
SCHEMA = load_schema()


@pytest.fixture
def intakes() -> dict[str, Intake]:
    return {}


@pytest.fixture
def client(intakes: dict[str, Intake]) -> TestClient:
    return TestClient(create_app(SCHEMA, intakes))


def follow_up(slot_id: str, relevant: dict[str, list[str]]) -> dict[str, Any]:
    """A follow-up slot of a test schema, with the values yes, no and not sure."""
    return {
        "id": slot_id,
        "label": slot_id,
        "question": f"Question {slot_id}?",
        "relevant": relevant,
        "unit": "aia:art50(3)",
        "values": YES_NO_NOT_SURE,
    }


def start_test_intake(
    *follow_ups: dict[str, Any],
) -> tuple[TestClient, dict[str, Any]]:
    """A client for a test schema with the form slot camera and the given follow-up slots, and the response of POST /intakes with camera answered yes."""
    description = {
        "id": "purpose",
        "label": "Purpose",
        "question": "What is the product for?",
        "max_length": 100,
    }
    camera = {
        "id": "camera",
        "label": "Camera",
        "question": "Does the product use a camera?",
        "relevant": "always",
        "unit": "aia:art50(3)",
        "values": YES_NO_NOT_SURE,
    }
    text = yaml.safe_dump(
        {"description": [description], "slots": [camera, *follow_ups]}
    )
    client = TestClient(create_app(parse_schema(text), {}))
    created = client.post(
        "/intakes",
        json={
            "answers": {"camera": "yes"},
            "description": {"purpose": "Counts visitors."},
        },
    ).json()
    return client, created


def answer_each_question(
    client: TestClient, created: dict[str, Any], values: dict[str, str]
) -> list[str]:
    """Answers each follow-up question of a new intake with the value given for its slot, or with no, until the step is "ready to confirm". Returns the slots asked, in order."""
    step = created["step"]
    asked: list[str] = []
    # The limit is eight questions, so the loop stops after nine.
    while step != READY_TO_CONFIRM and len(asked) <= 8:
        asked.append(step["slot"])
        response = client.post(
            f"/intakes/{created['id']}/answers",
            json={"question": step["number"], "value": values.get(step["slot"], "no")},
        )
        assert response.status_code == 200
        step = response.json()["step"]
    assert step == READY_TO_CONFIRM
    return asked


def test_get_schema_returns_the_description_fields_the_form_slots_and_the_follow_up_slots_in_order(
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
        "follow_up_slots": FOLLOW_UP_SLOTS,
    }


def test_post_intakes_returns_the_new_id_and_the_step_ready_to_confirm(
    client: TestClient,
) -> None:
    response = client.post(
        "/intakes", json={"answers": NO_FOLLOW_UPS, "description": DESCRIPTION}
    )

    assert response.status_code == 201
    body = response.json()
    # 128 random bits, encoded as 22 URL-safe characters.
    assert re.fullmatch(r"[A-Za-z0-9_-]{22}", body["id"])
    assert body == {"id": body["id"], "step": READY_TO_CONFIRM}


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
        # The follow-up slots after the first question are not asked yet, so they are not open.
        "open_slots": ["personal_data", "use_case_area"],
        "step": FIRST_QUESTION,
    }


def test_get_intake_with_an_id_that_is_not_stored_returns_not_found(
    client: TestClient,
) -> None:
    response = client.get("/intakes/kq2V8yZx0bP4mT7nLw3sAg")

    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found"}}


def post_intake(client: TestClient) -> str:
    """Creates an intake with the answers of the browser test and returns its id. Its first question is about decides_purposes."""
    response = client.post(
        "/intakes", json={"answers": ANSWERS, "description": DESCRIPTION}
    )
    return response.json()["id"]


def test_post_intakes_returns_the_first_follow_up_question(client: TestClient) -> None:
    response = client.post(
        "/intakes", json={"answers": ANSWERS, "description": DESCRIPTION}
    )

    assert response.status_code == 201
    assert response.json()["step"] == FIRST_QUESTION


def test_post_intakes_refuses_an_answer_for_a_follow_up_slot(
    client: TestClient, intakes: dict[str, Intake]
) -> None:
    answers = {**ANSWERS, "decides_purposes": "yes"}

    response = client.post(
        "/intakes", json={"answers": answers, "description": DESCRIPTION}
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "invalid_slot", "field": "decides_purposes"}
    }
    assert intakes == {}


@pytest.mark.parametrize(
    ("answers", "asked"),
    [
        pytest.param(NO_FOLLOW_UPS, [], id="no, no, none"),
        pytest.param(
            ANSWERS,
            [
                "decides_purposes",
                "processes_for_customer",
                "special_categories",
                "automated_decisions",
                "interacts_with_people",
            ],
            id="yes, not sure, none",
        ),
        pytest.param(
            {
                "personal_data": "not_sure",
                "under_own_name": "no",
                "use_case_area": "employment",
            },
            [
                "decides_purposes",
                "processes_for_customer",
                "special_categories",
                "automated_decisions",
                "profiling",
            ],
            id="not sure, no, employment",
        ),
        pytest.param(
            {
                "personal_data": "no",
                "under_own_name": "yes",
                "use_case_area": "not_sure",
            },
            ["interacts_with_people"],
            id="no, yes, not sure",
        ),
        pytest.param(
            {
                "personal_data": "no",
                "under_own_name": "no",
                "use_case_area": "employment",
            },
            [],
            id="no, no, employment",
        ),
        pytest.param(
            {
                "personal_data": "yes",
                "under_own_name": "yes",
                "use_case_area": "biometrics",
            },
            [
                "decides_purposes",
                "processes_for_customer",
                "special_categories",
                "automated_decisions",
                "interacts_with_people",
                "profiling",
            ],
            id="yes, yes, biometrics",
        ),
    ],
)
def test_the_form_answers_decide_which_follow_up_questions_are_asked(
    client: TestClient, answers: dict[str, str], asked: list[str]
) -> None:
    created = client.post(
        "/intakes", json={"answers": answers, "description": DESCRIPTION}
    ).json()

    assert answer_each_question(client, created, {}) == asked


def test_post_answer_records_the_value_and_returns_the_next_question(
    client: TestClient,
) -> None:
    intake_id = post_intake(client)

    response = client.post(
        f"/intakes/{intake_id}/answers", json={"question": 1, "value": "no"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "step": {
            "type": "question",
            "number": 2,
            "slot": "processes_for_customer",
            "text": "Do you process personal data on behalf of a customer, following the customer's instructions?",
            "options": OPTIONS,
        }
    }


def test_get_intake_returns_the_follow_up_answers_and_the_current_step(
    client: TestClient,
) -> None:
    intake_id = post_intake(client)
    answered = client.post(
        f"/intakes/{intake_id}/answers", json={"question": 1, "value": "no"}
    ).json()

    response = client.get(f"/intakes/{intake_id}")

    assert response.json()["answers"] == {**ANSWERS, "decides_purposes": "no"}
    assert response.json()["step"] == answered["step"]


@pytest.mark.parametrize(
    ("value_of_a", "asked"), [("yes", ["a", "b", "c"]), ("no", ["a", "c"])]
)
def test_an_answer_can_make_a_later_follow_up_slot_relevant(
    value_of_a: str, asked: list[str]
) -> None:
    # b depends on the answer to a, and comes before c in the schema.
    client, created = start_test_intake(
        follow_up("a", {"camera": ["yes"]}),
        follow_up("b", {"a": ["yes"]}),
        follow_up("c", {"camera": ["yes"]}),
    )

    assert answer_each_question(client, created, {"a": value_of_a}) == asked


def test_the_intake_ends_after_eight_follow_up_questions() -> None:
    client, created = start_test_intake(
        *[follow_up(f"q{number}", {"camera": ["yes"]}) for number in range(1, 10)]
    )

    asked = answer_each_question(client, created, {"q3": "not_sure"})

    assert asked == [f"q{number}" for number in range(1, 9)]
    intake = client.get(f"/intakes/{created['id']}").json()
    assert intake["step"] == READY_TO_CONFIRM
    # q3 was answered "not sure", and q9 is relevant but was not asked (INTAKE-3).
    assert intake["open_slots"] == ["q3", "q9"]


def test_repeated_answers_do_not_count_toward_the_limit() -> None:
    client, created = start_test_intake(
        *[follow_up(f"q{number}", {"camera": ["yes"]}) for number in range(1, 10)]
    )
    step = created["step"]

    for number in range(1, 9):
        assert step.get("number") == number
        body = {"question": number, "value": "no"}
        client.post(f"/intakes/{created['id']}/answers", json=body)
        step = client.post(f"/intakes/{created['id']}/answers", json=body).json()[
            "step"
        ]

    assert step == READY_TO_CONFIRM
    assert client.get(f"/intakes/{created['id']}").json()["open_slots"] == ["q9"]


@pytest.mark.parametrize(
    ("body", "field"),
    [
        pytest.param({"question": 0, "value": "no"}, "question", id="question 0"),
        pytest.param(
            {"question": 2, "value": "no"}, "question", id="a question not asked yet"
        ),
        pytest.param(
            {"question": 1, "value": "maybe"}, "value", id="value not an option"
        ),
        pytest.param(
            {"question": 1, "value": "Yes"}, "value", id="value in another case"
        ),
        pytest.param(
            {"question": 1, "value": "none"}, "value", id="value of another slot"
        ),
        pytest.param({"question": 1}, "value", id="value missing"),
    ],
)
def test_post_answer_refuses_an_answer_and_records_nothing(
    client: TestClient,
    intakes: dict[str, Intake],
    body: dict[str, Any],
    field: str,
) -> None:
    intake_id = post_intake(client)
    stored = intakes[intake_id].model_copy(deep=True)

    response = client.post(f"/intakes/{intake_id}/answers", json=body)

    assert response.status_code == 422
    assert response.json() == {"error": {"code": "invalid_value", "field": field}}
    assert intakes[intake_id] == stored


def test_a_value_that_is_not_an_option_is_refused_for_an_answered_question_too(
    client: TestClient, intakes: dict[str, Intake]
) -> None:
    intake_id = post_intake(client)
    client.post(f"/intakes/{intake_id}/answers", json={"question": 1, "value": "no"})
    stored = intakes[intake_id].model_copy(deep=True)

    response = client.post(
        f"/intakes/{intake_id}/answers", json={"question": 1, "value": "maybe"}
    )

    assert response.status_code == 422
    assert response.json() == {"error": {"code": "invalid_value", "field": "value"}}
    assert intakes[intake_id] == stored


def test_post_answer_with_an_id_that_is_not_stored_returns_not_found(
    client: TestClient,
) -> None:
    response = client.post(
        "/intakes/kq2V8yZx0bP4mT7nLw3sAg/answers", json={"question": 1, "value": "no"}
    )

    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found"}}


def test_the_same_answer_twice_is_recorded_once_and_gets_the_same_response(
    client: TestClient, intakes: dict[str, Intake]
) -> None:
    intake_id = post_intake(client)
    body = {"question": 1, "value": "no"}
    first = client.post(f"/intakes/{intake_id}/answers", json=body)
    stored = intakes[intake_id].model_copy(deep=True)

    second = client.post(f"/intakes/{intake_id}/answers", json=body)

    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    assert intakes[intake_id] == stored


def test_another_value_for_an_answered_question_records_nothing_and_returns_the_current_step(
    client: TestClient, intakes: dict[str, Intake]
) -> None:
    intake_id = post_intake(client)
    client.post(f"/intakes/{intake_id}/answers", json={"question": 1, "value": "no"})
    current = client.post(
        f"/intakes/{intake_id}/answers", json={"question": 2, "value": "no"}
    ).json()
    stored = intakes[intake_id].model_copy(deep=True)

    response = client.post(
        f"/intakes/{intake_id}/answers", json={"question": 1, "value": "yes"}
    )

    assert response.status_code == 200
    assert response.json() == current
    assert intakes[intake_id] == stored
