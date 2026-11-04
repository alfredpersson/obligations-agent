import { expect, type Locator, type Page, test } from "@playwright/test";

// The whole flow at the width of a phone, so that every control is used at that width.
test.use({ viewport: { width: 390, height: 844 } });

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

// Every screen has the header with the product name, which links to the start page, and its heading
// in the main content, and nothing on it scrolls sideways.
async function expectScreen(page: Page, heading: string) {
  await expect(page.getByRole("banner").getByRole("link", { name: "obligations-agent" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: heading })).toBeVisible();
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
  await expect(page.getByRole("textbox", { name: DESCRIPTION[0][0] })).toBeVisible();
  await expectScreen(page, "obligations-agent");
  // The first stop of the keyboard is the product name in the header.
  await page.keyboard.press("Tab");
  await expectOutline(page.getByRole("banner").getByRole("link", { name: "obligations-agent" }));
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

  // The result of the gates first, then the recorded answers below it, in their own region, since
  // the result has list items of its own.
  await expectScreen(page, "Result");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "GDPR applies",
    "Controller",
    "Processor",
    "Provider",
    "High-risk under Annex III",
    "Transparency: people interact with the product",
    "Not checked yet",
    "Recorded answers",
  ]);
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
});
