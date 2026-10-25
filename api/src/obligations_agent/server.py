"""The HTTP API that the web app calls: GET /schema, POST /intakes, GET /intakes/{id} and POST /intakes/{id}/answers."""

import secrets
import threading
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from obligations_agent.intakes import (
    Answer,
    ErrorCode,
    Form,
    Intake,
    IntakeError,
    create_intake,
    open_slots,
    record_answer,
    waiting,
)
from obligations_agent.schema import Schema, load_schema

READY_TO_CONFIRM = {"type": "ready_to_confirm"}

STATUS: dict[ErrorCode, int] = {
    "invalid_slot": 422,
    "invalid_value": 422,
    "not_found": 404,
}


def error_response(code: ErrorCode, field: str | None = None) -> JSONResponse:
    error = {"code": code} if field is None else {"code": code, "field": field}
    return JSONResponse({"error": error}, status_code=STATUS[code])


def step(schema: Schema, intake: Intake) -> dict[str, Any]:
    """The current step: the question that waits for an answer, or "ready to confirm"."""
    number = waiting(intake)
    if number is None:
        return READY_TO_CONFIRM
    slot = next(
        slot
        for slot in schema.follow_up_slots
        if slot.id == intake.questions[number - 1]
    )
    return {
        "type": "question",
        "number": number,
        "slot": slot.id,
        "text": slot.question,
        # Code asks with the default question text, so each option shows the label of its value.
        "options": [{"value": value.id, "label": value.label} for value in slot.values],
    }


def create_app(schema: Schema, intakes: dict[str, Intake]) -> FastAPI:
    app = FastAPI()
    # FastAPI runs these endpoints in several threads. Answers are recorded one at a time, so that
    # the second of two copies of an answer sees the first and changes nothing.
    answering = threading.Lock()

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
        intake = create_intake(schema, body.answers, body.description)
        # 128 random bits, as 22 URL-safe characters.
        intake_id = secrets.token_urlsafe(16)
        intakes[intake_id] = intake
        return {"id": intake_id, "step": step(schema, intake)}

    @app.get("/intakes/{intake_id}")
    def get_intake(intake_id: str) -> dict[str, Any]:
        intake = intakes.get(intake_id)
        if intake is None:
            raise IntakeError("not_found")
        return {
            "id": intake_id,
            "description": intake.description,
            "answers": intake.answers,
            "open_slots": open_slots(schema, intake),
            "step": step(schema, intake),
        }

    @app.post("/intakes/{intake_id}/answers")
    def post_answer(intake_id: str, body: Answer) -> dict[str, Any]:
        with answering:
            intake = intakes.get(intake_id)
            if intake is None:
                raise IntakeError("not_found")
            # record_answer returns a new intake, so a reader sees the old one or the new one.
            intake = record_answer(schema, intake, body.question, body.value)
            intakes[intake_id] = intake
        return {"step": step(schema, intake)}

    return app


app = create_app(load_schema(), {})
