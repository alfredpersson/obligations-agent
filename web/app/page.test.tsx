import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import Home from "./page";

// The start page holds the form, which needs the router and loads the schema. The fetch never
// answers, so the form stays in its loading state.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

test("the start page shows the product name", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1, name: "obligations-agent" })).toBeTruthy();
});
