import { vi } from "vitest";
import type { Schema } from "./service";

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
