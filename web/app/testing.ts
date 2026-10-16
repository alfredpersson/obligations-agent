import { vi } from "vitest";

// A schema with two slots that are not in schema.yaml, and a limit other than 1500, so that the
// tests show that the web app follows the schema it receives.
export const testSchema = {
  description: { label: "Description", question: "What does the product do?", max_length: 300 },
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
