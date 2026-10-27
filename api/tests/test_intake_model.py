"""Tests for the follow-up questions that the model chooses and writes: acceptance criteria 1 to 6 of issues #20 and #22, and failure cases from their plans. The model client sends each request to a fake transport, so no test calls the provider."""

import importlib
import json
import logging
import threading
from collections.abc import Callable
from importlib.resources import files
from typing import Any

import anthropic
import httpx2
import pytest
import yaml
from fastapi.testclient import TestClient

from obligations_agent import server
from obligations_agent.intake_model import new_client
from obligations_agent.schema import Schema, load_schema, parse_schema
from obligations_agent.server import create_app

# A marker in the description. It may reach the model only in the user message, and never a log line.
MARKER = "Zebra-4711"
FORM = {
    "answers": {
        "personal_data": "yes",
        "under_own_name": "not_sure",
        "use_case_area": "none",
    },
    "description": {
        "what_it_does": f"Answers questions about orders in an online shop. {MARKER}",
        "who_uses_it": "The shop's support team. The shop's customers chat with it.",
        "data_it_handles": "Order numbers, and the names and email addresses of customers.",
    },
}
# The follow-up slots that FORM makes relevant, in schema order.
FOLLOW_UPS = [
    "decides_purposes",
    "processes_for_customer",
    "special_categories",
    "automated_decisions",
    "interacts_with_people",
]
KEY = "sk-ant-test-0123456789"

# A question text as the model writes it.
TEXT = "Does the shop decide what the order data is used for?"
# Options as the model writes them: in reverse schema order, with labels that are not in the schema.
WRITTEN = [
    {"value": "not_sure", "label": "I do not know"},
    {"value": "no", "label": "No, we do not"},
    {"value": "yes", "label": "Yes, we do"},
]
# The same options in schema order, as the step shows them.
SHOWN = [WRITTEN[2], WRITTEN[1], WRITTEN[0]]

SCHEMA = load_schema()
YES_NO_NOT_SURE = [
    {"value": "yes", "label": "Yes"},
    {"value": "no", "label": "No"},
    {"value": "not_sure", "label": "Not sure"},
]
# The first follow-up question for FORM, with its default text and the labels from the schema.
DEFAULT_STEP = {
    "type": "question",
    "number": 1,
    "slot": "decides_purposes",
    "text": "Do you decide, alone or together with others, what the personal data is used for and how it is processed?",
    "options": YES_NO_NOT_SURE,
}
READY_TO_CONFIRM = {"type": "ready_to_confirm"}

Handler = Callable[[httpx2.Request], httpx2.Response]


@pytest.fixture(autouse=True)
def key(monkeypatch: pytest.MonkeyPatch) -> None:
    # The model client reads the key from the environment, as in the service.
    monkeypatch.setenv("ANTHROPIC_API_KEY", KEY)


def message(content: list[dict[str, Any]], stop_reason: str) -> httpx2.Response:
    """A response of the Messages API with the given content blocks."""
    return httpx2.Response(
        200,
        json={
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-5-5",
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        },
    )


def ask(
    tool_input: dict[str, Any], stop_reason: str = "tool_use", name: str = "ask"
) -> httpx2.Response:
    """A response with one call of a tool, by default the tool ask."""
    block = {"type": "tool_use", "id": "toolu_test", "name": name, "input": tool_input}
    return message([block], stop_reason)


def user_data(request: httpx2.Request) -> dict[str, Any]:
    """The JSON data in the user message of a request to the model."""
    return json.loads(json.loads(request.content)["messages"][0]["content"])


def chosen(request: httpx2.Request) -> str:
    """The slot that the fake model asks about: the first fact in the user message without earlier questions, or else the first fact."""
    facts = user_data(request)["facts"]
    return next(
        (fact["id"] for fact in facts if not fact["earlier_questions"]),
        facts[0]["id"],
    )


def asks(request: httpx2.Request) -> httpx2.Response:
    """A model that writes a valid question about the slot it chooses."""
    return ask({"slot": chosen(request), "text": TEXT, "options": WRITTEN})


def asking(slot: str, text: str = TEXT) -> Handler:
    """A model that asks about the given slot, with the options in reverse schema order."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        return ask({"slot": slot, "text": text, "options": WRITTEN})

    return handler


def finish(request: httpx2.Request) -> httpx2.Response:
    """A model that calls the tool finish."""
    return ask({}, name="finish")


def service(handler: Handler, schema: Schema = SCHEMA) -> TestClient:
    """A client for the service, with a model client that sends each request to the handler."""
    transport = httpx2.MockTransport(handler)
    # with_options keeps the timeout and the retries of the service's client.
    model = new_client().with_options(
        http_client=anthropic.DefaultHttpxClient(transport=transport)
    )
    return TestClient(create_app(schema, {}, model))


def recording(requests: list[httpx2.Request]) -> Handler:
    """A model that writes a valid question and keeps each request."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return asks(request)

    return handler


def scripted(requests: list[httpx2.Request], *replies: Handler) -> Handler:
    """A model that keeps each request and answers the requests with the given handlers, in order."""
    remaining = iter(replies)

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return next(remaining)(request)

    return handler


def answer(client: TestClient, intake_id: str, number: int, value: str) -> Any:
    """Sends the answer to a question and returns the next step."""
    response = client.post(
        f"/intakes/{intake_id}/answers", json={"question": number, "value": value}
    )
    assert response.status_code == 200
    return response.json()["step"]


def camera_schema(*follow_ups: tuple[str, dict[str, list[str]]]) -> Schema:
    """A test schema with the form slot camera and the given follow-up slots with their conditions, all with the values yes, no and not sure."""

    def slot(slot_id: str, relevant: Any) -> dict[str, Any]:
        return {
            "id": slot_id,
            "label": slot_id,
            "question": f"Question {slot_id}?",
            "relevant": relevant,
            "unit": "aia:art50(3)",
            "values": [
                {"id": "yes", "label": "Yes"},
                {"id": "no", "label": "No"},
                {"id": "not_sure", "label": "Not sure"},
            ],
        }

    description = {
        "id": "purpose",
        "label": "Purpose",
        "question": "What is the product for?",
        "max_length": 100,
    }
    slots = [slot("camera", "always"), *(slot(*follow_up) for follow_up in follow_ups)]
    return parse_schema(yaml.safe_dump({"description": [description], "slots": slots}))


def camera_form(value: str) -> dict[str, Any]:
    """The body of POST /intakes for a camera schema."""
    return {
        "answers": {"camera": value},
        "description": {"purpose": "Counts visitors."},
    }


def test_the_step_shows_the_slot_the_text_and_the_labels_that_the_model_chooses_in_schema_order() -> (
    None
):
    special = "Does the shop's chat hold health data or other special categories of data about a person?"
    client = service(
        scripted(
            [],
            asking("special_categories", special),
            asking(
                "processes_for_customer",
                "Does the shop process the order data for a customer?",
            ),
        )
    )
    created = client.post("/intakes", json=FORM).json()
    # special_categories is not the first slot that may be asked about, in schema order.
    first = {
        "type": "question",
        "number": 1,
        "slot": "special_categories",
        "text": special,
        "options": SHOWN,
    }
    assert created["step"] == first
    # The question is stored with its slot and its text, so a reload shows the same question.
    assert client.get(f"/intakes/{created['id']}").json()["step"] == first

    step = answer(client, created["id"], 1, "no")

    assert step == {
        "type": "question",
        "number": 2,
        "slot": "processes_for_customer",
        "text": "Does the shop process the order data for a customer?",
        "options": SHOWN,
    }


def test_a_slot_on_the_form_answered_not_sure_can_be_asked_once_more(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    client = service(scripted([], asking("under_own_name"), asking("under_own_name")))
    created = client.post("/intakes", json=FORM).json()
    assert created["step"]["slot"] == "under_own_name"

    # The form's question was the first question about under_own_name, so a third one is refused.
    step = answer(client, created["id"], 1, "not_sure")

    assert step == {**DEFAULT_STEP, "number": 2}
    assert (
        "question 2 slot=decides_purposes model=claude-sonnet-5-5 prompt=2 written_by=default reason=limit_reached"
        in caplog.text
    )


def test_a_follow_up_slot_answered_not_sure_can_be_asked_a_second_time(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    second = "Do you decide why the customers' names and email addresses are used?"
    client = service(
        scripted(
            [],
            asking("decides_purposes"),
            asking("decides_purposes", second),
            asking("decides_purposes"),
        )
    )
    created = client.post("/intakes", json=FORM).json()

    step = answer(client, created["id"], 1, "not_sure")

    assert step == {
        "type": "question",
        "number": 2,
        "slot": "decides_purposes",
        "text": second,
        "options": SHOWN,
    }
    assert client.get(f"/intakes/{created['id']}").json()["step"] == step

    # Two questions about decides_purposes: a third one is refused.
    step = answer(client, created["id"], 2, "not_sure")

    assert step == {
        "type": "question",
        "number": 3,
        "slot": "processes_for_customer",
        "text": "Do you process personal data on behalf of a customer, following the customer's instructions?",
        "options": YES_NO_NOT_SURE,
    }
    assert "question 3 slot=processes_for_customer" in caplog.text
    assert "written_by=default reason=limit_reached" in caplog.text


def test_a_question_with_the_default_text_counts_toward_the_limit_of_its_slot(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    client = service(
        scripted(
            [],
            text_without_a_call,
            asking("decides_purposes"),
            asking("decides_purposes"),
        )
    )
    created = client.post("/intakes", json=FORM).json()
    assert created["step"] == DEFAULT_STEP
    step = answer(client, created["id"], 1, "not_sure")
    assert (step["number"], step["slot"]) == (2, "decides_purposes")

    step = answer(client, created["id"], 2, "not_sure")

    assert (step["number"], step["slot"]) == (3, "processes_for_customer")
    assert "written_by=default reason=limit_reached" in caplog.text


@pytest.mark.parametrize(
    "options",
    [
        pytest.param(WRITTEN[:2], id="a_value_left_out"),
        pytest.param(
            [*WRITTEN, {"value": "yes", "label": "Yes, always"}], id="a_value_twice"
        ),
        pytest.param(
            [*WRITTEN, {"value": "maybe", "label": "Maybe"}], id="an_unknown_value"
        ),
    ],
)
def test_options_that_do_not_link_each_allowed_value_once_give_the_default_question(
    options: list[dict[str, str]], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)

    def handler(request: httpx2.Request) -> httpx2.Response:
        return ask({"slot": "special_categories", "text": TEXT, "options": options})

    created = service(handler).post("/intakes", json=FORM).json()

    # The default question is about the first slot in the queue, not the slot that the model chose.
    assert created["step"] == DEFAULT_STEP
    assert "written_by=default reason=invalid_option" in caplog.text


def other_tool(request: httpx2.Request) -> httpx2.Response:
    """A model that calls a tool that the request does not offer."""
    tool_input = {"slot": "decides_purposes", "text": TEXT, "options": WRITTEN}
    return ask(tool_input, name="record")


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        pytest.param(asking("camera"), "invalid_slot", id="a_slot_that_does_not_exist"),
        pytest.param(asking("personal_data"), "not_askable", id="a_slot_answered_yes"),
        pytest.param(
            asking("profiling"), "not_askable", id="a_slot_that_is_not_relevant"
        ),
        pytest.param(finish, "invalid_output", id="finish_while_only_ask_is_offered"),
        pytest.param(other_tool, "invalid_output", id="a_tool_that_is_not_offered"),
    ],
)
def test_a_call_that_tool_1_refuses_gives_the_default_question(
    reply: Handler, reason: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)

    created = service(reply).post("/intakes", json=FORM).json()

    assert created["step"] == DEFAULT_STEP
    assert f"written_by=default reason={reason}" in caplog.text


def test_without_a_model_client_each_question_has_its_default_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)

    created = TestClient(create_app(SCHEMA, {})).post("/intakes", json=FORM).json()

    assert created["step"] == DEFAULT_STEP
    assert "written_by=default reason=no_key" in caplog.text


def test_without_the_key_the_service_asks_with_the_default_text(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    # The service creates its app when the module loads, so the module is loaded again without the key.
    importlib.reload(server)

    created = TestClient(server.app).post("/intakes", json=FORM).json()

    assert created["step"] == DEFAULT_STEP
    assert "written_by=default reason=no_key" in caplog.text


def test_without_a_model_client_no_slot_is_asked_a_second_time(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    client = TestClient(create_app(SCHEMA, {}))
    created = client.post("/intakes", json=FORM).json()

    steps = [
        answer(client, created["id"], number, "not_sure") for number in range(1, 6)
    ]

    assert steps[-1] == READY_TO_CONFIRM
    open_slots = client.get(f"/intakes/{created['id']}").json()["open_slots"]
    assert open_slots == ["under_own_name", *FOLLOW_UPS]
    assert (
        "end after 5 questions model=claude-sonnet-5-5 prompt=2 ended_by=code reason=no_key"
        in caplog.text
    )


def server_error(request: httpx2.Request) -> httpx2.Response:
    return httpx2.Response(
        500,
        json={
            "type": "error",
            "error": {"type": "api_error", "message": "Internal server error"},
        },
    )


def connection_error(request: httpx2.Request) -> httpx2.Response:
    raise httpx2.ConnectError("connection refused", request=request)


def refusal(request: httpx2.Request) -> httpx2.Response:
    return message([{"type": "text", "text": "I cannot help with that."}], "refusal")


def text_without_a_call(request: httpx2.Request) -> httpx2.Response:
    return message(
        [{"type": "text", "text": "Do you decide what the order data is used for?"}],
        "end_turn",
    )


def input_without_options(request: httpx2.Request) -> httpx2.Response:
    return ask({"slot": "decides_purposes", "text": TEXT})


def input_not_an_object(request: httpx2.Request) -> httpx2.Response:
    block = {"type": "tool_use", "id": "toolu_test", "name": "ask", "input": TEXT}
    return message([block], "tool_use")


def cut_off(request: httpx2.Request) -> httpx2.Response:
    return ask(
        {
            "slot": "decides_purposes",
            "text": "Does the shop decide",
            "options": WRITTEN,
        },
        stop_reason="max_tokens",
    )


def empty_text(request: httpx2.Request) -> httpx2.Response:
    return ask({"slot": "decides_purposes", "text": " ", "options": WRITTEN})


def empty_label(request: httpx2.Request) -> httpx2.Response:
    options = [{"value": "yes", "label": " "}, *WRITTEN[:2]]
    return ask({"slot": "decides_purposes", "text": TEXT, "options": options})


@pytest.mark.parametrize(
    ("handler", "reason"),
    [
        (server_error, "call_failed"),
        (connection_error, "call_failed"),
        (refusal, "invalid_output"),
        (text_without_a_call, "invalid_output"),
        (input_without_options, "invalid_output"),
        (input_not_an_object, "invalid_output"),
        (cut_off, "invalid_output"),
        (empty_text, "invalid_output"),
        (empty_label, "invalid_output"),
    ],
)
def test_a_call_that_gives_no_valid_question_gives_the_default_question(
    handler: Handler, reason: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)

    created = service(handler).post("/intakes", json=FORM).json()

    assert created["step"] == DEFAULT_STEP
    assert f"written_by=default reason={reason}" in caplog.text


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        pytest.param(asking("personal_data"), "not_askable", id="refused"),
        pytest.param(server_error, "call_failed", id="failed"),
    ],
)
def test_when_no_slot_is_queued_a_refused_or_failed_call_ends_the_intake(
    reply: Handler, reason: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    requests: list[httpx2.Request] = []
    # The five follow-up slots of FORM, then a call that is not valid while under_own_name is still "not sure".
    client = service(scripted(requests, *[asking(slot) for slot in FOLLOW_UPS], reply))
    created = client.post("/intakes", json=FORM).json()

    steps = [answer(client, created["id"], number, "no") for number in range(1, 6)]

    assert steps[-1] == READY_TO_CONFIRM
    assert len(requests) == 6
    assert client.get(f"/intakes/{created['id']}").json()["open_slots"] == [
        "under_own_name"
    ]
    assert (
        f"end after 5 questions model=claude-sonnet-5-5 prompt=2 ended_by=code reason={reason}"
        in caplog.text
    )


def test_a_timeout_gives_the_default_question_after_one_request_with_a_timeout_of_ten_seconds(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    timeouts: list[Any] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        timeouts.append(request.extensions["timeout"])
        raise httpx2.ReadTimeout("timed out", request=request)

    created = service(handler).post("/intakes", json=FORM).json()

    assert created["step"] == DEFAULT_STEP
    assert "written_by=default reason=timeout" in caplog.text
    # One request and no retries, because the user waits for the step.
    assert timeouts == [{"connect": 10.0, "read": 10.0, "write": 10.0, "pool": 10.0}]


def test_an_answer_that_makes_slots_no_longer_relevant_removes_their_answers() -> None:
    requests: list[httpx2.Request] = []
    answers = {
        "personal_data": "not_sure",
        "under_own_name": "no",
        "use_case_area": "none",
    }
    client = service(
        scripted(
            requests,
            asking("decides_purposes"),
            asking("processes_for_customer"),
            asking("personal_data"),
        )
    )
    created = client.post("/intakes", json={**FORM, "answers": answers}).json()
    answer(client, created["id"], 1, "yes")
    answer(client, created["id"], 2, "no")

    # The slots about personal data are relevant only while personal_data is "yes" or "not sure".
    step = answer(client, created["id"], 3, "no")

    assert step == READY_TO_CONFIRM
    intake = client.get(f"/intakes/{created['id']}").json()
    assert intake["answers"] == {**answers, "personal_data": "no"}
    assert intake["open_slots"] == []
    # No slot is left to ask about, so no request goes to the model after the answer.
    assert len(requests) == 3


def test_a_chain_of_conditions_is_followed_when_answers_are_removed() -> None:
    # a depends on camera, b on a, and c on b.
    schema = camera_schema(
        ("a", {"camera": ["yes", "not_sure"]}),
        ("b", {"a": ["yes"]}),
        ("c", {"b": ["yes"]}),
    )
    client = service(
        scripted([], asking("a"), asking("b"), asking("c"), asking("camera")), schema
    )
    created = client.post("/intakes", json=camera_form("not_sure")).json()
    for number in [1, 2, 3]:
        answer(client, created["id"], number, "yes")

    step = answer(client, created["id"], 4, "no")

    assert step == READY_TO_CONFIRM
    assert client.get(f"/intakes/{created['id']}").json()["answers"] == {"camera": "no"}


def test_a_second_answer_to_the_first_question_about_a_slot_changes_nothing() -> None:
    second = "Do you decide why the customers' names and email addresses are used?"
    client = service(
        scripted(
            [], asking("decides_purposes"), asking("decides_purposes", second), asks
        )
    )
    created = client.post("/intakes", json=FORM).json()
    waiting = answer(client, created["id"], 1, "not_sure")
    assert (waiting["number"], waiting["slot"]) == (2, "decides_purposes")

    # Question 1 already has an answer, also now that question 2 asks about the same slot.
    again = answer(client, created["id"], 1, "yes")

    assert again == waiting
    assert (
        client.get(f"/intakes/{created['id']}").json()["answers"]["decides_purposes"]
        == "not_sure"
    )
    # The answer to question 2 is checked against the options of question 2.
    refused = client.post(
        f"/intakes/{created['id']}/answers", json={"question": 2, "value": "maybe"}
    )
    assert refused.status_code == 422
    assert refused.json() == {"error": {"code": "invalid_value", "field": "value"}}
    answer(client, created["id"], 2, "yes")
    assert (
        client.get(f"/intakes/{created['id']}").json()["answers"]["decides_purposes"]
        == "yes"
    )


def test_the_request_offers_finish_only_when_every_relevant_slot_has_an_answer() -> (
    None
):
    requests: list[httpx2.Request] = []
    client = service(recording(requests))
    created = client.post("/intakes", json=FORM).json()

    for number in range(1, 6):
        answer(client, created["id"], number, "no")

    bodies = [json.loads(request.content) for request in requests]
    assert [[tool["name"] for tool in body["tools"]] for body in bodies] == [
        ["ask"],
        ["ask"],
        ["ask"],
        ["ask"],
        ["ask"],
        ["ask", "finish"],
    ]
    finish_tool = bodies[-1]["tools"][1]
    assert finish_tool["strict"] is True
    assert finish_tool["input_schema"]["properties"] == {}


def test_a_finish_call_ends_the_intake_with_the_slots_answered_not_sure_open(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    client = service(scripted([], *[asking(slot) for slot in FOLLOW_UPS], finish))
    created = client.post("/intakes", json=FORM).json()

    values = ["not_sure", "no", "no", "no", "no"]
    steps = [
        answer(client, created["id"], number, value)
        for number, value in enumerate(values, start=1)
    ]

    assert steps[-1] == READY_TO_CONFIRM
    assert client.get(f"/intakes/{created['id']}").json()["open_slots"] == [
        "under_own_name",
        "decides_purposes",
    ]
    assert (
        "end after 5 questions model=claude-sonnet-5-5 prompt=2 ended_by=model"
        in caplog.text
    )


def test_no_request_goes_to_the_model_after_eight_questions() -> None:
    schema = camera_schema(
        *[(f"q{number}", {"camera": ["yes"]}) for number in range(1, 10)]
    )
    requests: list[httpx2.Request] = []
    client = service(recording(requests), schema)
    created = client.post("/intakes", json=camera_form("yes")).json()

    steps = [answer(client, created["id"], number, "no") for number in range(1, 9)]

    assert steps[-1] == READY_TO_CONFIRM
    assert len(requests) == 8
    assert client.get(f"/intakes/{created['id']}").json()["open_slots"] == ["q9"]


def test_the_request_has_the_prompt_file_the_strict_tool_ask_and_the_description_only_in_the_user_message() -> (
    None
):
    requests: list[httpx2.Request] = []
    client = service(recording(requests))
    created = client.post("/intakes", json=FORM).json()
    client.post(
        f"/intakes/{created['id']}/answers", json={"question": 1, "value": "yes"}
    )

    first, second = [json.loads(request.content) for request in requests]
    assert first["model"] == "claude-sonnet-5-5"
    assert first["max_tokens"] == 2048
    prompt = (
        files("obligations_agent")
        .joinpath("intake_prompt.md")
        .read_text(encoding="utf-8")
    )
    assert first["system"] == prompt
    assert first["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}
    [tool] = first["tools"]
    assert tool["name"] == "ask"
    assert tool["strict"] is True
    assert MARKER not in json.dumps(
        {name: part for name, part in first.items() if name != "messages"}
    )
    [user] = first["messages"]
    assert user["role"] == "user"
    data = json.loads(user["content"])
    assert MARKER in data["description"]["What it does"]
    assert data["answers"][0] == {"fact": "Personal data", "answer": "Yes"}
    # The answers so far carry the labels from the schema, not the labels that the model wrote.
    answers = json.loads(second["messages"][0]["content"])["answers"]
    assert answers[-1] == {
        "fact": "Decides why and how personal data is processed",
        "answer": "Yes",
    }


def test_the_user_message_lists_each_askable_slot_with_its_earlier_questions_and_the_questions_left() -> (
    None
):
    requests: list[httpx2.Request] = []
    client = service(scripted(requests, asking("decides_purposes"), asks))
    created = client.post("/intakes", json=FORM).json()
    answer(client, created["id"], 1, "not_sure")

    first, second = [user_data(request) for request in requests]
    assert first["questions_left"] == 8
    assert [fact["id"] for fact in first["facts"]] == ["under_own_name", *FOLLOW_UPS]
    form_question = "Do you place the product on the market or put it into service under your own name or trademark?"
    assert first["facts"][0] == {
        "id": "under_own_name",
        "label": "Under own name or trademark",
        "default_question": form_question,
        "values": YES_NO_NOT_SURE,
        # The form's question is the first question about a slot on the form.
        "earlier_questions": [form_question],
        "questions_left": 1,
    }
    assert first["facts"][1]["earlier_questions"] == []
    assert first["facts"][1]["questions_left"] == 2
    assert second["questions_left"] == 7
    [decides] = [fact for fact in second["facts"] if fact["id"] == "decides_purposes"]
    assert decides["earlier_questions"] == [TEXT]
    assert decides["questions_left"] == 1


def test_a_repeated_answer_while_the_model_writes_the_next_question_calls_the_model_once() -> (
    None
):
    requests: list[httpx2.Request] = []
    called = threading.Event()
    release = threading.Event()

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        if len(requests) == 2:
            # Holds the call after the first answer, until the second copy of the answer is sent.
            called.set()
            release.wait(5)
        tool_input = {
            "slot": chosen(request),
            "text": f"Question {len(requests)}?",
            "options": WRITTEN,
        }
        return ask(tool_input)

    client = service(handler)
    created = client.post("/intakes", json=FORM).json()
    responses: list[tuple[int, Any]] = []

    def send() -> None:
        response = client.post(
            f"/intakes/{created['id']}/answers", json={"question": 1, "value": "yes"}
        )
        responses.append((response.status_code, response.json()))

    first = threading.Thread(target=send)
    first.start()
    assert called.wait(5)
    second = threading.Thread(target=send)
    second.start()
    second.join(0.3)
    # The second copy waits while the model writes the next question.
    assert second.is_alive()
    release.set()
    first.join(5)
    second.join(5)

    assert len(requests) == 2
    assert responses[0] == responses[1]
    assert responses[0][1]["step"]["text"] == "Question 2?"


def test_each_question_and_the_end_get_one_log_line_without_the_description_or_the_key(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    client = service(
        scripted(
            [],
            asking("decides_purposes"),
            text_without_a_call,
            asking("special_categories"),
            asking("automated_decisions"),
            asking("interacts_with_people"),
            finish,
        )
    )
    created = client.post("/intakes", json=FORM).json()

    for number in range(1, 6):
        answer(client, created["id"], number, "no")

    lines = [
        record.getMessage()
        for record in caplog.records
        if record.name == "obligations_agent.intake_model"
    ]
    assert lines == [
        "question 1 slot=decides_purposes model=claude-sonnet-5-5 prompt=2 written_by=model",
        "question 2 slot=processes_for_customer model=claude-sonnet-5-5 prompt=2 written_by=default reason=invalid_output",
        "question 3 slot=special_categories model=claude-sonnet-5-5 prompt=2 written_by=model",
        "question 4 slot=automated_decisions model=claude-sonnet-5-5 prompt=2 written_by=model",
        "question 5 slot=interacts_with_people model=claude-sonnet-5-5 prompt=2 written_by=model",
        "end after 5 questions model=claude-sonnet-5-5 prompt=2 ended_by=model",
    ]
    assert MARKER not in caplog.text
    assert KEY not in caplog.text


def test_no_request_goes_to_the_model_when_the_step_is_ready_to_confirm_or_an_answer_is_repeated() -> (
    None
):
    requests: list[httpx2.Request] = []
    client = service(recording(requests))
    # No follow-up slot is relevant for these answers.
    no_follow_ups = {
        "personal_data": "no",
        "under_own_name": "no",
        "use_case_area": "none",
    }
    created = client.post("/intakes", json={**FORM, "answers": no_follow_ups}).json()
    assert created["step"] == {"type": "ready_to_confirm"}
    assert requests == []

    created = client.post("/intakes", json=FORM).json()
    client.post(
        f"/intakes/{created['id']}/answers", json={"question": 1, "value": "yes"}
    )
    client.post(
        f"/intakes/{created['id']}/answers", json={"question": 1, "value": "yes"}
    )
    assert len(requests) == 2
    # FORM makes five follow-up slots relevant and leaves under_own_name "not sure": after the
    # fifth answer the model asks about under_own_name, and after that answer the step is "ready
    # to confirm".
    steps = [
        client.post(
            f"/intakes/{created['id']}/answers",
            json={"question": number, "value": "no"},
        ).json()["step"]
        for number in [2, 3, 4, 5, 6]
    ]
    assert steps[-1] == {"type": "ready_to_confirm"}
    assert len(requests) == 6
