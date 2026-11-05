import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WRITING } from "../../loading-status";
import type { Question, Step } from "../../service";
import { PLAIN, stubFetch } from "../../testing";
import FollowUpQuestion from "./follow-up-question";

const ID = "kq2V8yZx0bP4mT7nLw3sAg";
const ANSWERS_URL = `/api/intakes/${ID}/answers`;

// The text and the option labels differ from the test schema: the screen shows those of the step.
const question = {
  type: "question",
  number: 2,
  slot: "stores_video",
  text: "Is video from the camera kept after it is shown?",
  options: [
    { value: "yes", label: "Yes, it is kept" },
    { value: "no", label: "No, it is not kept" },
    { value: "not_sure", label: "Not sure" },
  ],
  ...PLAIN,
} satisfies Question;

// The model writes the labels, so the screen finds the option "not sure" by its value.
const unsure = {
  ...question,
  options: [
    { value: "yes", label: "Yes, it is kept" },
    { value: "no", label: "No, it is not kept" },
    { value: "not_sure", label: "I don't know" },
  ],
} satisfies Question;

const CAMERA_GUIDANCE = {
  id: "camera_guidance",
  title: "Camera guidance",
  body: "European Data Protection Board",
  link: "https://example.org/camera-guidance",
  checked: "2026-10-28",
  note: null,
};

const PRODUCT_RULES = {
  id: "product_rules",
  title: "Product rules guide",
  body: "European Commission",
  link: "https://example.org/product-rules",
  checked: "2026-10-28",
  note: "EU product rules, written for goods.",
};

const KEPT = "Examples of video that is kept";

// A question with every part (RESP-5, RESP-6): an explanation, two groups of examples, a check line
// and a meaning. The first group has three entries in an order that is not that of their ids: one
// from a source with a note, then two from the camera guidance, where the heading of the first
// entry's last quote goes on into the second entry. The second group starts with an entry from the
// camera guidance under the heading that the first group shows last, then has an entry from the
// other source under the same heading.
const full = {
  ...question,
  explanation: "Video is kept when the product stores it after it is shown, for any length of time.",
  meaning: "Yes means that the product stores some video. No means that it stores none.",
  examples: [
    {
      line: "Your description mentions a shop, a door camera and backups.",
      entries: [
        {
          id: "m_shop",
          quotes: [{ heading: "Products", text: "a camera that a shop sells" }],
          source: PRODUCT_RULES,
        },
        {
          id: "z_doorbell",
          quotes: [
            {
              heading: "Examples of video that is not kept",
              text: "a live picture that is shown and then deleted",
            },
            { heading: KEPT, text: "a recording that a doorbell saves for a day" },
          ],
          source: CAMERA_GUIDANCE,
        },
        {
          id: "a_backup",
          quotes: [
            { heading: KEPT, text: "a copy in a backup" },
            { heading: KEPT, text: "a clip sent to a phone" },
          ],
          source: CAMERA_GUIDANCE,
        },
      ],
    },
    {
      line: "Your note mentions a phone and a shop camera.",
      entries: [
        {
          id: "k_phone",
          quotes: [{ heading: KEPT, text: "a clip on the owner's phone" }],
          source: CAMERA_GUIDANCE,
        },
        {
          id: "p_shop_camera",
          quotes: [{ heading: KEPT, text: "a recording that a shop camera keeps for a week" }],
          source: PRODUCT_RULES,
        },
      ],
    },
  ],
  check: "Check whether the product keeps a copy of the video on the device.",
} satisfies Question;

const EXAMPLES = "Examples from official guidance (not law)";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The question screen's use of the component: the answer to the question's number, the button Next,
// and the next step for onStep.
function renderQuestion(shown: Question, onStep: (step: Step) => void = vi.fn()) {
  return render(
    <FollowUpQuestion
      question={shown}
      request={{ url: `/api/intakes/${ID}/answers`, method: "POST", body: { question: shown.number } }}
      button="Next"
      waiting={WRITING}
      onSent={(sent) => onStep((sent as { step: Step }).step)}
    />,
  );
}

function choice(label: string) {
  const group = screen.getByRole("group", { name: question.text });
  return within(group).getByRole("radio", { name: label }) as HTMLInputElement;
}

function nextButton() {
  return screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
}

function reason(label: string) {
  const group = screen.getByRole("group", { name: "Why are you not sure?" });
  return within(group).getByRole("radio", { name: label }) as HTMLInputElement;
}

function note() {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

test("the question shows its text and the options of the step, none selected, and Next is disabled until a choice is selected", () => {
  renderQuestion(question);

  const radios = within(screen.getByRole("group", { name: question.text })).getAllByRole(
    "radio",
  ) as HTMLInputElement[];
  expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual([
    "Yes, it is kept",
    "No, it is not kept",
    "Not sure",
  ]);
  expect(radios.map((radio) => radio.checked)).toEqual([false, false, false]);
  expect(nextButton().disabled).toBe(true);

  fireEvent.click(choice("No, it is not kept"));
  expect(nextButton().disabled).toBe(false);
});

test("a sent answer posts the question number and the value of the choice, and passes on the step of the response", async () => {
  const next = {
    type: "question",
    number: 3,
    slot: "shares_video",
    text: "Does the product share video with others?",
    options: [{ value: "not_sure", label: "Not sure" }],
    ...PLAIN,
  } satisfies Question;
  const fetchMock = stubFetch({ [ANSWERS_URL]: Response.json({ step: next }) });
  const onStep = vi.fn();
  renderQuestion(question, onStep);

  fireEvent.click(choice("No, it is not kept"));
  fireEvent.click(nextButton());

  await waitFor(() => expect(onStep).toHaveBeenCalledWith(next));
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe(ANSWERS_URL);
  expect(init?.method).toBe("POST");
  // The service refuses a JSON body without this header.
  expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(String(init?.body))).toEqual({ question: 2, value: "no" });
});

test("Next is disabled while the answer is sent, so that a second click sends nothing", async () => {
  const { promise, reject } = Promise.withResolvers<Response>();
  const fetchMock = vi.fn<typeof fetch>(() => promise);
  vi.stubGlobal("fetch", fetchMock);
  renderQuestion(question);
  fireEvent.click(choice("Yes, it is kept"));

  fireEvent.click(nextButton());
  await waitFor(() => expect(nextButton().disabled).toBe(true));
  fireEvent.click(nextButton());
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // After a failure, Next can be used again.
  reject(new TypeError("fetch failed"));
  await screen.findByRole("alert");
  await waitFor(() => expect(nextButton().disabled).toBe(false));
});

test("while the answer is sent, the status after Next says that the next question is being written, and it is empty again after an error", async () => {
  const sent = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(() => sent.promise));
  renderQuestion(question);
  // The status is in the page, empty, before the wait, so that screen readers announce its message.
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("");
  expect(status.previousElementSibling).toBe(nextButton());

  fireEvent.click(choice("Yes, it is kept"));
  fireEvent.click(nextButton());
  await waitFor(() => expect(status.textContent).toBe("Writing the next question. This can take several seconds."));

  sent.reject(new TypeError("fetch failed"));
  await screen.findByRole("alert");
  await waitFor(() => expect(status.textContent).toBe(""));
  expect(screen.getByRole("status")).toBe(status);
});

test.each([
  ["a 500 response", new Response(null, { status: 500 })],
  [
    "a 422 response",
    Response.json({ error: { code: "invalid_value", field: "value" } }, { status: 422 }),
  ],
  ["a fetch that fails", new TypeError("fetch failed")],
])("when sending fails (%s), a message shows and the choice, the reason and the note stay", async (_, result) => {
  stubFetch({ [ANSWERS_URL]: result });
  const onStep = vi.fn();
  renderQuestion(question, onStep);
  fireEvent.click(choice("Not sure"));
  fireEvent.click(reason("I don't understand the question"));
  fireEvent.change(note(), { target: { value: "Which video?" } });

  fireEvent.click(nextButton());

  expect((await screen.findByRole("alert")).textContent).not.toBe("");
  expect(choice("Not sure").checked).toBe(true);
  expect(reason("I don't understand the question").checked).toBe(true);
  expect(note().value).toBe("Which video?");
  expect(onStep).not.toHaveBeenCalled();
});

test("the option with the value not_sure, whatever its label, shows the two reasons below the options, none chosen, until another option is chosen", () => {
  renderQuestion(unsure);
  expect(screen.queryByRole("group", { name: "Why are you not sure?" })).toBeNull();

  fireEvent.click(choice("I don't know"));

  const group = within(screen.getByRole("group", { name: question.text })).getByRole("group", {
    name: "Why are you not sure?",
  });
  expect(choice("I don't know").compareDocumentPosition(group)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
  expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual([
    "I don't understand the question",
    "I don't know this about the product",
  ]);
  expect(radios.map((radio) => radio.checked)).toEqual([false, false]);

  fireEvent.click(choice("No, it is not kept"));
  expect(screen.queryByRole("group", { name: "Why are you not sure?" })).toBeNull();
});

test("a note field of at most 500 characters appears once a reason is chosen, with a label that follows the reason", () => {
  renderQuestion(unsure);
  fireEvent.click(choice("I don't know"));
  expect(screen.queryByRole("textbox")).toBeNull();

  fireEvent.click(reason("I don't understand the question"));
  const unclear = screen.getByRole("textbox", {
    name: "What is unclear about the question? (optional)",
  }) as HTMLTextAreaElement;
  expect(unclear.maxLength).toBe(500);
  fireEvent.change(unclear, { target: { value: "Which video?" } });

  // The label changes with the reason, and the text stays.
  fireEvent.click(reason("I don't know this about the product"));
  expect(screen.getAllByRole("textbox")).toEqual([
    screen.getByRole("textbox", { name: "What do you need to check? (optional)" }),
  ]);
  expect(note().value).toBe("Which video?");
});

test("Next stays disabled after the option not_sure until a reason is chosen, and the note is optional", () => {
  renderQuestion(unsure);
  fireEvent.click(choice("I don't know"));
  expect(nextButton().disabled).toBe(true);

  fireEvent.click(reason("I don't know this about the product"));
  expect(nextButton().disabled).toBe(false);
});

test("a not_sure answer posts its reason and its note", async () => {
  const fetchMock = stubFetch({
    [ANSWERS_URL]: Response.json({ step: { type: "ready_to_confirm" } }),
  });
  const onStep = vi.fn();
  renderQuestion(unsure, onStep);
  fireEvent.click(choice("I don't know"));
  fireEvent.click(reason("I don't understand the question"));
  fireEvent.change(note(), { target: { value: "Which video?" } });

  fireEvent.click(nextButton());

  await waitFor(() => expect(onStep).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    question: 2,
    value: "not_sure",
    not_sure: { reason: "unclear", note: "Which video?" },
  });
});

test("the reason and the note stay while another option is chosen, and another answer posts neither", async () => {
  const fetchMock = stubFetch({
    [ANSWERS_URL]: Response.json({ step: { type: "ready_to_confirm" } }),
  });
  const onStep = vi.fn();
  renderQuestion(unsure, onStep);
  fireEvent.click(choice("I don't know"));
  fireEvent.click(reason("I don't understand the question"));
  fireEvent.change(note(), { target: { value: "Which video?" } });
  fireEvent.click(choice("No, it is not kept"));
  fireEvent.click(choice("I don't know"));
  expect(reason("I don't understand the question").checked).toBe(true);
  expect(note().value).toBe("Which video?");
  fireEvent.click(choice("No, it is not kept"));

  fireEvent.click(nextButton());

  await waitFor(() => expect(onStep).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ question: 2, value: "no" });
});

test("the explanation, the examples and the check line come first, then the question with its meaning directly above the options", () => {
  const { container } = renderQuestion(full);

  const form = container.querySelector("form") as HTMLFormElement;
  const group = screen.getByRole("group", { name: full.text });
  expect([...form.children].map((child) => child.tagName)).toEqual([
    "P",
    "SECTION",
    "P",
    "FIELDSET",
    "DIV",
  ]);
  expect(form.children[0].textContent).toBe(full.explanation);
  expect(form.children[1]).toBe(screen.getByRole("region", { name: EXAMPLES }));
  expect(form.children[2].textContent).toBe(full.check);
  expect(form.children[3]).toBe(group);
  // Next and its status in one row.
  expect([...form.children[4].children]).toEqual([nextButton(), screen.getByRole("status")]);
  const meaning = group.querySelector("legend")?.nextElementSibling;
  expect(meaning?.textContent).toBe(full.meaning);
  expect(meaning?.nextElementSibling?.querySelector("input[type=radio]")).toBeTruthy();
});

test("a question without an explanation, examples, a check line and a meaning shows only its options and Next", () => {
  const { container } = renderQuestion(question);

  const form = container.querySelector("form") as HTMLFormElement;
  expect([...form.children].map((child) => child.tagName)).toEqual(["FIELDSET", "DIV"]);
  expect([...form.children[1].children]).toEqual([nextButton(), screen.getByRole("status")]);
  expect(form.querySelector("legend")?.nextElementSibling?.querySelector("input[type=radio]")).toBeTruthy();
});

test("the examples show the line of each group once, as a heading above the quotes of all its entries, in the step's order, and no side", () => {
  renderQuestion(full);

  const region = screen.getByRole("region", { name: EXAMPLES });
  // The lines and the quotes in the order of the document: each line once, above the quotes of all
  // the entries of its group.
  expect([...region.querySelectorAll("h3, blockquote")].map((element) => element.textContent)).toEqual([
    "Your description mentions a shop, a door camera and backups.",
    "a camera that a shop sells",
    "a live picture that is shown and then deleted",
    "a recording that a doorbell saves for a day",
    "a copy in a backup",
    "a clip sent to a phone",
    "Your note mentions a phone and a shop camera.",
    "a clip on the owner's phone",
    "a recording that a shop camera keeps for a week",
  ]);
  expect(region.textContent).not.toMatch(/sided/i);
});

test("each group of examples is one element, from its line to its last source line, so that the screen can show it as a card", () => {
  renderQuestion(full);

  const region = screen.getByRole("region", { name: EXAMPLES });
  const groups = within(region)
    .getAllByRole("heading", { level: 3 })
    .map((line) => line.parentElement as HTMLElement);
  expect(groups.map((group) => group.parentElement)).toEqual([region, region]);
  expect(groups.map((group) => group.firstElementChild?.textContent)).toEqual([
    "Your description mentions a shop, a door camera and backups.",
    "Your note mentions a phone and a shop camera.",
  ]);
  expect(groups.map((group) => within(group).getAllByRole("blockquote").length)).toEqual([5, 2]);
  expect(groups.map((group) => group.lastElementChild?.querySelector("a")?.textContent)).toEqual([
    "Camera guidance",
    "Product rules guide",
  ]);
});

test("inside a group a heading shows once for quotes in a row that share it, also across entries, and again after the source line of another source and in the next group", () => {
  renderQuestion(full);

  const region = screen.getByRole("region", { name: EXAMPLES });
  const quotes = within(region).getAllByRole("blockquote");
  // What stands directly before each quote: its heading, or the quote before it.
  expect(quotes.map((quote) => quote.previousElementSibling?.textContent)).toEqual([
    "Products",
    "Examples of video that is not kept",
    KEPT,
    "a recording that a doorbell saves for a day",
    "a copy in a backup",
    KEPT,
    KEPT,
  ]);
});

test("inside a group the source line shows once, after the quotes of entries in a row from the same source, and the next group shows it again", () => {
  renderQuestion(full);

  const region = screen.getByRole("region", { name: EXAMPLES });
  const quotes = within(region).getAllByRole("blockquote");
  // The source linked directly after each quote, if any.
  expect(
    quotes.map((quote) => quote.nextElementSibling?.querySelector("a")?.textContent ?? null),
  ).toEqual([
    "Product rules guide",
    null,
    null,
    null,
    "Camera guidance",
    "Camera guidance",
    "Product rules guide",
  ]);
  expect(within(region).getAllByRole("link")).toHaveLength(4);
});

test("the source line gives the body, the title as a link that opens in a new tab, the note where the source has one, and the date its quotes were checked", () => {
  renderQuestion(full);

  const region = screen.getByRole("region", { name: EXAMPLES });
  const [camera] = within(region).getAllByRole("link", { name: "Camera guidance" });
  expect(camera.getAttribute("href")).toBe("https://example.org/camera-guidance");
  expect(camera.getAttribute("target")).toBe("_blank");
  expect(camera.getAttribute("rel")).toBe("noreferrer");
  expect(camera.parentElement?.textContent).toBe(
    "European Data Protection Board, Camera guidance, checked 2026-10-28",
  );
  const [rules] = within(region).getAllByRole("link", { name: "Product rules guide" });
  expect(rules.parentElement?.textContent).toBe(
    "European Commission, Product rules guide (EU product rules, written for goods.), checked 2026-10-28",
  );
  expect(region.textContent).not.toMatch(/\bsource\b/i);
});

test("the group of the options is named by the question and described by its meaning, and has no description without a meaning", () => {
  renderQuestion(full);

  expect(screen.getByRole("group", { name: full.text, description: full.meaning })).toBeTruthy();
  cleanup();

  renderQuestion(question);

  expect(screen.getByRole("group", { name: question.text }).hasAttribute("aria-describedby")).toBe(false);
});
