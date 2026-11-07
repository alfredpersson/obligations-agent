import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { EXAMPLE } from "./example";

// The fact schema: the ids of the slots on the form, in their order (FACT-3), and the length of
// each description field.
const SCHEMA = readFileSync(`${import.meta.dirname}/../../api/src/obligations_agent/schema.yaml`, "utf8");
const FORM = [...SCHEMA.matchAll(/^ {2}- id: (\w+)\n(?: {4}.*\n)*? {4}relevant: always$/gm)].map(([, id]) => id);

// The example product of the start page (issue #40), as issue #45 changes it: the company's own
// recruiters use it for its clients' jobs, and it writes a short summary of why each candidate
// matches, so that both the deployer and the marking of generated content apply.
test("the example product answers each question of the form, uses the product itself, and writes a summary of each match", () => {
  expect(FORM).toEqual(["personal_data", "under_own_name", "use_case_area", "own_use"]);
  expect(Object.keys(EXAMPLE.answers)).toEqual(FORM);
  expect(EXAMPLE.answers.own_use).toBe("yes");
  expect(EXAMPLE.description.what_it_does).toBe(
    "Ranks candidates for an open job. A recruiter enters the job's requirements, and the product compares them with the CVs and profiles in the candidate database, lists the best matches with the parts of each CV that match, and writes a short summary of why each candidate matches.",
  );
  expect(EXAMPLE.description.who_uses_it).toBe(
    "Our own recruiters use it to find candidates for our clients' open jobs. The candidates do not use the product, but it ranks them.",
  );
  for (const text of Object.values(EXAMPLE.description)) expect(text.length).toBeLessThanOrEqual(500);
});
