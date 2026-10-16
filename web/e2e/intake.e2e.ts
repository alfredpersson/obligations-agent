import { expect, test } from "@playwright/test";

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
  await page
    .getByRole("textbox", {
      name: "Describe the product in two or three sentences: what it does, who uses it and what data it handles.",
    })
    .fill("An assistant in an online shop that answers questions about orders.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page).toHaveURL(/\/intakes\/[A-Za-z0-9_-]{22}$/);
  await expect(
    page.getByRole("paragraph").filter({
      hasText: "An assistant in an online shop that answers questions about orders.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("term")).toHaveText([
    "Personal data",
    "Under own name or trademark",
    "Use-case area",
  ]);
  await expect(page.getByRole("definition")).toHaveText(["Yes", "Not sure", "None of these"]);
  await expect(page.getByRole("listitem")).toHaveText(["Under own name or trademark"]);
});
