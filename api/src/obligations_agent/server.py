"""The HTTP API that the web app calls: GET /schema, POST /intakes and GET /intakes/{id}."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from obligations_agent.intakes import (
    Intake,
    IntakeError,
    create_intake,
    new_intake_id,
    open_slots,
)
from obligations_agent.schema import Schema, load_schema

# No follow-up facts exist yet, so the intake finishes right after the form (INTAKE-1).
READY_TO_CONFIRM = {"type": "ready_to_confirm"}

STATUS = {"invalid_slot": 422, "invalid_value": 422, "not_found": 404}


class IntakeRequest(BaseModel):
    answers: dict[str, str]
    description: str


def error_response(code: str, field: str | None = None) -> JSONResponse:
    error = {"code": code} if field is None else {"code": code, "field": field}
    return JSONResponse({"error": error}, status_code=STATUS[code])


def create_app(schema: Schema, intakes: dict[str, Intake]) -> FastAPI:
    app = FastAPI()

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
        return {
            "description": schema.description.model_dump(),
            "slots": [
                slot.model_dump(include={"id", "label", "question", "values"})
                for slot in schema.slots
            ],
        }

    @app.post("/intakes", status_code=201)
    def post_intake(body: IntakeRequest) -> dict[str, Any]:
        intake = create_intake(schema, body.answers, body.description)
        intake_id = new_intake_id()
        intakes[intake_id] = intake
        return {"id": intake_id, "step": READY_TO_CONFIRM}

    @app.get("/intakes/{intake_id}")
    def get_intake(intake_id: str) -> dict[str, Any]:
        intake = intakes.get(intake_id)
        if intake is None:
            raise IntakeError("not_found")
        return {
            "id": intake_id,
            "description": intake.description,
            "answers": intake.answers,
            "open_slots": open_slots(intake),
            "step": READY_TO_CONFIRM,
        }

    return app


app = create_app(load_schema(), {})
