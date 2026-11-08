"""The HTTP API that the web app calls: GET /schema, POST /intakes, GET /intakes/{id}, POST /intakes/{id}/answers, PUT /intakes/{id}/answers/{slot}, POST /intakes/{id}/confirm, POST /intakes/{id}/texts and POST /intakes/{id}/questions."""

import logging
import os
import secrets
import threading
from typing import Any

import anthropic
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from obligations_agent.conversation import QUESTION_LIMIT, ask, view_turn
from obligations_agent.gates import Gates, decide, load_gates, what_if
from obligations_agent.guidance import Guidance, load_guidance
from obligations_agent.intake_model import new_client, next_question
from obligations_agent.intakes import (
    Answer,
    Ask,
    Change,
    ErrorCode,
    Form,
    Intake,
    IntakeError,
    Question,
    Requested,
    change_answer,
    create_intake,
    last_questions,
    open_slots,
    record_answer,
    waiting,
)
from obligations_agent.schema import NOT_SURE, Schema, load_schema
from obligations_agent.writer import write_texts

READY_TO_CONFIRM = {"type": "ready_to_confirm"}

STATUS: dict[ErrorCode, int] = {
    "invalid_slot": 422,
    "invalid_value": 422,
    "not_found": 404,
    "not_ended": 409,
    "not_confirmed": 409,
    "no_key": 409,
    "limit_reached": 409,
}

logger = logging.getLogger(__name__)


def error_response(code: ErrorCode, field: str | None = None) -> JSONResponse:
    error = {"code": code} if field is None else {"code": code, "field": field}
    return JSONResponse({"error": error}, status_code=STATUS[code])


def step(intake: Intake) -> dict[str, Any]:
    """The current step: the question that waits for an answer, or "ready to confirm"."""
    number = waiting(intake)
    if number is None:
        return READY_TO_CONFIRM
    return {
        "type": "question",
        "number": number,
        **intake.questions[number - 1].model_dump(),
    }


def create_app(
    schema: Schema,
    guidance: Guidance,
    gates: Gates,
    intakes: dict[str, Intake],
    client: anthropic.Anthropic | None = None,
) -> FastAPI:
    app = FastAPI()
    # FastAPI runs these endpoints in several threads. Answers are recorded one at a time, so that
    # the second of two copies of an answer sees the first and changes nothing. The model chooses
    # and writes the next question under the same lock.
    answering = threading.Lock()

    def write(intake: Intake) -> Question | None:
        return next_question(client, schema, guidance, intake)

    @app.exception_handler(IntakeError)
    async def intake_error(request: Request, error: IntakeError) -> JSONResponse:
        return error_response(error.code, error.field)

    @app.exception_handler(RequestValidationError)
    async def request_error(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        # The location starts with where the input came from, such as "body". The field is the
        # last name after that. A body that is not JSON has only a character position there.
        names = [part for part in error.errors()[0]["loc"][1:] if isinstance(part, str)]
        return error_response("invalid_value", names[-1] if names else None)

    @app.get("/schema")
    def get_schema() -> dict[str, Any]:
        # The web app does not use the relevance condition or the defining unit.
        hidden = {"__all__": {"relevant", "unit"}}
        return schema.model_dump(exclude={"slots": hidden, "follow_up_slots": hidden})

    @app.post("/intakes", status_code=201)
    def post_intake(body: Form) -> dict[str, Any]:
        intake = create_intake(
            schema, body.answers, body.description, body.not_sure, write
        )
        # 128 random bits, as 22 URL-safe characters.
        intake_id = secrets.token_urlsafe(16)
        intakes[intake_id] = intake
        return {"id": intake_id, "step": step(intake)}

    def view(intake_id: str, intake: Intake) -> dict[str, Any]:
        """The intake as GET /intakes/{id} returns it."""
        slots = {slot.id: slot for slot in [*schema.slots, *schema.follow_up_slots]}
        opened = open_slots(schema, intake)
        # The result is computed from the answers each time, once they are confirmed (GATE-4).
        result = decide(gates, schema, intake) if intake.confirmed else None
        return {
            "id": intake_id,
            "description": intake.description,
            "answers": intake.answers,
            "open_slots": opened,
            "not_sure": intake.not_sure,
            # The question that the screen of the answers shows for each relevant slot (INTAKE-5).
            "questions": last_questions(schema, intake),
            "step": step(intake),
            "confirmed": intake.confirmed,
            "result": result.model_dump() if result else None,
            # The meaning and the action of each row: none without the key, and an empty map until
            # POST /intakes/{id}/texts has written them (MEMO-1).
            "texts": (intake.texts or {})
            if client is not None and intake.confirmed
            else None,
            # What each value of each open answer would change in the result, computed by code, also
            # without the key (QA-1).
            "open_changes": {
                slot_id: {
                    value.id: what_if(
                        gates,
                        schema,
                        intake,
                        [Requested(fact=slot_id, value=value.id)],
                        result,
                    ).model_dump()
                    for value in slots[slot_id].values
                    if value.id != NOT_SURE
                }
                for slot_id in opened
            }
            if result
            else None,
            # The questions about the result with their answers: none without the key (QA-2, QA-9).
            "conversation": [
                view_turn(schema, guidance, gates, intake, result, turn)
                for turn in intake.conversation
            ]
            if client is not None and result
            else None,
        }

    @app.get("/intakes/{intake_id}")
    def get_intake(intake_id: str) -> dict[str, Any]:
        intake = intakes.get(intake_id)
        if intake is None:
            raise IntakeError("not_found")
        return view(intake_id, intake)

    @app.post("/intakes/{intake_id}/answers")
    def post_answer(intake_id: str, body: Answer) -> dict[str, Any]:
        with answering:
            intake = intakes.get(intake_id)
            if intake is None:
                raise IntakeError("not_found")
            # record_answer returns a new intake, so a reader sees the old one or the new one.
            intake = record_answer(
                schema, intake, body.question, body.value, body.not_sure, write
            )
            intakes[intake_id] = intake
        return {"step": step(intake)}

    @app.put("/intakes/{intake_id}/answers/{slot_id}")
    def put_answer(intake_id: str, slot_id: str, body: Change) -> dict[str, Any]:
        with answering:
            intake = intakes.get(intake_id)
            if intake is None:
                raise IntakeError("not_found")
            intake = change_answer(schema, intake, slot_id, body.value, body.not_sure)
            intakes[intake_id] = intake
        return view(intake_id, intake)

    @app.post("/intakes/{intake_id}/confirm")
    def post_confirm(intake_id: str) -> dict[str, Any]:
        with answering:
            intake = intakes.get(intake_id)
            if intake is None:
                raise IntakeError("not_found")
            if waiting(intake) is not None:
                raise IntakeError("not_ended")
            # A second confirmation changes nothing, so the texts stay (INTAKE-5).
            intake = intake.model_copy(update={"confirmed": True})
            intakes[intake_id] = intake
        return view(intake_id, intake)

    @app.post("/intakes/{intake_id}/texts")
    def post_texts(intake_id: str) -> dict[str, Any]:
        # Under the lock, so that two requests at once write the texts once, and every later request
        # returns the stored texts.
        with answering:
            intake = intakes.get(intake_id)
            if intake is None:
                raise IntakeError("not_found")
            if not intake.confirmed:
                raise IntakeError("not_confirmed")
            if client is not None and intake.texts is None:
                texts = write_texts(
                    client, schema, intake, decide(gates, schema, intake)
                )
                intake = intake.model_copy(update={"texts": texts})
                intakes[intake_id] = intake
        return {"texts": intake.texts}

    @app.post("/intakes/{intake_id}/questions")
    def post_question(intake_id: str, body: Ask) -> dict[str, Any]:
        intake = intakes.get(intake_id)
        if intake is None:
            raise IntakeError("not_found")
        if not intake.confirmed:
            raise IntakeError("not_confirmed")
        if client is None:
            raise IntakeError("no_key")
        if not body.text.strip():
            raise IntakeError("invalid_value", "text")
        if len(intake.conversation) >= QUESTION_LIMIT:
            raise IntakeError("limit_reached")
        # The loop runs outside the lock, so that a question does not hold up the answers. The tools
        # read only the intake of the address. The turn is stored under the lock.
        turn = ask(client, schema, guidance, gates, intake, body.text.strip())
        with answering:
            intake = intakes[intake_id]
            intake = intake.model_copy(
                update={"conversation": [*intake.conversation, turn]}
            )
            intakes[intake_id] = intake
        result = decide(gates, schema, intake)
        return {"turn": view_turn(schema, guidance, gates, intake, result, turn)}

    return app


# The log lines of this package show next to the lines of uvicorn. Other packages, such as the
# HTTP client of the SDK, keep the default level and log only warnings.
logging.basicConfig()
logging.getLogger("obligations_agent").setLevel(logging.INFO)
# The schema, the examples from guidance and the gates are loaded once, when the service starts. The
# model is called only when the key is set (INTAKE-1).
SCHEMA = load_schema()
app = create_app(
    SCHEMA,
    load_guidance(SCHEMA),
    load_gates(SCHEMA),
    {},
    new_client() if os.environ.get("ANTHROPIC_API_KEY") else None,
)
