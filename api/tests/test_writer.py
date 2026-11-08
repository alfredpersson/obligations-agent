"""Tests for the writer of the meaning and the action of each row: acceptance criteria 7, 8 and 11 to 14 of issue #41, and failure cases from its plan; and the texts for each confirmation of the answers, acceptance criterion 7 of issue #50, with the notes written on the screen of the answers; and each row's category in the user message with the meaning of the three categories in the prompt, acceptance criterion 4 of issue #52; and the rows of a planned change, written with its question and its answers as data in the user message, acceptance criteria 6 and 7 of issue #63. The model client sends each request to a fake transport, so no test calls the provider."""

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
from obligations_agent.intakes import (
    Intake,
    NotSure,
    Option,
    Planned,
    Question,
    Requested,
    Turn,
)
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
# Every answer "yes", and the area of employment: 37 rows.
ALL_YES = {
    "personal_data": "yes",
    "under_own_name": "yes",
    "use_case_area": "employment",
    "own_use": "yes",
    **{slot.id: "yes" for slot in SCHEMA.follow_up_slots},
}
ROWS = 37
# The rows whose obligation needs legal drafting (gates.yaml).
DRAFTING = {
    "controller:gdpr:art13(1)",
    "controller:gdpr:art14(1)",
    "processor:gdpr:art28(2)",
    "processor:gdpr:art28(3)",
    "high_risk_annex_iii:aia:art17(1)",
    "deployer:aia:art26(11)",
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
    assert client.post("/intakes/one/texts").json() == {"texts": None, "planned": {}}
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
            "category": "organisation",
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


# A row that needs another result while that result is conditional depends on what that result
# depends on: the deployer's rows of AI Act Article 26 need high-risk under Annex III, so they depend on
# whether the intended use is listed, and on Article 6(3) while the answer about profiling is "no"
# (issue #45, review of #60).
LISTED = "whether the product's intended use is one of the uses listed in AI Act Annex III, point 4"


@pytest.mark.parametrize(
    ("profiling", "depends"),
    [
        ("yes", [LISTED]),
        (
            "no",
            [LISTED, "whether one of the conditions of AI Act Article 6(3) applies"],
        ),
    ],
    ids=["profiling", "no_profiling"],
)
def test_a_row_that_needs_a_conditional_result_depends_on_what_that_result_depends_on(
    profiling: str, depends: list[str]
) -> None:
    requests: list[httpx2.Request] = []

    service(recording(requests), ended({**ALL_YES, "profiling": profiling})).post(
        "/intakes/one/texts"
    )

    rows = {row_of(request)["id"]: row_of(request) for request in requests}
    article_26 = rows["deployer:aia:art26(1)"]
    assert article_26["status"] == "conditional"
    assert article_26["depends_on"] == depends


# Each row reaches the writer with its category from gates.yaml (issue #52, RESP-1).
def test_each_row_reaches_the_writer_with_its_category() -> None:
    requests: list[httpx2.Request] = []

    service(recording(requests), ended()).post("/intakes/one/texts")

    categories = {f"{row.gate}:{row.unit}": row.category for row in GATES.obligations}
    sent = {row_of(request)["id"]: row_of(request)["category"] for request in requests}
    assert len(sent) == ROWS
    assert sent == {row_id: categories[row_id] for row_id in sent}
    assert set(sent.values()) == {"legal", "technical", "organisation"}


# The prompt gives the meaning of the three categories, in the words of issue #52, and asks for an
# action of the row's category; a legal row without legal drafting gets a legal assessment.
def test_the_prompt_gives_the_meaning_of_the_three_categories() -> None:
    for text in (
        "category (who carries out the action: legal, technical or organisation)",
        "Give a task of the row's category.",
        "legal: a task for a legal representative: a contract, a policy, a privacy notice or a legal assessment. When legal_drafting is false, the task is a legal assessment of this product.",
        "technical: a task for the people who build the product: a change to the product, its data, its infrastructure or what it shows its users, or a document about the system, such as its technical documentation.",
        "organisation: a task for the company: a procedure, a role, a training, a record or a registration.",
    ):
        assert text in PROMPT


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
            "own_use": "no",
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


# From the review of pull request #55: the texts depend on the reasons and the notes too.
@pytest.mark.parametrize(
    "changed",
    [
        pytest.param(
            {"reason": "unknown", "note": "Asked the client."}, id="another note"
        ),
        pytest.param(
            {"reason": "unclear", "note": "Depends on the contract."},
            id="another reason",
        ),
    ],
)
def test_another_reason_or_note_removes_the_texts_until_the_next_confirmation(
    changed: dict[str, str],
) -> None:
    requests: list[httpx2.Request] = []
    intake = ended(
        {**ALL_YES, "processes_for_customer": "not_sure"},
        {"processes_for_customer": NotSure.model_validate(NOTE)},
    )
    client = service(recording(requests), intake)
    client.post("/intakes/one/texts")

    response = client.put(
        "/intakes/one/answers/processes_for_customer",
        json={"value": "not_sure", "not_sure": changed},
    )

    assert response.json()["confirmed"] is False
    assert response.json()["texts"] is None
    assert client.post("/intakes/one/texts").json() == {
        "error": {"code": "not_confirmed"}
    }


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


# Issue #63: the rows of a planned change.

# A marker in the question of a planned change. It may reach the model only in the user message.
CHANGE_MARKER = "Tapir-3141"
NO_CHAT = {**ALL_YES, "interacts_with_people": "no"}
CHAT_QUESTION = f"What if we add a chat where candidates ask about their application? {CHANGE_MARKER}"


def with_chat(answers: dict[str, str] = NO_CHAT) -> Intake:
    """An intake with a planned change from a question about a chat for candidates."""
    return ended(answers).model_copy(
        update={
            "conversation": [
                Turn(
                    question=CHAT_QUESTION,
                    reason="answered",
                    text="One answer may change.",
                    changes=[Requested(fact="interacts_with_people", value="yes")],
                    label="Candidate chat",
                    answers=answers,
                )
            ],
            "planned": [
                Planned(
                    turn=1,
                    label="Candidate chat",
                    changes=[Requested(fact="interacts_with_people", value="yes")],
                )
            ],
        }
    )


def planned_rows(client: TestClient) -> list[str]:
    """The ids of the rows that the planned change of the intake "one" adds."""
    [planned] = client.get("/intakes/one").json()["planned"]
    return [row["id"] for item in planned["results"] for row in item["rows"]]


def test_the_rows_of_a_planned_change_are_written_with_its_question_and_its_answers_as_data() -> (
    None
):
    requests: list[httpx2.Request] = []
    client = service(recording(requests), with_chat())
    added = planned_rows(client)

    written = client.post("/intakes/one/texts").json()

    planned = [
        request for request in requests if "planned_change" in user_data(request)
    ]
    assert added
    assert sorted(row_of(request)["id"] for request in planned) == sorted(added)
    data = user_data(planned[0])
    assert data["planned_change"] == {
        "change": CHAT_QUESTION,
        "answers": ["Interacts with people: Yes"],
    }
    # The answers are those of the product with the change.
    assert {"fact": "Interacts with people", "answer": "Yes"} in data["answers"]
    # The rows of the result are written as before, without the planned change.
    assert len(requests) == len(row_ids(client)) + len(added)
    assert written["planned"] == {"1": {row_id: texts_of(row_id) for row_id in added}}
    assert (
        client.get("/intakes/one").json()["planned"][0]["texts"]
        == (written["planned"]["1"])
    )
    # A later request returns the stored texts and calls nothing.
    assert client.post("/intakes/one/texts").json() == written
    assert len(requests) == len(row_ids(client)) + len(added)


def test_the_question_of_a_planned_change_reaches_the_writer_only_in_the_user_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    requests: list[httpx2.Request] = []
    caplog.set_level(logging.INFO)

    service(recording(requests), with_chat()).post("/intakes/one/texts")

    for request in requests:
        sent = json.loads(request.content)
        assert CHANGE_MARKER not in json.dumps(sent["system"])
    assert any(CHANGE_MARKER in json.dumps(user_data(item)) for item in requests)
    assert CHANGE_MARKER not in caplog.text


def test_the_texts_of_a_planned_change_are_written_once_it_is_added_after_those_of_the_result() -> (
    None
):
    requests: list[httpx2.Request] = []
    intake = with_chat()
    intakes = {"one": intake.model_copy(update={"planned": []})}
    model = new_client().with_options(
        http_client=anthropic.DefaultHttpxClient(
            transport=httpx2.MockTransport(recording(requests))
        )
    )
    client = TestClient(create_app(SCHEMA, GUIDANCE, GATES, intakes, model))
    client.post("/intakes/one/texts")
    result_calls = len(requests)

    client.post(
        "/intakes/one/planned", json={"turn": 1, "facts": ["interacts_with_people"]}
    )
    assert client.get("/intakes/one").json()["planned"][0]["texts"] == {}
    written = client.post("/intakes/one/texts").json()

    added = planned_rows(client)
    assert len(requests) == result_calls + len(added)
    assert set(written["planned"]["1"]) == set(added)


def test_after_a_change_of_an_answer_the_texts_of_a_planned_change_are_written_again_for_the_new_answers() -> (
    None
):
    requests: list[httpx2.Request] = []
    client = service(recording(requests), with_chat())
    client.post("/intakes/one/texts")
    first = len(requests)

    changed = client.put(
        "/intakes/one/answers/processes_for_customer", json={"value": "no"}
    ).json()
    client.post("/intakes/one/confirm")

    assert changed["planned"] is None
    assert client.get("/intakes/one").json()["planned"][0]["texts"] == {}
    written = client.post("/intakes/one/texts").json()
    added = planned_rows(client)
    assert set(written["planned"]["1"]) == set(added)
    again = [
        request
        for request in requests[first:]
        if "planned_change" in user_data(request)
    ]
    assert sorted(row_of(request)["id"] for request in again) == sorted(added)
    assert {"fact": "Processes personal data for a customer", "answer": "No"} in (
        user_data(again[0])["answers"]
    )


def test_a_failed_call_leaves_only_its_row_of_a_planned_change_without_texts() -> None:
    failed = "transparency_interaction:aia:art50(5)"

    def reply(request: httpx2.Request) -> httpx2.Response:
        if "planned_change" in user_data(request) and row_of(request)["id"] == failed:
            return refused(request)
        return writes(request)

    client = service(recording([], reply), with_chat())

    written = client.post("/intakes/one/texts").json()["planned"]["1"]

    assert written[failed] is None
    assert all(
        texts is not None for row_id, texts in written.items() if row_id != failed
    )


def test_the_rows_of_a_planned_change_of_a_later_question_get_that_question() -> None:
    requests: list[httpx2.Request] = []
    intake = with_chat()
    earlier = Turn(
        question="Why is the high-risk result conditional?",
        reason="answered",
        answers=NO_CHAT,
    )
    later = intake.model_copy(
        update={
            "conversation": [earlier, *intake.conversation],
            "planned": [intake.planned[0].model_copy(update={"turn": 2})],
        }
    )

    service(recording(requests), later).post("/intakes/one/texts")

    planned = [
        request for request in requests if "planned_change" in user_data(request)
    ]
    assert planned
    assert {user_data(request)["planned_change"]["change"] for request in planned} == {
        CHAT_QUESTION
    }
