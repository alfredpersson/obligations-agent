"""The fact schema: reads and checks schema.yaml (FACT-1, FACT-2 and FACT-4 in docs/spec.md)."""

from collections.abc import Hashable
from importlib.resources import files
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ValidationError

NOT_SURE = "not_sure"


class SchemaError(Exception):
    """A problem in schema.yaml: a key used twice, a slot without the form that FACT-1 and FACT-2 require, an id used twice, or a relevance condition that does not name earlier slots and their values."""


class UniqueKeyLoader(yaml.SafeLoader):
    """The safe loader, but a key used twice in one mapping is an error. PyYAML would keep only the last value."""

    def construct_mapping(
        self, node: yaml.MappingNode, deep: bool = False
    ) -> dict[Hashable, Any]:
        keys: list[Any] = []
        for key_node, _ in node.value:
            if key_node.value in keys:
                line = key_node.start_mark.line + 1
                raise SchemaError(
                    f"line {line}: the key {key_node.value} is used twice"
                )
            keys.append(key_node.value)
        return super().construct_mapping(node, deep=deep)


class Value(BaseModel):
    id: str
    label: str


class Slot(BaseModel):
    id: str
    label: str
    question: str
    values: list[Value]
    # "always" for a slot on the form. For a follow-up slot, the values of earlier slots that
    # make it relevant.
    relevant: Literal["always"] | dict[str, list[str]]
    unit: str


class DescriptionField(BaseModel):
    id: str
    label: str
    question: str
    max_length: int


class Schema(BaseModel):
    """The description fields, the slots on the form (FACT-3) and the follow-up slots, each in the order of schema.yaml."""

    description: list[DescriptionField]
    slots: list[Slot]
    follow_up_slots: list[Slot]


def parse_schema(text: str) -> Schema:
    """Reads a schema from YAML text, and puts the slots that are always relevant on the form. The error for a broken slot names it by id, or by position when the id is missing; a description field whose id is already used is named by its id; a key used twice is named with its line."""
    data: Any = yaml.load(text, Loader=UniqueKeyLoader)
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
        # Only earlier slots, so that the relevance of a slot is known when the questions reach
        # it in schema order.
        if slot.relevant != "always":
            if not slot.relevant or not all(slot.relevant.values()):
                raise SchemaError(f"slot {name}: the condition is empty")
            for slot_id, values in slot.relevant.items():
                earlier = next((other for other in slots if other.id == slot_id), None)
                if earlier is None:
                    raise SchemaError(
                        f"slot {name}: the condition names {slot_id}, which is not an earlier slot"
                    )
                if not set(values) <= {value.id for value in earlier.values}:
                    raise SchemaError(
                        f"slot {name}: the condition names a value that {slot_id} does not have"
                    )
        slots.append(slot)
    description: list[DescriptionField] = []
    for raw in data["description"]:
        field = DescriptionField.model_validate(raw)
        # The field of an error names a slot or a description field, so their ids must not overlap.
        if field.id in [earlier.id for earlier in [*description, *slots]]:
            raise SchemaError(f"description field {field.id}: the id is used twice")
        description.append(field)
    return Schema(
        description=description,
        slots=[slot for slot in slots if slot.relevant == "always"],
        follow_up_slots=[slot for slot in slots if slot.relevant != "always"],
    )


def load_schema() -> Schema:
    """Reads schema.yaml from this package."""
    text = (
        files("obligations_agent").joinpath("schema.yaml").read_text(encoding="utf-8")
    )
    return parse_schema(text)
