import { vi } from "vitest";
import type { Result, Schema } from "./service";

// A schema with two description fields, two form slots and two follow-up slots that are not in
// schema.yaml, and limits other than 500, so that the tests show that the web app follows the
// schema it receives.
export const testSchema = {
  description: [
    { id: "purpose", label: "Purpose", question: "What is the product for?", max_length: 300 },
    { id: "people", label: "People", question: "Who works with the product?", max_length: 200 },
  ],
  slots: [
    {
      id: "uses_camera",
      label: "Camera",
      question: "Does the product use a camera?",
      values: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
        { id: "not_sure", label: "Not sure" },
      ],
    },
    {
      id: "audience",
      label: "Audience",
      question: "Who uses the product?",
      values: [
        { id: "staff", label: "Staff" },
        { id: "public", label: "The public" },
        { id: "not_sure", label: "Not sure" },
      ],
    },
  ],
  follow_up_slots: [
    {
      id: "stores_video",
      label: "Video storage",
      question: "Does the product store video?",
      values: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
        { id: "not_sure", label: "Not sure" },
      ],
    },
    {
      id: "shares_video",
      label: "Video sharing",
      question: "Does the product share video with others?",
      values: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
        { id: "not_sure", label: "Not sure" },
      ],
    },
  ],
} satisfies Schema;

// The fields of a question without an explanation, a meaning, examples and a check line (RESP-6).
export const PLAIN = { explanation: "", meaning: "", examples: [], check: "" };

// A result for the test schema (GATE-4): a gate that applies, with a quote of two lines; a gate
// under it that depends on the open slot of the gate above and on its own slot, which was not
// asked; a listed use; and an assumption and an item not checked, each with a link.
// A type annotation, not satisfies: the gates differ in their answers, and the tests use them as
// results of any gate.
export const testResult: Result = {
  assumptions: [
    {
      text: "The product is a camera system.",
      links: [{ citation: "Rule 1", link: "https://eur-lex.europa.eu/rule#art_1", quote: null }],
    },
  ],
  gates: [
    {
      gate: "audience_rules",
      label: "Audience rules apply",
      status: "conditional",
      result: null,
      derogation: null,
      answers: { audience: "not_sure" },
      conditions: [
        {
          slot: "audience",
          gate: "audience_rules",
          cases: [
            { values: ["staff"], result: "applies" },
            { values: ["public"], result: "does_not_apply" },
          ],
        },
      ],
      quotes: [
        {
          citation: "Rule 2(1)",
          link: "https://eur-lex.europa.eu/rule#002.001:~:text=Staff%20cameras%20are%20covered%3A,door%20cameras%3B",
          quote: "Staff cameras are covered:\n(a) door cameras;",
        },
      ],
    },
    {
      gate: "storage",
      label: "Storage role",
      status: "conditional",
      result: null,
      derogation: null,
      answers: {},
      conditions: [
        {
          slot: "audience",
          gate: "audience_rules",
          cases: [
            { values: ["staff"], result: "conditional" },
            { values: ["public"], result: "does_not_apply" },
          ],
        },
        {
          slot: "stores_video",
          gate: "storage",
          cases: [
            { values: ["yes"], result: "applies" },
            { values: ["no"], result: "does_not_apply" },
          ],
        },
      ],
      quotes: [],
    },
    {
      gate: "camera_list",
      label: "Listed camera use",
      status: "conditional",
      result: "listed_use",
      derogation: "always",
      answers: { uses_camera: "yes", shares_video: "yes" },
      conditions: [],
      quotes: [],
    },
  ],
  not_checked: [
    {
      text: "The exclusions",
      links: [{ citation: "Rule 9", link: "https://eur-lex.europa.eu/rule#art_9", quote: null }],
    },
  ],
};

// Replaces fetch in a test. Each URL gets a response, or an error for fetch to throw.
export function stubFetch(results: Record<string, Response | Error>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const result = results[String(input)];
    if (result === undefined) throw new Error(`No test response for ${String(input)}`);
    if (result instanceof Error) throw result;
    return result.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
