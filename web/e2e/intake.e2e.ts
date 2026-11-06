import { expect, type Locator, type Page, test } from "@playwright/test";
import { EXAMPLE } from "../app/example";

// The whole flow at the width of a phone, so that every control is used at that width.
test.use({ viewport: { width: 390, height: 844 } });

// The heading of the start page.
const START = "Which parts of the AI Act and the GDPR apply to your AI product?";

// The start of each description question in schema.yaml, and the text to fill in.
const DESCRIPTION = [
  ["What does the product do?", "Answers questions about orders in an online shop."],
  ["Who uses the product?", "The shop's support team. The shop's customers chat with it."],
  ["What data does the product handle?", "Order numbers, and the names and email addresses of customers."],
];

// For each follow-up question that schema.yaml asks after the form answers below, in order: the
// label of its fact, which is the heading of its screen, the start of the question, and the answer
// to choose.
const FOLLOW_UPS = [
  ["Decides why and how personal data is processed", "Do you decide, alone or together with others,", "Yes"],
  ["Processes personal data for a customer", "Do you process personal data on behalf of a customer,", "No"],
  [
    "Special categories of personal data",
    "Does the product process data that shows a person's racial or ethnic origin,",
    "No",
  ],
  [
    "Automated decisions about people",
    "Does the product make decisions about people without a person taking part,",
    "No",
  ],
  ["Interacts with people", "Do people interact with the product directly,", "Not sure"],
];

// The notes of the two "Not sure" answers: on the form, and to the last follow-up question. The
// form's note has a word of 60 characters, which the screen of the answers and the result must wrap.
const FORM_NOTE =
  "We have not decided whose brand goes on the product. See brand_decision_for_the_support_assistant_in_the_online_store.";
const FOLLOW_UP_NOTE = "Does a chat window on the shop's website count?";

// Every screen has the header with the product name, which links to the start page, its heading in
// the main content, and the footer with the line on legal advice, and nothing on it scrolls
// sideways.
async function expectScreen(page: Page, heading: string) {
  await expect(page.getByRole("banner").getByRole("link", { name: "Dutymap" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText(
    "The result maps your answers to articles of the AI Act and the GDPR. It is not legal advice.",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBe(0);
}

// Presses Tab until the element has the focus, ten times at most.
async function tabTo(page: Page, element: Locator) {
  for (let presses = 0; presses < 10; presses++) {
    if (await element.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
}

async function expectOutline(element: Locator) {
  await expect(element).toBeFocused();
  await expect(element).toHaveCSS("outline-style", "solid");
  await expect(element).toHaveCSS("outline-width", "3px");
}

// After a navigation, Next.js keeps the previous page in the document, hidden. The test finds
// elements by role, because role queries skip hidden elements.
test("a filled-in form and the answered follow-up questions lead to the screen of the answers, where a change and a confirmation show the result, and from the result the user answers an open fact and confirms again", async ({
  page,
}) => {
  await page.goto("/");
  await expectScreen(page, START);
  // The first stop of the keyboard is the product name in the header.
  await page.keyboard.press("Tab");
  await expectOutline(page.getByRole("banner").getByRole("link", { name: "Dutymap" }));
  // The start page holds each choice twice, at the top and at the end.
  await page.getByRole("link", { name: "Start with your own product" }).first().click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByRole("textbox", { name: DESCRIPTION[0][0] })).toBeVisible();
  await expectScreen(page, "Describe your product");
  await page
    .getByRole("group", { name: "Does the product process personal data?" })
    .getByRole("radio", { name: "Yes" })
    .check();
  const ownName = page.getByRole("group", {
    name: "Do you place the product on the market or put it into service under your own name or trademark?",
  });
  await ownName.getByRole("radio", { name: "Not sure" }).check();
  await ownName.getByRole("radio", { name: "I don't know this about the product" }).check();
  await ownName.getByRole("textbox", { name: "What do you need to check? (optional)" }).fill(FORM_NOTE);
  await page
    .getByRole("group", { name: "Which of these areas is the product intended to be used in?" })
    .getByRole("radio", { name: "None of these" })
    .check();
  for (const [question, text] of DESCRIPTION) {
    await page.getByRole("textbox", { name: question }).fill(text);
  }
  // From the last text field, Tab moves to the chosen option of the first group, then on to Send
  // through the other groups, the reason and the note.
  await expectOutline(page.getByRole("textbox", { name: DESCRIPTION[2][0] }));
  await page.keyboard.press("Tab");
  await expectOutline(
    page.getByRole("group", { name: "Does the product process personal data?" }).getByRole("radio", { name: "Yes" }),
  );
  const send = page.getByRole("button", { name: "Send" });
  await tabTo(page, send);
  await expectOutline(send);

  // The service's answer waits until the loading message has been checked.
  const checked = Promise.withResolvers<void>();
  await page.route("**/api/intakes", async (route) => {
    await checked.promise;
    await route.continue();
  });
  await send.click();
  await expect(page.getByRole("status")).toHaveText("Writing the next question. This can take several seconds.");
  checked.resolve();

  await expect(page).toHaveURL(/\/intakes\/[A-Za-z0-9_-]{22}$/);
  for (const [label, question, answer] of FOLLOW_UPS) {
    await expectScreen(page, label);
    const group = page.getByRole("group", { name: question });
    // Exact names, because "No" is also part of "Not sure".
    await group.getByRole("radio", { name: answer, exact: true }).check();
    if (answer === "Not sure") {
      await group.getByRole("radio", { name: "I don't understand the question" }).check();
      await group
        .getByRole("textbox", { name: "What is unclear about the question? (optional)" })
        .fill(FOLLOW_UP_NOTE);
    }
    await page.getByRole("button", { name: "Next" }).click();
  }

  // The screen of the answers in place of the questions (issue #50): the open facts first, then the
  // answered facts, each with its label and its answer; a "not sure" answer with its reason and its
  // note, each in a line of its own.
  await expect(page).toHaveURL(/\/intakes\/[A-Za-z0-9_-]{22}\/answers$/);
  await expectScreen(page, "Check your answers");
  const open = page.getByRole("region", { name: "Open answers" });
  await expect(open.getByRole("term")).toHaveText(["Under own name or trademark", "Interacts with people"]);
  await expect(open.getByRole("definition")).toHaveText([
    "Not sure · I don't know this about the product",
    `Note: ${FORM_NOTE}`,
    "Answer",
    "Not sure · I don't understand the question",
    `Note: ${FOLLOW_UP_NOTE}`,
    "Answer",
  ]);
  const answered = page.getByRole("region", { name: "Your answers" });
  await expect(answered.getByRole("term")).toHaveText([
    "Personal data",
    "Use-case area",
    "Decides why and how personal data is processed",
    "Processes personal data for a customer",
    "Special categories of personal data",
    "Automated decisions about people",
  ]);
  await expect(answered.getByRole("definition")).toHaveText(
    ["Yes", "None of these", "Yes", "No", "No", "No"].flatMap((answer) => [answer, "Change"]),
  );
  // The description, folded under its link.
  await page.getByText("Show your description").click();
  for (const [, text] of DESCRIPTION) {
    await expect(page.getByRole("definition").filter({ hasText: text })).toBeVisible();
  }

  // A change: the fact's question as its own screen, with the current answer chosen.
  await page.getByRole("link", { name: "Change Processes personal data for a customer" }).click();
  await expect(page).toHaveURL(/\/answers\?change=processes_for_customer$/);
  await expectScreen(page, "Processes personal data for a customer");
  const processes = page.getByRole("group", { name: "Do you process personal data on behalf of a customer," });
  await expect(processes.getByRole("radio", { name: "No", exact: true })).toBeChecked();
  await processes.getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("button", { name: "Save the answer" }).click();
  await expect(page).toHaveURL(/\/answers#processes_for_customer$/);
  await expectScreen(page, "Check your answers");
  await expect(page.locator("#processes_for_customer").getByRole("definition").first()).toHaveText("Yes");

  // The confirmation: the result in three parts (issue #51), with the way back to the answers in
  // place of the recorded answers.
  await page.getByRole("button", { name: "Confirm and show the result" }).click();
  await expect(page).toHaveURL(/\/intakes\/[A-Za-z0-9_-]{22}$/);
  await expectScreen(page, "Result");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "What applies",
    "Answers to check",
    "What may also apply",
    "Not checked yet",
  ]);
  // What applies, grouped by regulation: the provider and the transparency depend on the open
  // answers, so they stand in the other parts.
  const applies = page.getByRole("region", { name: "What applies" });
  await expect(applies.getByRole("region", { name: "GDPR", exact: true }).getByRole("heading", { level: 4 })).toHaveText([
    "Controller",
    "Processor",
  ]);
  await expect(applies.getByRole("region", { name: "AI Act", exact: true }).getByRole("heading", { level: 4 })).toHaveText([
    "High-risk under Annex III",
  ]);
  // The rows of the controller, without the key: each row's label and no action, and no
  // placeholder (issue #41); its clause in its details.
  const controller = page.getByRole("region", { name: "Controller", exact: true });
  await expect(controller.getByRole("listitem")).toHaveCount(9);
  const legalBasis = controller.getByRole("listitem").first();
  await expect(legalBasis).toContainText("A legal basis for each purpose");
  // Its category from gates.yaml, as a tag after the label, since without the key it has no action (#52).
  await expect(legalBasis.getByText("Legal", { exact: true })).toBeVisible();
  await expect(page.getByText("Writing what this means for your product")).toHaveCount(0);
  await expect(legalBasis.getByRole("link", { name: "GDPR Article 6(1)" })).toHaveCount(0);
  await legalBasis.getByRole("button", { name: "Details" }).click();
  await expect(legalBasis.getByRole("link", { name: "GDPR Article 6(1)" })).toBeVisible();
  // The changed answer: the processor applies, with its rows.
  const processor = page.getByRole("region", { name: "Processor", exact: true });
  await expect(processor.getByRole("paragraph").first()).toContainText("Applies.");
  await expect(processor.getByRole("listitem")).toHaveCount(4);
  // At the width of a phone, the list of the results stands in one row above them.
  await expect(
    page.getByRole("navigation", { name: "The results, in short" }).getByRole("link", { name: "Controller (9)" }),
  ).toBeVisible();
  // The answers to check, the one that two rows depend on first, each with its reason and its note,
  // and a link to its place on the screen of the answers.
  const check = page.getByRole("region", { name: "Answers to check" });
  await expect(check.getByRole("heading", { level: 3 })).toHaveText(["Under own name or trademark", "Interacts with people"]);
  await expect(check.getByRole("region", { name: "Under own name or trademark" })).toContainText(
    `Not sure · I don't know this about the product`,
  );
  await expect(check.getByRole("region", { name: "Under own name or trademark" })).toContainText(`Note: ${FORM_NOTE}`);
  await expect(check.getByRole("region", { name: "Interacts with people" })).toContainText(`Note: ${FOLLOW_UP_NOTE}`);
  await expect(
    check.getByRole("link", { name: "Answer Interacts with people on the screen of the answers" }),
  ).toHaveAttribute("href", /\/intakes\/[A-Za-z0-9_-]{22}\/answers#interacts_with_people$/);
  // What may also apply: the provider's row and the row of the transparency under the first answer,
  // the second naming the other one.
  const mayAlso = page.getByRole("region", { name: "What may also apply" }).getByRole("region", { name: "Under own name or trademark" });
  await expect(mayAlso.getByRole("heading", { level: 4 })).toHaveText(["Provider", "Transparency: people interact with the product"]);
  await expect(mayAlso.getByRole("region", { name: "Transparency: people interact with the product" })).toContainText(
    "Each of these also depends on the open answer about Interacts with people.",
  );

  // Back to the answers: the open fact under own name answered, then a second confirmation.
  await page.getByRole("link", { name: "Check or change the answers" }).click();
  await expectScreen(page, "Check your answers");
  await page.getByRole("link", { name: "Answer Under own name or trademark" }).click();
  await expectScreen(page, "Under own name or trademark");
  const ownNameAgain = page.getByRole("group", {
    name: "Do you place the product on the market or put it into service under your own name or trademark?",
  });
  await expect(ownNameAgain.getByRole("radio", { name: "Not sure" })).toBeChecked();
  await expect(ownNameAgain.getByRole("textbox")).toHaveValue(FORM_NOTE);
  await ownNameAgain.getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("button", { name: "Save the answer" }).click();
  await expectScreen(page, "Check your answers");
  await expect(page.getByRole("region", { name: "Open answers" }).getByRole("term")).toHaveText(["Interacts with people"]);
  await page.getByRole("button", { name: "Confirm and show the result" }).click();
  await expectScreen(page, "Result");
  const provider = page.getByRole("region", { name: "What applies" }).getByRole("region", { name: "Provider", exact: true });
  await expect(provider.getByRole("paragraph").first()).toContainText("Applies.");
  await expect(provider.getByRole("listitem")).toHaveCount(1);

  // The next intake starts on an empty form, although Next.js keeps the form's page with its state.
  await page.getByRole("banner").getByRole("link", { name: "Dutymap" }).click();
  await expectScreen(page, START);
  await page.getByRole("link", { name: "Start with your own product" }).first().click();
  await expectScreen(page, "Describe your product");
  for (const [question] of DESCRIPTION) {
    await expect(page.getByRole("textbox", { name: question })).toHaveValue("");
  }
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
});

// Only this test opens the form with the example on the schema of the service, so it shows that the
// example's ids are the ids of schema.yaml.
test("the example product opens the form with its three texts and its three answers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Use the example product" }).first().click();
  await expect(page).toHaveURL(/\/example$/);
  await expectScreen(page, "Example product");
  const texts = [
    [DESCRIPTION[0][0], EXAMPLE.description.what_it_does],
    [DESCRIPTION[1][0], EXAMPLE.description.who_uses_it],
    [DESCRIPTION[2][0], EXAMPLE.description.data_it_handles],
  ];
  for (const [question, text] of texts) {
    await expect(page.getByRole("textbox", { name: question })).toHaveValue(text);
  }
  // The question of each form fact in schema.yaml, and the label of the example's answer.
  const answers = [
    ["Does the product process personal data?", "Yes"],
    ["Do you place the product on the market or put it into service under your own name or trademark?", "Yes"],
    [
      "Which of these areas is the product intended to be used in?",
      "Employment, workers' management and access to self-employment",
    ],
  ];
  for (const [question, label] of answers) {
    await expect(
      page.getByRole("group", { name: question }).getByRole("radio", { checked: true }),
    ).toHaveAccessibleName(label);
  }
});
