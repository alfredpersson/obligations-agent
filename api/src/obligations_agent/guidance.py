"""Examples from official guidance: reads and checks guidance.yaml (FACT-6 in docs/spec.md)."""

from datetime import date
from importlib.resources import files

from pydantic import BaseModel, ConfigDict, Field

from obligations_agent.schema import Schema, load_yaml, read_items


class GuidanceError(Exception):
    """A problem in guidance.yaml: a key used twice, an entry or a source without a part that FACT-6 requires, an id used twice, or an entry that names a slot or a source that does not exist."""


# An empty text counts as a missing part.
TEXT_REQUIRED = ConfigDict(str_min_length=1)


class Source(BaseModel):
    model_config = TEXT_REQUIRED

    id: str
    title: str
    body: str
    link: str
    published: date | None = None
    checked: date
    terms: str
    stored_copy: str
    note: str | None = None


class Quote(BaseModel):
    model_config = TEXT_REQUIRED

    heading: str
    text: str


class Entry(BaseModel):
    model_config = TEXT_REQUIRED

    id: str
    slot: str
    source: str
    two_sided: bool
    quotes: list[Quote] = Field(min_length=1)


class Guidance(BaseModel):
    sources: list[Source]
    entries: list[Entry]


def parse_guidance(text: str, schema: Schema) -> Guidance:
    """Reads the examples from YAML text, and checks that each entry names a slot of the schema and a source of the file."""
    data = load_yaml(text, GuidanceError)
    sources = read_items(Source, "source", data["sources"], GuidanceError)
    entries = read_items(Entry, "entry", data["entries"], GuidanceError)
    slot_ids = [slot.id for slot in [*schema.slots, *schema.follow_up_slots]]
    source_ids = [source.id for source in sources]
    for entry in entries:
        if entry.slot not in slot_ids:
            raise GuidanceError(
                f"entry {entry.id}: the slot {entry.slot} is not in schema.yaml"
            )
        if entry.source not in source_ids:
            raise GuidanceError(
                f"entry {entry.id}: the source {entry.source} is not in guidance.yaml"
            )
    return Guidance(sources=sources, entries=entries)


def load_guidance(schema: Schema) -> Guidance:
    """Reads guidance.yaml from this package."""
    text = (
        files("obligations_agent").joinpath("guidance.yaml").read_text(encoding="utf-8")
    )
    return parse_guidance(text, schema)
