import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "./page";

test("the start page shows the product name", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1, name: "obligations-agent" })).toBeTruthy();
});
