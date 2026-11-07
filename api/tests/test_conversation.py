"""Tests for the conversation about the result of an intake: the tools that read the stored copies, the guidance and the changes of answers, the check of each quote, the link of each citation, the data that the model receives, the loop with its limits, and each turn as the service shows it (issue #44: QA-3 to QA-9, TOOL-2 to TOOL-6, INTAKE-4, MEMO-7, MEMO-8). The model client sends each request to a fake transport, so no test calls the provider."""

import json
import logging
from collections.abc import Callable
from typing import Any

import anthropic
import httpx2
import pytest

from obligations_agent import conversation
from obligations_agent.conversation import (
    PROMPT,
    PROMPT_VERSION,
    REMINDER,
    TOOL_LIMIT,
    TOOLS,
    ask,
    blocks,
    check_quote,
    read_article,
    read_contents,
    read_guidance,
    user_data,
    view_turn,
)
from obligations_agent.gates import EUR_LEX, Unit, decide, link, load_gates, what_if
from obligations_agent.guidance import load_guidance
from obligations_agent.intake_model import new_client
from obligations_agent.intakes import (
    Example,
    Intake,
    NotSure,
    Quoted,
    Requested,
    Text,
    Turn,
    last_questions,
)
from obligations_agent.regulations import contents, load_copies
from obligations_agent.schema import load_schema

SCHEMA = load_schema()
GUIDANCE = load_guidance(SCHEMA)
GATES = load_gates(SCHEMA)
KEY = "sk-ant-test-0123456789"
# Markers in the description, in a note and in a question. They may reach the model only in user
# messages, and never a log line.
MARKER = "Zebra-4711"
NOTE_MARKER = "Quokka-0815"
QUESTION_MARKER = "Okapi-2207"
DESCRIPTION = {
    "what_it_does": f"Ranks candidates for open jobs. {MARKER}",
    "who_uses_it": "Recruiters at our agency use it.",
    "data_it_handles": "CVs and profiles of job seekers.",
}
ANSWERS = {
    "personal_data": "yes",
    "under_own_name": "yes",
    "use_case_area": "employment",
    "own_use": "yes",
    "decides_purposes": "yes",
    "processes_for_customer": "no",
    "special_categories": "no",
    "automated_decisions": "not_sure",
    "interacts_with_people": "no",
    "generates_content": "no",
    "profiling": "yes",
}
NOTE = NotSure(reason="unknown", note=f"A recruiter reads each ranking. {NOTE_MARKER}")
MEANING = Text(meaning="You need a legal basis.", action="Write down the legal basis.")
INTAKE = Intake(
    answers=ANSWERS,
    description=DESCRIPTION,
    not_sure={"automated_decisions": NOTE},
    confirmed=True,
    texts={"controller:gdpr:art6(1)": MEANING},
)
RESULT = decide(GATES, SCHEMA, INTAKE)
QUESTION = f"What if we add a chat for candidates? {QUESTION_MARKER}"
COPIES = load_copies()
# A passage of GDPR Article 21(1).
OBJECT = "The data subject shall have the right to object, on grounds relating to his or her particular situation"
ENTRY = "own_name_or_trademark"

Handler = Callable[[httpx2.Request], httpx2.Response]
Reply = httpx2.Response | Handler


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


def call(name: str, tool_input: dict[str, Any]) -> httpx2.Response:
    """A response with one call of a tool."""
    block = {"type": "tool_use", "id": "toolu_test", "name": name, "input": tool_input}
    return message([block], "tool_use")


def answer(
    text: str = "The answer [GDPR Article 21(1)].",
    quotes: list[dict[str, str]] | None = None,
    guidance: list[str] | None = None,
    changes: list[dict[str, str]] | None = None,
) -> httpx2.Response:
    """A response with a call of the tool answer."""
    return call(
        "answer",
        {
            "text": text,
            "quotes": quotes or [],
            "guidance": guidance or [],
            "changes": changes or [],
        },
    )


def plain(text: str = "The result applies.") -> httpx2.Response:
    """A response with text and no tool call."""
    return message([{"type": "text", "text": text}], "end_turn")


def refused(request: httpx2.Request) -> httpx2.Response:
    return httpx2.Response(
        500, json={"type": "error", "error": {"type": "api_error", "message": "Error"}}
    )


def timing_out(request: httpx2.Request) -> httpx2.Response:
    raise httpx2.ReadTimeout("timed out", request=request)


def scripted(requests: list[httpx2.Request], *replies: Reply) -> Handler:
    """A model that keeps each request and answers the requests with the given replies, in order."""
    remaining = iter(replies)

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        reply = next(remaining)
        return reply if isinstance(reply, httpx2.Response) else reply(request)

    return handler


def client_for(handler: Handler) -> anthropic.Anthropic:
    # with_options keeps the timeout and the retries of the service's client.
    return new_client().with_options(
        http_client=anthropic.DefaultHttpxClient(
            transport=httpx2.MockTransport(handler)
        )
    )


def asked(
    *replies: Reply, intake: Intake = INTAKE, question: str = QUESTION
) -> tuple[Turn, list[httpx2.Request]]:
    """The turn of one question that the model answers with the replies, and the requests."""
    requests: list[httpx2.Request] = []
    turn = ask(
        client_for(scripted(requests, *replies)),
        SCHEMA,
        GUIDANCE,
        GATES,
        intake,
        question,
    )
    return turn, requests


def body(request: httpx2.Request) -> dict[str, Any]:
    return json.loads(request.content)


def first_data(request: httpx2.Request) -> dict[str, Any]:
    """The JSON data in the first user message of a request to the model."""
    return json.loads(body(request)["messages"][0]["content"])


def tool_result(request: httpx2.Request) -> dict[str, Any]:
    """The output of the tool in the last user message of a request to the model."""
    block = body(request)["messages"][-1]["content"][0]
    assert block["type"] == "tool_result" and block["tool_use_id"] == "toolu_test"
    return json.loads(block["content"])


def quoted(
    citation: str, document: str, anchor: str, text: str, highlighted: str | None = None
) -> Quoted:
    """A quote as code shows it: the link opens the text that holds it and highlights it."""
    unit = Unit(
        id="quote",
        citation=citation,
        document=document,
        anchor=anchor,
        quote=highlighted or text,
    )
    return Quoted(citation=citation, link=link(unit), text=text)


OBJECT_QUOTE = quoted("GDPR Article 21(1)", "32016R0679", "021.001", OBJECT)


def segments(text: str) -> list[dict[str, Any]]:
    """The segments of the one paragraph of an answer's text."""
    [block] = [item.model_dump() for item in blocks(text, RESULT)]
    assert block["kind"] == "paragraph"
    return block["segments"]


def links(text: str) -> dict[str, str | None]:
    return {item["text"]: item["link"] for item in segments(text)}


# The tools.


def test_contents_gives_the_table_of_contents_of_a_regulation() -> None:
    assert read_contents("gdpr") == {"contents": contents(COPIES["gdpr"])}
    assert "Article 4a: " in read_contents("ai_act")["contents"]


def test_article_gives_the_text_of_an_article_with_its_title_chapter_and_section() -> (
    None
):
    article = read_article("gdpr", "article", "21")

    assert article["citation"] == "GDPR Article 21"
    assert article["title"] == "Right to object"
    assert article["chapter"] == "CHAPTER III Rights of the data subject"
    assert article["section"].startswith("Section 4 ")
    assert " ".join(article["text"].split()).startswith(f"1. {OBJECT}")
    assert "changed_by" not in article and "inserted_by" not in article


def test_article_gives_each_point_of_regulation_2026_1744_that_changes_it() -> None:
    article = read_article("ai_act", "article", "10")

    [point] = article["changed_by"]
    assert point["point"] == "Regulation (EU) 2026/1744, Article 1, point (9)"
    assert "paragraph 5 is deleted;" in point["text"]


def test_article_4a_has_its_text_from_the_point_that_inserts_it() -> None:
    article = read_article("ai_act", "article", "4a")

    assert article["citation"] == "AI Act Article 4a"
    assert article["inserted_by"] == "Regulation (EU) 2026/1744, Article 1, point (6)"
    assert " ".join(article["text"].split()).startswith(
        "1. To the extent strictly necessary to ensure bias detection"
    )


def test_article_finds_an_article_by_a_number_with_its_paragraph() -> None:
    assert read_article("ai_act", "article", "3(3)")["citation"] == "AI Act Article 3"
    assert read_article("ai_act", "annex", "III")["citation"] == "AI Act Annex III"


def test_article_reads_the_articles_of_regulation_2026_1744_itself() -> None:
    article = read_article("amending", "article", "1")

    assert article["citation"] == "Regulation (EU) 2026/1744 Article 1"
    assert "(9) Article 10 is amended as follows:" in article["text"]


@pytest.mark.parametrize(
    ("regulation", "kind", "number"),
    [("gdpr", "article", "150"), ("gdpr", "annex", "I"), ("ai_act", "article", "4b")],
)
def test_an_article_that_is_not_in_the_stored_copy_is_not_found(
    regulation: str, kind: str, number: str
) -> None:
    assert read_article(regulation, kind, number) == {"error": "not_found"}


def test_guidance_gives_the_entries_of_a_fact_with_their_quotes_and_sources() -> None:
    entries = read_guidance(SCHEMA, GUIDANCE, "under_own_name")

    assert entries["fact"] == "Under own name or trademark"
    assert [item["id"] for item in entries["entries"]] == [
        entry.id for entry in GUIDANCE.entries if entry.slot == "under_own_name"
    ]
    first = next(entry for entry in GUIDANCE.entries if entry.slot == "under_own_name")
    source = next(item for item in GUIDANCE.sources if item.id == first.source)
    assert entries["entries"][0] == {
        "id": first.id,
        "two_sided": first.two_sided,
        "source": source.title,
        "quotes": [item.model_dump() for item in first.quotes],
    }


def test_guidance_of_an_unknown_fact_is_refused_and_a_fact_without_entries_has_none() -> (
    None
):
    assert read_guidance(SCHEMA, GUIDANCE, "price") == {"error": "unknown_fact"}
    assert read_guidance(SCHEMA, GUIDANCE, "own_use")["entries"] == []


def test_what_if_gives_the_changes_that_code_computes_and_changes_nothing() -> None:
    changes = [
        {"fact": "automated_decisions", "value": "yes"},
        {"fact": "under_own_name", "value": "no"},
    ]
    before = INTAKE.model_copy(deep=True)

    turn, requests = asked(call("what_if", {"changes": changes}), answer())

    computed = what_if(
        GATES,
        SCHEMA,
        INTAKE,
        [Requested(fact=item["fact"], value=item["value"]) for item in changes],
    )
    output = tool_result(requests[1])
    assert output == {
        **computed.model_dump(),
        # The numbers, so that the answer copies them and counts nothing.
        "counts": {
            "rows_added": len(computed.rows_added),
            "rows_removed": len(computed.rows_removed),
            "rows_changed": len(computed.rows_changed),
            "now_open": len(computed.now_open),
            "no_longer_asked": len(computed.no_longer_asked),
        },
    }
    assert output["rows_removed"] and output["rows_changed"]
    assert turn.reason == "answered"
    assert INTAKE == before


def test_each_tool_gives_its_output_to_the_model_and_an_unknown_tool_an_error() -> None:
    turn, requests = asked(
        call("contents", {"regulation": "gdpr"}),
        call("article", {"regulation": "gdpr", "kind": "article", "number": "21"}),
        call("guidance", {"fact": "under_own_name"}),
        call("record", {"fact": "under_own_name", "value": "no"}),
        answer(),
    )

    assert tool_result(requests[1]) == read_contents("gdpr")
    assert tool_result(requests[2]) == read_article("gdpr", "article", "21")
    assert tool_result(requests[3]) == read_guidance(SCHEMA, GUIDANCE, "under_own_name")
    assert tool_result(requests[4]) == {"error": "unknown_tool"}
    assert turn.reason == "answered"


# The quotes.


def test_a_quote_word_for_word_in_its_article_is_shown_with_its_paragraph_and_link() -> (
    None
):
    assert check_quote("gdpr", "article", "21", OBJECT) == OBJECT_QUOTE


def test_a_quote_counts_any_run_of_whitespace_as_one_space_without_quotation_marks() -> (
    None
):
    text = "“The data subject shall have  the right\nto object, on grounds relating to his or her particular situation”"

    assert check_quote("gdpr", "article", "21(1)", text) == OBJECT_QUOTE


def test_a_quote_of_an_annex_names_its_point_and_links_to_the_annex() -> None:
    text = "Employment, workers’ management and access to self-employment"

    assert check_quote("ai_act", "annex", "III", text) == quoted(
        "AI Act Annex III, point 4", "32024R1689", "anx_III", text
    )


def test_a_quote_over_several_lines_highlights_from_its_first_line_to_its_last() -> (
    None
):
    head = "all the following conditions shall be met in order for such processing to occur:"
    tail = "the bias detection and correction cannot be effectively fulfilled"

    assert check_quote("ai_act", "article", "4a", f"{head} (a) {tail}") == quoted(
        "AI Act Article 4a(1), as inserted by Regulation (EU) 2026/1744",
        "32026R1744",
        "art_1",
        f"{head} (a) {tail}",
        f"{head}\n{tail}",
    )


def test_a_quote_of_a_changed_article_is_found_in_the_point_that_changes_it() -> None:
    text = "paragraphs 2, 3 and 4 of this Article and Article 4a(1) shall apply only to the testing data sets"

    assert check_quote("ai_act", "article", "10", text) == quoted(
        "AI Act Article 10(6), as changed by Regulation (EU) 2026/1744",
        "32026R1744",
        "art_1",
        text,
    )


@pytest.mark.parametrize(
    ("regulation", "kind", "number", "text"),
    [
        ("gdpr", "article", "21", OBJECT.replace("particular", "own")),
        ("gdpr", "article", "22", OBJECT),
        ("ai_act", "article", "21", OBJECT),
        ("gdpr", "article", "150", OBJECT),
        ("gdpr", "article", "21", "The data"),
    ],
    ids=[
        "a_word_changed",
        "another_article",
        "another_regulation",
        "unknown",
        "two_words",
    ],
)
def test_a_quote_that_is_not_word_for_word_in_the_stored_copy_is_dropped(
    regulation: str, kind: str, number: str, text: str
) -> None:
    assert check_quote(regulation, kind, number, text) is None


# The links of the citations.


def test_a_citation_in_brackets_links_to_its_paragraph_article_or_annex() -> None:
    oj = f"{EUR_LEX}32024R1689"
    consolidated = f"{EUR_LEX}02024R1689-20260727"

    assert links(
        "See [GDPR Article 21(1)], [GDPR Article 4], [AI Act Article 26(1)], "
        "[AI Act Annex III, point 4], [AI Act Article 10(2)] and [AI Act Article 4a]."
    ) == {
        "See ": None,
        "GDPR Article 21(1)": f"{EUR_LEX}32016R0679#021.001",
        "GDPR Article 4": f"{EUR_LEX}32016R0679#art_4",
        "AI Act Article 26(1)": f"{oj}#026.001",
        "AI Act Annex III, point 4": f"{oj}#anx_III",
        # An article that Regulation (EU) 2026/1744 changed or inserted links to the text in force.
        "AI Act Article 10(2)": f"{consolidated}#art_10",
        "AI Act Article 4a": f"{consolidated}#art_4a",
        ", ": None,
        " and ": None,
        ".": None,
    }


def test_a_citation_of_an_article_that_is_not_in_the_stored_copy_has_no_link() -> None:
    assert segments("See [GDPR Article 150].") == [
        {"text": "See ", "link": None},
        {"text": "GDPR Article 150", "link": None},
        {"text": ".", "link": None},
    ]


def test_a_citation_outside_brackets_is_linked_when_its_regulation_is_named() -> None:
    gdpr = f"{EUR_LEX}32016R0679"

    assert segments(
        "GDPR Article 22 limits such decisions, and Article 22(3) gives a right."
    ) == [
        {"text": "GDPR Article 22", "link": f"{gdpr}#art_22"},
        {"text": " limits such decisions, and ", "link": None},
        {"text": "Article 22(3)", "link": f"{gdpr}#022.003"},
        {"text": " gives a right.", "link": None},
    ]


def test_an_article_without_its_regulation_takes_the_one_that_the_result_cites() -> (
    None
):
    # The result cites AI Act Article 26 and no GDPR Article 26.
    assert segments("Article 26 applies to you.")[0] == {
        "text": "Article 26",
        "link": f"{EUR_LEX}32024R1689#art_26",
    }
    # Both regulations have an Article 5 that the text names, so it stays without a link.
    assert segments("GDPR Article 5 and AI Act Article 5 differ; Article 5 is long.")[
        -1
    ] == {"text": " differ; Article 5 is long.", "link": None}


def test_an_answer_is_given_as_paragraphs_and_lists_without_bold_marks() -> None:
    text = "Two **questions** may change:\n\n- Interacts with people\n- Profiling\n\n1. First\n2. Second"

    assert [item.model_dump() for item in blocks(text, RESULT)] == [
        {
            "kind": "paragraph",
            "segments": [{"text": "Two questions may change:", "link": None}],
        },
        {
            "kind": "list",
            "ordered": False,
            "start": 1,
            "items": [
                [{"text": "Interacts with people", "link": None}],
                [{"text": "Profiling", "link": None}],
            ],
        },
        {
            "kind": "list",
            "ordered": True,
            "start": 1,
            "items": [
                [{"text": "First", "link": None}],
                [{"text": "Second", "link": None}],
            ],
        },
    ]


# The data that the model receives.


def test_the_first_user_message_holds_the_intake_and_its_result_as_data() -> None:
    data = user_data(SCHEMA, GUIDANCE, GATES, INTAKE)

    assert data["description"] == {
        field.label: DESCRIPTION[field.id] for field in SCHEMA.description
    }
    facts = {fact["id"]: fact for fact in data["facts"]}
    assert facts["under_own_name"] == {
        "id": "under_own_name",
        "label": "Under own name or trademark",
        "asked": True,
        "answer": "Yes",
        "open": False,
        "values": [
            {"id": "yes", "label": "Yes"},
            {"id": "no", "label": "No"},
            {"id": "not_sure", "label": "Not sure"},
        ],
        "guidance_entries": 5,
    }
    assert facts["automated_decisions"]["open"] is True
    assert data["notes"] == [
        {
            "fact": "Automated decisions about people",
            "reason": "I don't know this about the product",
            "note": NOTE.note,
        }
    ]
    controller = next(
        item for item in data["result"]["results"] if item["result"] == "Controller"
    )
    rows = {row["label"]: row for row in controller["rows"]}
    assert rows["A legal basis for each purpose"]["meaning"] == MEANING.meaning
    assert rows["A legal basis for each purpose"]["action"] == MEANING.action
    assert rows["A legal basis for each purpose"]["from"] == "25 May 2018"
    decisions = rows["Solely automated decisions only under Article 22(2)"]
    assert decisions["status"] == "conditional"
    assert decisions["depends_on"] == [
        "the open answer about Automated decisions about people"
    ]
    assert (
        decisions["also_needs"] == "the answer Yes to Automated decisions about people"
    )
    assert decisions["meaning"] is None
    # The answers to check, most conditional rows first, with the results that depend on each.
    first = data["result"]["answers_to_check"][0]
    assert first["item"] == (
        "whether the product's intended use is one of the uses listed in AI Act Annex III, point 4"
    )
    assert first["results_that_depend_on_it"] == ["High-risk under Annex III"]
    assert first["conditional_rows_that_depend_on_it"] == 18
    assert [item["item"] for item in data["result"]["not_checked"]] == [
        item.text for item in RESULT.not_checked
    ]


def test_the_question_and_the_users_text_reach_the_model_only_in_user_messages(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)

    _, requests = asked(call("contents", {"regulation": "gdpr"}), answer())

    for request in requests:
        sent = body(request)
        assert sent["system"] == PROMPT
        user = json.dumps(
            [item for item in sent["messages"] if item["role"] == "user"],
            ensure_ascii=False,
        )
        for marker in (MARKER, NOTE_MARKER, QUESTION_MARKER):
            assert marker in user
            assert marker not in sent["system"]
    assert first_data(requests[0])["question"] == QUESTION
    assert first_data(requests[0])["intake"] == user_data(
        SCHEMA, GUIDANCE, GATES, INTAKE
    )
    for marker in (MARKER, NOTE_MARKER, QUESTION_MARKER):
        assert marker not in caplog.text


def test_each_request_names_the_model_the_prompt_the_tools_and_no_forced_tool() -> None:
    _, requests = asked(answer())

    sent = body(requests[0])
    assert sent["model"] == "claude-sonnet-5-5"
    assert sent["output_config"] == {"effort": "medium"}
    assert [tool["name"] for tool in sent["tools"]] == [tool["name"] for tool in TOOLS]
    assert [tool["name"] for tool in TOOLS] == [
        "contents",
        "article",
        "guidance",
        "what_if",
        "answer",
    ]
    # The model refuses a forced tool choice, so the prompt asks for the call of answer.
    assert sent["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}
    assert sent["cache_control"] == {"type": "ephemeral"}


def test_each_later_question_follows_the_earlier_questions_with_their_answers() -> None:
    earlier = [
        Turn(
            question="What does Article 21 give?",
            reason="answered",
            text="A right to object [GDPR Article 21(1)].",
            quotes=[OBJECT_QUOTE],
            guidance=[ENTRY],
            changes=[Requested(fact="automated_decisions", value="yes")],
            answers=ANSWERS,
        ),
        Turn(question="And Article 22?", reason="timeout", answers=ANSWERS),
    ]
    intake = INTAKE.model_copy(update={"conversation": earlier})

    _, requests = asked(answer(), intake=intake)

    messages = body(requests[0])["messages"]
    assert [item["role"] for item in messages] == [
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
    ]
    assert (
        json.loads(messages[0]["content"])["question"] == "What does Article 21 give?"
    )
    assert "A right to object [GDPR Article 21(1)]." in messages[1]["content"]
    assert f"GDPR Article 21(1): {OBJECT}" in messages[1]["content"]
    assert ENTRY in messages[1]["content"]
    assert "Automated decisions about people: Yes" in messages[1]["content"]
    assert json.loads(messages[2]["content"]) == {"question": "And Article 22?"}
    assert messages[3]["content"] == "This question could not be answered."
    assert json.loads(messages[4]["content"]) == {"question": QUESTION}


# The loop.


def test_an_answer_is_kept_with_its_checked_quotes_its_known_entries_and_its_changes(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    quotes = [
        {"regulation": "gdpr", "kind": "article", "number": "21", "text": OBJECT},
        {"regulation": "gdpr", "kind": "article", "number": "22", "text": OBJECT},
    ]
    changes = [
        {"fact": "interacts_with_people", "value": "yes"},
        {"fact": "price", "value": "low"},
    ]

    turn, requests = asked(
        call("article", {"regulation": "gdpr", "kind": "article", "number": "21"}),
        answer(
            "  A chat may change one answer.  ",
            quotes,
            [ENTRY, "no_such_entry"],
            changes,
        ),
    )

    assert turn == Turn(
        question=QUESTION,
        reason="answered",
        text="A chat may change one answer.",
        quotes=[OBJECT_QUOTE],
        guidance=[ENTRY],
        changes=[Requested(**item) for item in changes],
        answers=ANSWERS,
    )
    assert len(requests) == 2
    assert f"question 1 model=claude-sonnet-5-5 prompt={PROMPT_VERSION}" in caplog.text
    assert "tools=article " in caplog.text
    assert "reason=answered" in caplog.text
    # The change that cannot be applied is left out of what the panel shows, and logged.
    assert "refused=1" in caplog.text


def contents_call(request: httpx2.Request) -> httpx2.Response:
    return call("contents", {"regulation": "ai_act"})


def test_a_question_may_use_six_tool_calls_before_its_answer() -> None:
    turn, requests = asked(*[contents_call] * TOOL_LIMIT, answer())

    assert TOOL_LIMIT == 6
    assert turn.reason == "answered"
    assert len(requests) == 7


def test_the_seventh_tool_call_ends_the_loop_without_an_answer(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)

    turn, requests = asked(*[contents_call] * (TOOL_LIMIT + 1))

    assert (turn.reason, turn.text, turn.quotes, turn.changes) == (
        "tool_limit",
        "",
        [],
        [],
    )
    assert len(requests) == 7
    assert "tools=contents,contents,contents,contents,contents,contents " in caplog.text
    assert "reason=tool_limit" in caplog.text


def test_no_new_call_is_made_after_the_time_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(conversation, "TIME_LIMIT", 0.0)

    turn, requests = asked(call("contents", {"regulation": "ai_act"}), answer())

    assert turn.reason == "deadline"
    assert len(requests) == 1


@pytest.mark.parametrize(
    ("reply", "reason"),
    [(refused, "call_failed"), (timing_out, "timeout")],
    ids=["status_500", "timeout"],
)
def test_a_call_that_fails_or_times_out_ends_the_loop_without_a_retry(
    reply: Handler, reason: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)

    turn, requests = asked(reply)

    assert turn.reason == reason
    assert turn.text == ""
    assert len(requests) == 1
    assert f"reason={reason}" in caplog.text


def test_an_answer_in_plain_text_gets_one_reminder_to_end_with_answer(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)

    turn, requests = asked(plain("Two answers may change."), answer())

    assert turn.reason == "answered"
    messages = body(requests[1])["messages"]
    assert messages[-2]["role"] == "assistant"
    assert messages[-2]["content"][0]["text"] == "Two answers may change."
    assert messages[-1] == {"role": "user", "content": REMINDER}
    assert "reminder=yes" in caplog.text


def test_a_second_answer_in_plain_text_gives_no_answer() -> None:
    turn, requests = asked(plain(), plain())

    assert (turn.reason, turn.text) == ("no_answer", "")
    assert len(requests) == 2


def test_an_answer_without_text_is_not_answered() -> None:
    turn, _ = asked(answer(" "))

    assert turn.reason == "invalid_answer"


# Each turn as the service shows it.


def entry_of(entry_id: str) -> dict[str, Any]:
    entry = next(item for item in GUIDANCE.entries if item.id == entry_id)
    source = next(item for item in GUIDANCE.sources if item.id == entry.source)
    return Example(
        id=entry.id, two_sided=entry.two_sided, quotes=entry.quotes, source=source
    ).model_dump(mode="json")


def test_an_answered_turn_shows_its_blocks_quotes_and_entries() -> None:
    turn = Turn(
        question=QUESTION,
        reason="answered",
        text="See [GDPR Article 21(1)].",
        quotes=[OBJECT_QUOTE],
        guidance=[ENTRY],
        answers=ANSWERS,
    )

    assert view_turn(SCHEMA, GUIDANCE, GATES, INTAKE, RESULT, turn) == {
        "question": QUESTION,
        "answered": True,
        "blocks": [item.model_dump() for item in blocks(turn.text, RESULT)],
        "quotes": [OBJECT_QUOTE.model_dump()],
        "guidance": [entry_of(ENTRY)],
        "scenario": None,
        "for_earlier_answers": False,
    }


def test_a_turn_that_was_not_answered_shows_only_its_question() -> None:
    turn = Turn(question=QUESTION, reason="tool_limit", answers=ANSWERS)

    assert view_turn(SCHEMA, GUIDANCE, GATES, INTAKE, RESULT, turn) == {
        "question": QUESTION,
        "answered": False,
        "blocks": [],
        "quotes": [],
        "guidance": [],
        "scenario": None,
        "for_earlier_answers": False,
    }


def test_a_change_shows_each_question_it_may_change_and_the_changes_of_all_of_them() -> (
    None
):
    turn = Turn(
        question=QUESTION,
        reason="answered",
        text="Two answers may change.",
        guidance=[ENTRY, "marketing_department"],
        changes=[
            Requested(fact="under_own_name", value="no"),
            Requested(fact="Automated decisions about people", value="yes"),
            Requested(fact="price", value="low"),
        ],
        answers=ANSWERS,
    )

    scenario = view_turn(SCHEMA, GUIDANCE, GATES, INTAKE, RESULT, turn)["scenario"]

    asked_now = last_questions(SCHEMA, INTAKE)
    assert scenario["questions"] == [
        {
            "fact": "Under own name or trademark",
            "fact_id": "under_own_name",
            "question": asked_now["under_own_name"].text,
            "now": "Yes",
            "to": "No",
            # Only the entries that the answer named for this fact.
            "guidance": [entry_of(ENTRY)],
        },
        {
            "fact": "Automated decisions about people",
            "fact_id": "automated_decisions",
            "question": asked_now["automated_decisions"].text,
            "now": "Not sure",
            "to": "Yes",
            "guidance": [],
        },
    ]
    assert (
        scenario["changes"] == what_if(GATES, SCHEMA, INTAKE, turn.changes).model_dump()
    )
    assert [item["error"] for item in scenario["changes"]["refused"]] == [
        "unknown_fact"
    ]


def test_a_change_whose_answers_cannot_be_applied_shows_no_questions() -> None:
    turn = Turn(
        question=QUESTION,
        reason="answered",
        text="No answer changes.",
        changes=[Requested(fact="under_own_name", value="yes")],
        answers=ANSWERS,
    )

    scenario = view_turn(SCHEMA, GUIDANCE, GATES, INTAKE, RESULT, turn)["scenario"]

    assert scenario["questions"] == []
    assert [item["error"] for item in scenario["changes"]["refused"]] == ["same_answer"]


def test_an_earlier_turn_keeps_its_scenario_and_says_it_was_for_the_earlier_answers() -> (
    None
):
    turn = Turn(
        question=QUESTION,
        reason="answered",
        text="One answer may change.",
        changes=[Requested(fact="automated_decisions", value="yes")],
        answers=ANSWERS,
    )
    changed = INTAKE.model_copy(
        update={"answers": {**ANSWERS, "automated_decisions": "no"}, "not_sure": {}}
    )

    shown = view_turn(
        SCHEMA, GUIDANCE, GATES, changed, decide(GATES, SCHEMA, changed), turn
    )

    assert shown["for_earlier_answers"] is True
    # The changes are those of the answers at the time of the question.
    assert shown["scenario"]["questions"][0]["now"] == "Not sure"
    assert shown["scenario"]["changes"]["rows_changed"]
