"""Tests for the follow-up questions that the model writes: acceptance criteria 1 to 6 of issue #20 and failure cases from its plan. The model client sends each request to a fake transport, so no test calls the provider."""

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
from fastapi.testclient import TestClient

from obligations_agent import server
from obligations_agent.intake_model import new_client
from obligations_agent.schema import load_schema
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


def ask(tool_input: dict[str, Any], stop_reason: str = "tool_use") -> httpx2.Response:
    """A response with one call of the tool ask."""
    block = {"type": "tool_use", "id": "toolu_test", "name": "ask", "input": tool_input}
    return message([block], stop_reason)


def asks(request: httpx2.Request) -> httpx2.Response:
    """A model that writes a valid question."""
    return ask({"text": TEXT, "options": WRITTEN})


def service(handler: Handler) -> TestClient:
    """A client for the service, with a model client that sends each request to the handler."""
    transport = httpx2.MockTransport(handler)
    # with_options keeps the timeout and the retries of the service's client.
    model = new_client().with_options(
        http_client=anthropic.DefaultHttpxClient(transport=transport)
    )
    return TestClient(create_app(SCHEMA, {}, model))


def recording(requests: list[httpx2.Request]) -> Handler:
    """A model that writes a valid question and keeps each request."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return asks(request)

    return handler


def test_the_step_shows_the_text_and_the_labels_that_the_model_writes_in_schema_order() -> (
    None
):
    texts = iter([TEXT, "Does the shop process the order data for a customer?"])

    def handler(request: httpx2.Request) -> httpx2.Response:
        return ask({"text": next(texts), "options": WRITTEN})

    client = service(handler)
    created = client.post("/intakes", json=FORM).json()
    first = {**DEFAULT_STEP, "text": TEXT, "options": SHOWN}
    assert created["step"] == first
    # The question is stored with its text, so a reload shows the same question.
    assert client.get(f"/intakes/{created['id']}").json()["step"] == first

    response = client.post(
        f"/intakes/{created['id']}/answers", json={"question": 1, "value": "yes"}
    )

    assert response.json()["step"] == {
        "type": "question",
        "number": 2,
        "slot": "processes_for_customer",
        "text": "Does the shop process the order data for a customer?",
        "options": SHOWN,
    }


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
        return ask({"text": TEXT, "options": options})

    created = service(handler).post("/intakes", json=FORM).json()

    assert created["step"] == DEFAULT_STEP
    assert "written_by=default reason=invalid_option" in caplog.text


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
    return ask({"text": TEXT})


def input_not_an_object(request: httpx2.Request) -> httpx2.Response:
    block = {"type": "tool_use", "id": "toolu_test", "name": "ask", "input": TEXT}
    return message([block], "tool_use")


def cut_off(request: httpx2.Request) -> httpx2.Response:
    return ask(
        {"text": "Does the shop decide", "options": WRITTEN}, stop_reason="max_tokens"
    )


def empty_text(request: httpx2.Request) -> httpx2.Response:
    return ask({"text": " ", "options": WRITTEN})


def empty_label(request: httpx2.Request) -> httpx2.Response:
    options = [{"value": "yes", "label": " "}, *WRITTEN[:2]]
    return ask({"text": TEXT, "options": options})


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
    prompt = (
        files("obligations_agent")
        .joinpath("intake_prompt.md")
        .read_text(encoding="utf-8")
    )
    assert first["system"] == prompt
    assert first["tool_choice"] == {"type": "auto"}
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
    assert data["fact_to_ask_about"]["default_question"] == DEFAULT_STEP["text"]
    # The answers so far carry the labels from the schema, not the labels that the model wrote.
    answers = json.loads(second["messages"][0]["content"])["answers"]
    assert answers[-1] == {
        "fact": "Decides why and how personal data is processed",
        "answer": "Yes",
    }


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
        return ask({"text": f"Question {len(requests)}?", "options": WRITTEN})

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


def test_each_question_gets_one_log_line_without_the_description_or_the_key(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    client = service(asks)
    created = client.post("/intakes", json=FORM).json()
    client.post(
        f"/intakes/{created['id']}/answers", json={"question": 1, "value": "yes"}
    )

    lines = [
        record.getMessage()
        for record in caplog.records
        if record.name == "obligations_agent.intake_model"
    ]
    assert lines == [
        "question 1 slot=decides_purposes model=claude-sonnet-5-5 prompt=1 written_by=model",
        "question 2 slot=processes_for_customer model=claude-sonnet-5-5 prompt=1 written_by=model",
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
    # FORM makes five follow-up slots relevant: after the fifth answer, the step is "ready to confirm".
    steps = [
        client.post(
            f"/intakes/{created['id']}/answers",
            json={"question": number, "value": "no"},
        ).json()["step"]
        for number in [2, 3, 4, 5]
    ]
    assert steps[-1] == {"type": "ready_to_confirm"}
    assert len(requests) == 5
