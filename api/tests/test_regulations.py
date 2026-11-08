"""Tests for the stored copies of the regulations as articles and annexes, their tables of contents, and the points of Regulation (EU) 2026/1744 that change or insert a part of the AI Act, which the tools of the conversation read (issue #44: MEMO-8, TOOL-2, TOOL-3)."""

import re

from obligations_agent.regulations import contents, find, load_copies

COPIES = load_copies()
AI_ACT = COPIES["ai_act"]
GDPR = COPIES["gdpr"]
AMENDING = COPIES["amending"]
# The articles that Regulation (EU) 2026/1744 inserts, after the article with the same number.
INSERTED = {"4": ["4a"], "60": ["60a"], "75": ["75a", "75b", "75c", "75d"]}
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]


def numbers(kind: str, document_id: str) -> list[str]:
    return [part.number for part in COPIES[document_id].parts if part.kind == kind]


def words(text: str) -> str:
    return " ".join(text.split())


def test_each_copy_is_read_with_its_name_and_celex_number() -> None:
    assert {key: (item.id, item.name, item.celex) for key, item in COPIES.items()} == {
        "ai_act": ("ai_act", "AI Act", "32024R1689"),
        "gdpr": ("gdpr", "GDPR", "32016R0679"),
        "amending": ("amending", "Regulation (EU) 2026/1744", "32026R1744"),
    }


def test_each_regulation_has_its_articles_and_annexes_in_order() -> None:
    articles = [
        number
        for base in range(1, 114)
        for number in [str(base), *INSERTED.get(str(base), [])]
    ]

    assert numbers("article", "ai_act") == articles
    # Annex XIV is inserted by Regulation (EU) 2026/1744.
    assert numbers("annex", "ai_act") == [*ROMAN, "XIII", "XIV"]
    assert numbers("article", "gdpr") == [str(number) for number in range(1, 100)]
    assert numbers("annex", "gdpr") == []
    assert numbers("article", "amending") == ["1", "2", "3", "4"]


def test_a_part_holds_its_title_its_chapter_its_section_and_its_text() -> None:
    part = find(GDPR, "article", "21")

    assert part is not None
    assert part.title == "Right to object"
    assert part.chapter == "CHAPTER III Rights of the data subject"
    assert (
        part.section
        == "Section 4 Right to object and automated individual decision-making"
    )
    assert words(part.lines[0]).startswith(
        "1. The data subject shall have the right to object"
    )
    # The text ends with the article's last paragraph, before the heading of Article 22.
    assert words(part.lines[-1]).startswith("6. Where personal data are processed")
    assert not any(re.fullmatch(r"Article\s+22", line.strip()) for line in part.lines)


def test_an_ai_act_article_stands_in_its_chapter_and_section() -> None:
    part = find(AI_ACT, "article", "26")

    assert part is not None
    assert part.title == "Obligations of deployers of high-risk AI systems"
    assert part.chapter == "CHAPTER III HIGH-RISK AI SYSTEMS"
    assert part.section == (
        "SECTION 3 Obligations of providers and deployers of high-risk AI systems "
        "and other parties"
    )


def test_an_annex_holds_its_points_and_stands_in_no_chapter() -> None:
    part = find(AI_ACT, "annex", "III")

    assert part is not None
    assert part.title == "High-risk AI systems referred to in Article 6(2)"
    assert (part.chapter, part.section) == ("", "")
    assert [
        line.strip() for line in part.lines if re.fullmatch(r"\d+\.", line.strip())
    ] == [f"{number}." for number in range(1, 9)]


def test_article_10_has_the_point_of_regulation_2026_1744_that_changes_it() -> None:
    part = find(AI_ACT, "article", "10")

    assert part is not None
    assert [point.number for point in part.changed_by] == ["9"]
    assert part.changed_by[0].instruction == "Article 10 is amended as follows:"
    assert "paragraph 5 is deleted;" in part.changed_by[0].lines
    assert part.inserted_by is None
    # The Official Journal text stays the part's own text.
    assert any(words(line).startswith("5. To the extent") for line in part.lines)


def test_article_4a_has_the_text_of_the_point_that_inserts_it() -> None:
    part = find(AI_ACT, "article", "4a")

    assert part is not None
    assert part.inserted_by is not None and part.inserted_by.number == "6"
    assert part.changed_by == []
    assert part.title == (
        "Processing of special categories of personal data for bias detection and "
        "correction"
    )
    assert part.chapter == "CHAPTER I GENERAL PROVISIONS"
    assert words(part.lines[0]).startswith(
        "1. To the extent strictly necessary to ensure bias detection and correction"
    )
    # Without the quotation marks and the semicolon that end the inserted text in the point.
    assert not part.lines[-1].rstrip().endswith(("’;", "’", ";"))


def test_each_of_the_43_points_changes_or_inserts_a_part_of_the_ai_act() -> None:
    changed = {
        point.number: f"{part.kind} {part.number}"
        for part in AI_ACT.parts
        for point in part.changed_by
    }
    inserted = {
        f"{part.kind} {part.number}": part.inserted_by.number
        for part in AI_ACT.parts
        if part.inserted_by is not None
    }

    assert set(changed) | set(inserted.values()) == {str(n) for n in range(1, 44)}
    assert set(changed).isdisjoint(inserted.values())
    assert inserted == {
        "article 4a": "6",
        "article 60a": "25",
        "article 75a": "32",
        "article 75b": "32",
        "article 75c": "32",
        "article 75d": "32",
        "annex XIV": "43",
    }
    assert (changed["2"], changed["3"]) == ("article 2", "article 2")
    assert changed["39"] == "article 111"
    assert (changed["41"], changed["42"]) == ("annex I", "annex VIII")


def test_article_1_of_regulation_2026_1744_lists_each_point_with_its_first_line() -> (
    None
):
    part = find(AMENDING, "article", "1")

    assert part is not None
    assert len(part.lines) == 43
    assert part.lines[8] == "(9) Article 10 is amended as follows:"


def test_the_table_of_contents_gives_each_chapter_once_and_each_part_with_its_title() -> (
    None
):
    gdpr = contents(GDPR).split("\n")
    ai_act = contents(AI_ACT).split("\n")

    assert gdpr.count("CHAPTER III Rights of the data subject") == 1
    assert (
        "  Section 4 Right to object and automated individual decision-making" in gdpr
    )
    assert "    Article 21: Right to object" in gdpr
    assert (
        "    Article 8: Conditions applicable to child's consent in relation to "
        "information society services"
    ) in gdpr
    assert (
        "    Article 4a: Processing of special categories of personal data for bias "
        "detection and correction (inserted by Regulation (EU) 2026/1744)"
    ) in ai_act
    assert (
        "    Article 10: Data and data governance (changed by Regulation (EU) 2026/1744)"
        in ai_act
    )
    assert "    Article 26: Obligations of deployers of high-risk AI systems" in ai_act
    assert "    Annex III: High-risk AI systems referred to in Article 6(2)" in ai_act
    assert len([line for line in ai_act if line.startswith("    ")]) == 119 + 14


def test_a_part_is_found_by_its_number_also_with_a_paragraph_or_in_lower_case() -> None:
    article = find(AI_ACT, "article", "3(3)")
    annex = find(AI_ACT, "annex", "iii")
    inserted = find(AI_ACT, "article", "4A")

    assert article is not None and article.number == "3"
    assert annex is not None and annex.number == "III"
    assert inserted is not None and inserted.number == "4a"
    assert find(GDPR, "article", "100") is None
    assert find(GDPR, "annex", "I") is None
    assert find(AI_ACT, "article", "") is None
