"""The stored copies in docs/regulations/ as articles and annexes: the table of contents of each regulation, and the points of Article 1 of Regulation (EU) 2026/1744 that change or insert an AI Act article or annex (TOOL-2, TOOL-3)."""

import re
from pathlib import Path

from pydantic import BaseModel

COPIES = Path(__file__).resolve().parents[3] / "docs" / "regulations"
# The copies put a non-breaking space between a heading's word and its number.
SPACE = r"[  ]"
HEADING = re.compile(rf"(Article|ANNEX|Annex){SPACE}(\d+[a-z]?|[IVXL]+)")
INSERTED_HEADING = re.compile(rf"‘?(Article|Annex){SPACE}(\d+[a-z]|[IVXL]+)")


class Point(BaseModel):
    """A point of Article 1 of Regulation (EU) 2026/1744: its number, its first line and its lines."""

    number: str
    instruction: str
    lines: list[str]


class Part(BaseModel):
    """An article or an annex: its kind, number, title and lines, the chapter and the section that it stands in, and the points of Article 1 of Regulation (EU) 2026/1744 that change it or the point that inserts it."""

    kind: str
    number: str
    title: str
    lines: list[str]
    chapter: str = ""
    section: str = ""
    changed_by: list[Point] = []
    inserted_by: Point | None = None


class Document(BaseModel):
    id: str
    name: str
    celex: str
    parts: list[Part]


def plain(line: str) -> str:
    return line.replace(" ", " ").rstrip()


def body(name: str) -> list[str]:
    """The lines of a stored copy after its header."""
    return (
        (COPIES / name).read_text(encoding="utf-8").split("\n---\n", 1)[1].split("\n")
    )


def split(lines: list[str], start: int) -> list[Part]:
    """The articles and annexes of an Official Journal text, each from its heading to the next heading, the next chapter or section, the signatures or the footer."""
    parts: list[Part] = []
    chapter = section = ""
    current: Part | None = None
    for index in range(start, len(lines)):
        line = lines[index].strip()
        if re.fullmatch(rf"CHAPTER{SPACE}[IVXL]+", line):
            chapter = f"{plain(line)} {plain(lines[index + 1].strip())}"
            section = ""
            current = None
            continue
        # An annex has sections of its own, which stay in its text.
        if re.fullmatch(rf"(SECTION|Section){SPACE}\d+", line) and not (
            current and current.kind == "annex"
        ):
            section = f"{plain(line)} {plain(lines[index + 1].strip())}"
            current = None
            continue
        if line.startswith(("Done at ", "ELI: ")):
            current = None
            continue
        match = HEADING.fullmatch(line)
        if match:
            kind = match.group(1).lower()
            if kind == "annex":
                chapter = section = ""
            title = plain(lines[index + 1].strip())
            current = Part(
                kind=kind,
                number=match.group(2),
                title=title,
                lines=[],
                chapter=chapter,
                section=section,
            )
            parts.append(current)
            continue
        if current is not None:
            current.lines.append(plain(lines[index]))
    for part in parts:
        # The first line after the heading is the title.
        part.lines = part.lines[1:]
        while part.lines and not part.lines[-1].strip():
            part.lines.pop()
    return parts


def adopted(lines: list[str]) -> int:
    return next(
        i
        for i, line in enumerate(lines)
        if line.strip() == "HAVE ADOPTED THIS REGULATION:"
    )


def read_points(lines: list[str], start: int, stop: int) -> list[Point]:
    marks = [
        i for i in range(start, stop) if re.fullmatch(r"\(\d+\)", lines[i].strip())
    ]
    return [
        Point(
            number=lines[i].strip()[1:-1],
            instruction=plain(lines[i + 1].strip()),
            lines=[plain(line) for line in lines[i + 1 : end]],
        )
        for i, end in zip(marks, [*marks[1:], stop], strict=True)
    ]


def base(number: str) -> str:
    """The number of an article without its letter: "4" for Article 4a."""
    return re.sub(r"[a-z]+$", "", number)


def attach(ai_act: Document, points: list[Point]) -> None:
    """Gives each AI Act part the points that change it, and adds each part that a point inserts after the part that it follows."""
    by_key = {(part.kind, part.number): part for part in ai_act.parts}
    for point in points:
        named = re.search(
            rf"(Article|Annex){SPACE}(\d+[a-z]?|[IVXL]+)", point.instruction
        )
        # A point that inserts an article or an annex names no number in its first line.
        if named:
            by_key[(named.group(1).lower(), named.group(2))].changed_by.append(point)
            continue
        # The heading of each inserted article or annex, with or without the opening quotation mark.
        headings = [
            (i, match)
            for i, line in enumerate(point.lines)
            if (match := INSERTED_HEADING.fullmatch(line.strip()))
        ]
        ends = [i for i, _ in headings[1:]] + [len(point.lines)]
        for (index, match), end in zip(headings, ends, strict=True):
            kind = match.group(1).lower()
            text = [line.removeprefix("‘") for line in point.lines[index + 2 : end]]
            while text and text[-1].strip() in ("", ";"):
                text.pop()
            if text:
                text[-1] = text[-1].rstrip("’;").rstrip("’")
            number = match.group(2)
            # After the last annex, or after the last article with the same number before its letter.
            after = max(
                i
                for i, item in enumerate(ai_act.parts)
                if item.kind == kind
                and (kind == "annex" or base(item.number) == base(number))
            )
            followed = ai_act.parts[after]
            part = Part(
                kind=kind,
                number=number,
                title=point.lines[index + 1].strip(),
                lines=text,
                chapter=followed.chapter,
                section=followed.section,
                inserted_by=point,
            )
            ai_act.parts.insert(after + 1, part)


def load_copies() -> dict[str, Document]:
    """The AI Act, the GDPR and Regulation (EU) 2026/1744 from their stored copies. The parts of Regulation (EU) 2026/1744 are its Article 1, as the list of its points with their first lines, and its Articles 2 to 4."""
    lines = body("ai-act.txt")
    ai_act = Document(
        id="ai_act",
        name="AI Act",
        celex="32024R1689",
        parts=split(lines, adopted(lines)),
    )
    lines = body("gdpr.txt")
    gdpr = Document(
        id="gdpr", name="GDPR", celex="32016R0679", parts=split(lines, adopted(lines))
    )
    lines = body("ai-act-2026-1744.txt")
    first = adopted(lines)
    second = next(
        i
        for i in range(first, len(lines))
        if re.fullmatch(rf"Article{SPACE}2", lines[i].strip())
        and "Amendments" in lines[i + 1]
    )
    points = read_points(lines, first + 1, second)
    attach(ai_act, points)
    article_1 = Part(
        kind="article",
        number="1",
        title=plain(lines[first + 2].strip()),
        lines=[f"({point.number}) {point.instruction}" for point in points],
    )
    amending = Document(
        id="amending",
        name="Regulation (EU) 2026/1744",
        celex="32026R1744",
        parts=[article_1, *split(lines, second)],
    )
    return {document.id: document for document in (ai_act, gdpr, amending)}


def contents(document: Document) -> str:
    """The table of contents: each chapter and section once, then each article or annex with its number and title, and what Regulation (EU) 2026/1744 did to it."""
    out: list[str] = []
    chapter = section = None
    for part in document.parts:
        if part.chapter != chapter:
            chapter = part.chapter
            if chapter:
                out.append(chapter)
        if part.section != section:
            section = part.section
            if section:
                out.append(f"  {section}")
        note = (
            " (inserted by Regulation (EU) 2026/1744)"
            if part.inserted_by
            else " (changed by Regulation (EU) 2026/1744)"
            if part.changed_by
            else ""
        )
        out.append(f"    {name_of(part)}: {part.title}{note}")
    return "\n".join(out)


def name_of(part: Part) -> str:
    """The part as a citation names it, such as "Article 26" or "Annex III"."""
    return f"{part.kind.capitalize()} {part.number}"


def anchor(part: Part, paragraph: str | None) -> str:
    """The anchor of the part, or of its paragraph, on EUR-Lex: "anx_III" for an annex, "026.001" for a paragraph of an article whose number has no letter, and "art_4a" otherwise (MEMO-7)."""
    if part.kind == "annex":
        return f"anx_{part.number}"
    if paragraph and part.number.isdigit():
        return f"{int(part.number):03d}.{int(paragraph):03d}"
    return f"art_{part.number}"


def find(document: Document, kind: str, number: str) -> Part | None:
    """The article or annex with the number, without a paragraph such as "(3)", in any case."""
    number = number.split("(")[0].strip().lower()
    return next(
        (
            part
            for part in document.parts
            if part.kind == kind and part.number.lower() == number
        ),
        None,
    )
