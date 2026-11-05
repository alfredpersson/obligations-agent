"""Tests for the writer of the meaning and the action of each row: acceptance criteria 7, 8 and 11 to 14 of issue #41, and failure cases from its plan; and the texts for each confirmation of the answers, acceptance criterion 7 of issue #50, with the notes written on the screen of the answers. The model client sends each request to a fake transport, so no test calls the provider."""

import json
import logging
import threading
from collections.abc import Callable
from typing import Any

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient

from obligations_agent.gates import load_gates
from obligations_agent.guidance import load_guidance
from obligations_agent.intake_model import new_client
from obligations_agent.intakes import Intake, NotSure, Option, Question
from obligations_agent.schema import load_schema
from obligations_agent.server import create_app
from obligations_agent.writer import PROMPT, PROMPT_VERSION

SCHEMA = load_schema()
GUIDANCE = load_guidance(SCHEMA)
GATES = load_gates(SCHEMA)
KEY = "sk-ant-test-0123456789"
# Markers in the description and in a note. They may reach the model only in the user message, and
# never a log line.
MARKER = "Zebra-4711"
NOTE_MARKER = "Quokka-0815"
DESCRIPTION = {
    "what_it_does": f"Ranks candidates for an open job. {MARKER}",
    "who_uses_it": "Recruiters at a recruitment agency use it.",
    "data_it_handles": "CVs and profiles of job seekers.",
}
# Every answer "yes", and the area of employment: 29 rows.
ALL_YES = {
    "personal_data": "yes",
    "under_own_name": "yes",
    "use_case_area": "employment",
    **{slot.id: "yes" for slot in SCHEMA.follow_up_slots},
}
ROWS = 29
# The rows whose obligation needs legal drafting (gates.yaml).
DRAFTING = {
    "controller:gdpr:art13(1)",
    "controller:gdpr:art14(1)",
    "processor:gdpr:art28(2)",
    "processor:gdpr:art28(3)",
    "high_risk_annex_iii:aia:art17(1)",
}
# The row whose call fails in the tests of a failure.
FAILED = "controller:gdpr:art6(1)"

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


def write(rows: list[dict[str, str]], name: str = "write") -> httpx2.Response:
    """A response with one call of a tool, by default the tool write."""
    block = {
        "type": "tool_use",
        "id": "toolu_test",
        "name": name,
        "input": {"rows": rows},
    }
    return message([block], "tool_use")


def user_data(request: httpx2.Request) -> dict[str, Any]:
    """The JSON data in the user message of a request to the model."""
    return json.loads(json.loads(request.content)["messages"][0]["content"])


def row_of(request: httpx2.Request) -> dict[str, Any]:
    """The one row of a request to the model."""
    rows = user_data(request)["rows"]
    assert len(rows) == 1
    return rows[0]


def texts_of(row_id: str) -> dict[str, str]:
    return {"meaning": f"What {row_id} means.", "action": f"What to do for {row_id}."}


def writes(request: httpx2.Request) -> httpx2.Response:
    """A model that writes the meaning and the action of the row of the request."""
    row_id = row_of(request)["id"]
    return write([{"id": row_id, **texts_of(row_id)}])


def recording(requests: list[httpx2.Request], reply: Handler = writes) -> Handler:
    """A model that answers with the reply and keeps each request. The calls come from several threads."""
    lock = threading.Lock()

    def handler(request: httpx2.Request) -> httpx2.Response:
        with lock:
            requests.append(request)
        return reply(request)

    return handler


def ended(
    answers: dict[str, str] = ALL_YES, not_sure: dict[str, NotSure] | None = None
) -> Intake:
    """An intake that has ended with these answers, confirmed: no question waits for its answer."""
    return Intake(
        answers=answers,
        description=DESCRIPTION,
        not_sure=not_sure or {},
        confirmed=True,
    )


def unconfirmed(answers: dict[str, str] = ALL_YES) -> Intake:
    """An intake that has ended with these answers, which the user has not confirmed yet."""
    return Intake(answers=answers, description=DESCRIPTION)


def service(handler: Handler | None, intake: Intake) -> TestClient:
    """A client for the service with one intake, "one", and a model client that sends each request to the handler, or no model client, as without the key."""
    model = None
    if handler is not None:
        # with_options keeps the timeout and the retries of the service's client.
        model = new_client().with_options(
            http_client=anthropic.DefaultHttpxClient(
                transport=httpx2.MockTransport(handler)
            )
        )
    return TestClient(create_app(SCHEMA, GUIDANCE, GATES, {"one": intake}, model))


def row_ids(client: TestClient) -> list[str]:
    """The ids of the rows of the result of the intake "one", in the order shown."""
    result = client.get("/intakes/one").json()["result"]
    return [row["id"] for gate in result["gates"] for row in gate["rows"]]


def test_the_result_shows_its_rows_before_the_texts_with_an_empty_map() -> None:
    client = service(recording([]), ended())

    intake = client.get("/intakes/one").json()

    assert intake["texts"] == {}
    assert len(row_ids(client)) == ROWS


def test_the_texts_are_written_by_one_call_for_each_row_and_stored_with_the_intake() -> (
    None
):
    requests: list[httpx2.Request] = []
    client = service(recording(requests), ended())

    texts = client.post("/intakes/one/texts").json()["texts"]

    ids = row_ids(client)
    assert sorted(row_of(request)["id"] for request in requests) == sorted(ids)
    assert texts == {row_id: texts_of(row_id) for row_id in ids}
    assert client.get("/intakes/one").json()["texts"] == texts


def test_a_later_request_returns_the_stored_texts_and_calls_nothing() -> None:
    requests: list[httpx2.Request] = []
    client = service(recording(requests), ended())

    first = client.post("/intakes/one/texts").json()
    second = client.post("/intakes/one/texts").json()

    assert second == first
    assert len(requests) == ROWS


def test_a_second_request_while_the_texts_are_written_waits_and_writes_nothing() -> (
    None
):
    requests: list[httpx2.Request] = []
    called = threading.Event()
    release = threading.Event()

    def held(request: httpx2.Request) -> httpx2.Response:
        # Holds the calls of the first request until the second request is sent.
        called.set()
        release.wait(5)
        return writes(request)

    client = service(recording(requests, held), ended())
    responses: list[tuple[int, Any]] = []

    def send() -> None:
        response = client.post("/intakes/one/texts")
        responses.append((response.status_code, response.json()))

    first = threading.Thread(target=send)
    first.start()
    assert called.wait(5)
    second = threading.Thread(target=send)
    second.start()
    second.join(0.3)
    # The second request waits while the texts are written.
    assert second.is_alive()
    release.set()
    first.join(5)
    second.join(5)

    assert len(requests) == ROWS
    assert responses[0] == responses[1]


def test_without_the_key_the_rows_have_no_texts_and_no_placeholder() -> None:
    client = service(None, ended())

    assert client.get("/intakes/one").json()["texts"] is None
    assert client.post("/intakes/one/texts").json() == {"texts": None}
    assert len(row_ids(client)) == ROWS


def failing(reply: Handler) -> Handler:
    """A model that answers the request of the row FAILED with the reply, and writes every other row."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        return reply(request) if row_of(request)["id"] == FAILED else writes(request)

    return handler


def refused(request: httpx2.Request) -> httpx2.Response:
    return httpx2.Response(
        500, json={"type": "error", "error": {"type": "api_error", "message": "Error"}}
    )


def timing_out(request: httpx2.Request) -> httpx2.Response:
    raise httpx2.ReadTimeout("timed out", request=request)


def no_tool(request: httpx2.Request) -> httpx2.Response:
    return message([{"type": "text", "text": "The meaning is clear."}], "end_turn")


def other_tool(request: httpx2.Request) -> httpx2.Response:
    return write([{"id": FAILED, **texts_of(FAILED)}], name="ask")


def other_row(request: httpx2.Request) -> httpx2.Response:
    return write([{"id": "controller:gdpr:art12(2)", **texts_of(FAILED)}])


def blank_meaning(request: httpx2.Request) -> httpx2.Response:
    return write([{"id": FAILED, "meaning": " ", "action": "Write the record."}])


def blank_action(request: httpx2.Request) -> httpx2.Response:
    return write([{"id": FAILED, "meaning": "It means a record.", "action": ""}])


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        pytest.param(refused, "call_failed error=InternalServerError", id="status_500"),
        pytest.param(timing_out, "timeout", id="timeout"),
        pytest.param(no_tool, "invalid_output", id="no_tool_call"),
        pytest.param(other_tool, "invalid_output", id="another_tool"),
        pytest.param(other_row, "invalid_output", id="another_row"),
        pytest.param(blank_meaning, "invalid_output", id="blank_meaning"),
        pytest.param(blank_action, "invalid_output", id="blank_action"),
    ],
)
def test_a_call_that_fails_or_gives_no_valid_texts_leaves_only_its_row_without_them(
    reply: Handler, reason: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    client = service(failing(reply), ended())

    texts = client.post("/intakes/one/texts").json()["texts"]

    assert [row_id for row_id, text in texts.items() if text is None] == [FAILED]
    assert len(texts) == ROWS
    assert f"texts row={FAILED} " in caplog.text
    assert f"written_by={reason}" in caplog.text
    # The row stays without its texts on a later read.
    assert client.get("/intakes/one").json()["texts"][FAILED] is None


def test_the_users_text_reaches_the_model_only_in_the_user_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    requests: list[httpx2.Request] = []
    note = NotSure(reason="unknown", note=f"Depends on the contract. {NOTE_MARKER}")
    intake = ended(
        {**ALL_YES, "processes_for_customer": "not_sure"},
        {"processes_for_customer": note},
    )

    service(recording(requests), intake).post("/intakes/one/texts")

    assert requests
    for request in requests:
        body = json.loads(request.content)
        assert MARKER not in body["system"] and NOTE_MARKER not in body["system"]
        assert MARKER in body["messages"][0]["content"]
        assert NOTE_MARKER in body["messages"][0]["content"]
    assert MARKER not in caplog.text and NOTE_MARKER not in caplog.text


def test_the_user_message_holds_the_description_the_answers_the_notes_and_the_row() -> (
    None
):
    requests: list[httpx2.Request] = []
    note = NotSure(reason="unknown", note="Depends on the contract.")
    intake = ended({**ALL_YES, "personal_data": "not_sure"}, {"personal_data": note})

    service(recording(requests), intake).post("/intakes/one/texts")

    data = {row_of(request)["id"]: user_data(request) for request in requests}
    risk = data["high_risk_annex_iii:aia:art9(1)"]
    assert risk["description"] == {
        "What it does": DESCRIPTION["what_it_does"],
        "Who uses it": DESCRIPTION["who_uses_it"],
        "What data it handles": DESCRIPTION["data_it_handles"],
    }
    assert {"fact": "Personal data", "answer": "Not sure"} in risk["answers"]
    assert risk["notes"] == [
        {
            "fact": "Personal data",
            "reason": "I don't know this about the product",
            "note": "Depends on the contract.",
        }
    ]
    assert risk["rows"] == [
        {
            "id": "high_risk_annex_iii:aia:art9(1)",
            "result": "High-risk under Annex III",
            "label": "A risk management system",
            "citation": "AI Act Article 9(1)",
            "quote": "A risk management system shall be established, implemented, documented and maintained in relation to high-risk AI systems.",
            "status": "conditional",
            "depends_on": [
                "whether the product's intended use is one of the uses listed in AI Act Annex III, point 4"
            ],
            "legal_drafting": False,
        }
    ]
    # A row under the GDPR depends on the open answer about personal data.
    controller = data["controller:gdpr:art6(1)"]["rows"][0]
    assert controller["status"] == "conditional"
    assert controller["depends_on"] == ["the open answer about Personal data"]
    assert {
        row_id for row_id, item in data.items() if item["rows"][0]["legal_drafting"]
    } == DRAFTING


def test_each_request_names_the_model_the_prompt_and_the_tool_write() -> None:
    requests: list[httpx2.Request] = []

    service(recording(requests), ended()).post("/intakes/one/texts")

    body = json.loads(requests[0].content)
    assert body["model"] == "claude-sonnet-5-5"
    assert body["system"] == PROMPT
    assert PROMPT.startswith(f"Version: {PROMPT_VERSION}\n")
    # The model refuses a forced tool choice, so the prompt asks for the call.
    assert body["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}
    assert [(tool["name"], tool["strict"]) for tool in body["tools"]] == [
        ("write", True)
    ]
    assert body["output_config"] == {"effort": "medium"}
    assert body["max_tokens"] == 1024


def test_the_texts_of_an_intake_whose_question_waits_or_that_does_not_exist_are_refused() -> (
    None
):
    question = Question(
        slot="decides_purposes",
        text="Do you decide what the data is used for?",
        options=[Option(value="yes", label="Yes"), Option(value="no", label="No")],
    )
    waiting = Intake(
        answers={
            "personal_data": "yes",
            "under_own_name": "yes",
            "use_case_area": "none",
        },
        description=DESCRIPTION,
        questions=[question],
    )
    requests: list[httpx2.Request] = []
    client = service(recording(requests), waiting)

    response = client.post("/intakes/one/texts")
    # An intake whose question waits has no confirmed answers.
    assert response.status_code == 409
    assert response.json() == {"error": {"code": "not_confirmed"}}
    assert client.post("/intakes/two/texts").status_code == 404
    assert requests == []


def test_each_row_gets_a_log_line_and_the_intake_one_with_the_count(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)

    service(recording([]), ended()).post("/intakes/one/texts")

    assert caplog.text.count("texts row=") == ROWS
    assert caplog.text.count("written_by=model") == ROWS
    assert f"texts rows={ROWS} written={ROWS} seconds=" in caplog.text


# The texts and the confirmation of the answers (issue #50).


def test_no_texts_are_written_before_the_answers_are_confirmed() -> None:
    requests: list[httpx2.Request] = []
    client = service(recording(requests), unconfirmed())

    response = client.post("/intakes/one/texts")

    assert response.status_code == 409
    assert response.json() == {"error": {"code": "not_confirmed"}}
    intake = client.get("/intakes/one").json()
    assert intake["result"] is None
    assert intake["texts"] is None
    assert requests == []


def test_after_a_change_the_texts_are_gone_and_the_next_confirmation_writes_them_once_for_the_rows_of_the_new_result() -> (
    None
):
    requests: list[httpx2.Request] = []
    client = service(recording(requests), unconfirmed())
    assert client.post("/intakes/one/confirm").status_code == 200
    client.post("/intakes/one/texts")
    assert len(requests) == ROWS

    changed = client.put(
        "/intakes/one/answers/processes_for_customer", json={"value": "no"}
    ).json()

    assert changed["confirmed"] is False
    assert changed["result"] is None
    assert changed["texts"] is None
    assert client.post("/intakes/one/texts").json() == {
        "error": {"code": "not_confirmed"}
    }
    client.post("/intakes/one/confirm")
    assert client.get("/intakes/one").json()["texts"] == {}
    texts = client.post("/intakes/one/texts").json()["texts"]
    # The processor does not apply now, so its rows are gone, and each other row is written again,
    # once, also for a second request.
    rows = row_ids(client)
    assert not any(row.startswith("processor:") for row in rows)
    assert set(texts) == set(rows)
    assert len(requests) == ROWS + len(rows)
    assert client.post("/intakes/one/texts").json()["texts"] == texts
    assert len(requests) == ROWS + len(rows)


NOTE = {"reason": "unknown", "note": "Depends on the contract."}


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        pytest.param("POST", "/intakes/one/confirm", None, id="a second confirmation"),
        pytest.param(
            "PUT",
            "/intakes/one/answers/personal_data",
            {"value": "yes"},
            id="the same answer",
        ),
        pytest.param(
            "PUT",
            "/intakes/one/answers/processes_for_customer",
            {"value": "not_sure", "not_sure": NOTE},
            id="the same reason and note",
        ),
    ],
)
def test_a_second_confirmation_and_a_request_that_alters_nothing_keep_the_texts_and_call_nothing(
    method: str, path: str, body: dict[str, Any] | None
) -> None:
    requests: list[httpx2.Request] = []
    intake = ended(
        {**ALL_YES, "processes_for_customer": "not_sure"},
        {"processes_for_customer": NotSure.model_validate(NOTE)},
    )
    client = service(recording(requests), intake)
    texts = client.post("/intakes/one/texts").json()["texts"]
    calls = len(requests)

    response = client.request(method, path, json=body)

    assert response.status_code == 200
    assert response.json()["confirmed"] is True
    assert response.json()["texts"] == texts
    assert client.post("/intakes/one/texts").json()["texts"] == texts
    assert len(requests) == calls


def test_a_note_written_on_the_screen_of_the_answers_reaches_the_writer_only_in_the_user_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    requests: list[httpx2.Request] = []
    client = service(recording(requests), unconfirmed())
    note = f"Depends on the contract. {NOTE_MARKER}"
    client.put(
        "/intakes/one/answers/processes_for_customer",
        json={"value": "not_sure", "not_sure": {"reason": "unknown", "note": note}},
    )
    client.post("/intakes/one/confirm")

    client.post("/intakes/one/texts")

    assert requests
    for request in requests:
        assert NOTE_MARKER not in json.loads(request.content)["system"]
        assert {
            "fact": "Processes personal data for a customer",
            "reason": "I don't know this about the product",
            "note": note,
        } in user_data(request)["notes"]
    assert NOTE_MARKER not in caplog.text


def test_the_screen_of_the_answers_and_the_confirmation_call_no_model() -> None:
    requests: list[httpx2.Request] = []
    client = service(recording(requests), unconfirmed())

    # Profiling stops being relevant, becomes relevant again without an answer, and is answered.
    for slot_id, value in [
        ("use_case_area", "none"),
        ("use_case_area", "employment"),
        ("profiling", "no"),
    ]:
        response = client.put(f"/intakes/one/answers/{slot_id}", json={"value": value})
        assert response.status_code == 200
    assert client.post("/intakes/one/confirm").status_code == 200

    assert requests == []
