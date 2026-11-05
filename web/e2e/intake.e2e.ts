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
// form's note has a word of 60 characters, which the result and the recorded answers must wrap.
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
test("a filled-in form and the answered follow-up questions lead to the result, with the recorded answers below it", async ({
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

  // The result of the gates first, grouped by regulation, then the recorded answers below it, in
  // their own region, since the result has list items of its own.
  await expectScreen(page, "Result");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "GDPR",
    "AI Act",
    "Not checked yet",
    "Recorded answers",
  ]);
  await expect(page.getByRole("region", { name: "GDPR", exact: true }).getByRole("heading", { level: 3 })).toHaveText([
    "Controller",
    "Processor",
  ]);
  await expect(page.getByRole("region", { name: "AI Act", exact: true }).getByRole("heading", { level: 3 })).toHaveText([
    "Provider",
    "High-risk under Annex III",
    "Transparency: people interact with the product",
  ]);
  // The rows of the controller, without the key: no cells for the meaning and the action, and no
  // placeholder (issue #41). At this width each row stacks, with no header row.
  const controller = page.getByRole("region", { name: "Controller", exact: true });
  await expect(controller.getByRole("rowheader")).toHaveCount(9);
  await expect(controller.getByRole("rowheader").first()).toContainText("A legal basis for each purpose");
  await expect(controller.getByRole("cell")).toHaveCount(0);
  await expect(page.getByText("Writing what this means for your product")).toHaveCount(0);
  // At the width of a phone, the list of the results stands in one row above them.
  await expect(
    page.getByRole("navigation", { name: "The results, in short" }).getByRole("link", { name: "Controller (9)" }),
  ).toBeVisible();
  const recorded = page.getByRole("region", { name: "Recorded answers" });
  for (const [, text] of DESCRIPTION) {
    await expect(recorded.getByRole("paragraph").filter({ hasText: text })).toBeVisible();
  }
  await expect(recorded.getByRole("term")).toHaveText([
    "Personal data",
    "Under own name or trademark",
    "Use-case area",
    "Decides why and how personal data is processed",
    "Processes personal data for a customer",
    "Special categories of personal data",
    "Automated decisions about people",
    "Interacts with people",
  ]);
  await expect(recorded.getByRole("definition")).toHaveText([
    "Yes",
    "Not sure",
    "None of these",
    "Yes",
    "No",
    "No",
    "No",
    "Not sure",
  ]);
  // The label, the reason and the note are lines of their own, so the rendered text separates them.
  await expect(recorded.getByRole("listitem")).toHaveText(
    [
      `Under own name or trademark I don't know this about the product Note: ${FORM_NOTE}`,
      `Interacts with people I don't understand the question Note: ${FOLLOW_UP_NOTE}`,
    ],
    { useInnerText: true },
  );

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
