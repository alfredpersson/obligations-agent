import { expect, test } from "@playwright/test";

// The start of each description question in schema.yaml, and the text to fill in.
const DESCRIPTION = [
  ["What does the product do?", "Answers questions about orders in an online shop."],
  ["Who uses the product?", "The shop's support team. The shop's customers chat with it."],
  ["What data does the product handle?", "Order numbers, and the names and email addresses of customers."],
];

// After a navigation, Next.js keeps the previous page in the document, hidden. The test finds
// elements by role, because role queries skip hidden elements.
test("a filled-in form leads to the screen with the recorded answers", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("group", { name: "Does the product process personal data?" })
    .getByRole("radio", { name: "Yes" })
    .check();
  await page
    .getByRole("group", {
      name: "Do you place the product on the market or put it into service under your own name or trademark?",
    })
    .getByRole("radio", { name: "Not sure" })
    .check();
  await page
    .getByRole("group", { name: "Which of these areas is the product intended to be used in?" })
    .getByRole("radio", { name: "None of these" })
    .check();
  for (const [question, text] of DESCRIPTION) {
    await page.getByRole("textbox", { name: question }).fill(text);
  }
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page).toHaveURL(/\/intakes\/[A-Za-z0-9_-]{22}$/);
  for (const [, text] of DESCRIPTION) {
    await expect(page.getByRole("paragraph").filter({ hasText: text })).toBeVisible();
  }
  await expect(page.getByRole("term")).toHaveText([
    "Personal data",
    "Under own name or trademark",
    "Use-case area",
  ]);
  await expect(page.getByRole("definition")).toHaveText(["Yes", "Not sure", "None of these"]);
  await expect(page.getByRole("listitem")).toHaveText(["Under own name or trademark"]);
});
