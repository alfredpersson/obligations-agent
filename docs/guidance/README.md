# Stored copies of the guidance sources

These files are copies of the official guidance that `api/src/obligations_agent/guidance.yaml` quotes (FACT-6 in [docs/spec.md](../spec.md)). The tests in `api/tests/test_guidance.py` find every quote of `guidance.yaml` word for word in the text of its copy, after the header that ends with the line `---`, so a quote can still be checked after the source moves or changes.

The repository's MIT license does not cover these files. They are the work of the bodies that published them, used under their terms of reuse:

| File | Source | Terms of reuse |
| --- | --- | --- |
| `ec-data-protection-explained.txt` | European Commission, "Data protection explained" | CC BY 4.0, [legal notice](https://commission.europa.eu/legal-notice_en) |
| `edpb-data-protection-basics.txt` | European Data Protection Board, "Data protection basics" (data protection guide for small business) | reuse authorised when the source is acknowledged and the meaning is not distorted, [copyright notice](https://www.edpb.europa.eu/copyright_en) |
| `edpb-guidelines-07-2020.txt` | European Data Protection Board, Guidelines 07/2020 on the concepts of controller and processor in the GDPR, version 2.1, Part I, sections 2 to 5 | reuse authorised when the source is acknowledged and the meaning is not distorted, [copyright notice](https://www.edpb.europa.eu/copyright_en) |
| `ec-prohibited-practices-guidelines.txt` | European Commission, Guidelines on prohibited artificial intelligence practices, C(2025) 5052 final, sections 2.3 and 2.4 | the Commission's reuse policy, [legal notice](https://commission.europa.eu/legal-notice_en) |
| `ec-blue-guide-2022.txt` | European Commission, The 'Blue Guide' on the implementation of EU product rules 2022, section 3.1 | the Commission's reuse policy, [legal notice](https://commission.europa.eu/legal-notice_en) |

A PDF copy is taken with `pdftotext -layout`, which keeps the hyphen of a compound word broken at a line end, where other modes drop it. In a PDF copy, the footnotes and the number of a page stand between the last line of one page and the first line of the next, so a quote does not cross a page break or a footnote marker.
