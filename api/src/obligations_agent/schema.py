"""The fact schema: reads and checks schema.yaml (FACT-1 and FACT-2 in docs/spec.md)."""

from importlib.resources import files
from typing import Any

import yaml
from pydantic import BaseModel, ValidationError

NOT_SURE = "not_sure"


class SchemaError(Exception):
    """A slot in schema.yaml does not have the form that FACT-1 and FACT-2 require."""


class Value(BaseModel):
    id: str
    label: str


class Slot(BaseModel):
    id: str
    label: str
    question: str
    values: list[Value]
    relevant: str
    unit: str


class DescriptionField(BaseModel):
    label: str
    question: str
    max_length: int


class Schema(BaseModel):
    description: DescriptionField
    slots: list[Slot]


def parse_schema(text: str) -> Schema:
    """Reads a schema from YAML text. The error for a broken slot names it by id, or by position when the id is missing."""
    data: Any = yaml.safe_load(text)
    slots: list[Slot] = []
    for position, raw in enumerate(data["slots"], start=1):
        name = raw.get("id", position)
        try:
            slot = Slot.model_validate(raw)
        except ValidationError as error:
            raise SchemaError(f"slot {name}: {error}") from error
        value_ids = [value.id for value in slot.values]
        if NOT_SURE not in value_ids:
            raise SchemaError(f"slot {name}: the value {NOT_SURE} is missing")
        if len(set(value_ids)) < len(value_ids):
            raise SchemaError(f"slot {name}: a value id is used twice")
        if slot.id in [earlier.id for earlier in slots]:
            raise SchemaError(f"slot {name}: the id is used by an earlier slot")
        slots.append(slot)
    description = DescriptionField.model_validate(data["description"])
    return Schema(description=description, slots=slots)


def load_schema() -> Schema:
    """Reads schema.yaml from this package."""
    text = (
        files("obligations_agent").joinpath("schema.yaml").read_text(encoding="utf-8")
    )
    return parse_schema(text)
