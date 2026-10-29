import { expect, test } from "@playwright/test";

// Credentials come from the environment only; never commit them.
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test("password login renders Dziś at 390 px", async ({ page }) => {
  test.skip(!email || !password, "set E2E_EMAIL and E2E_PASSWORD");
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email!);
  await page.getByLabel("Hasło").fill(password!);
  await page.getByRole("button", { name: "Zaloguj", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Side Hustle Assistant" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Dziś" })).toBeVisible();
  await expect(page.getByLabel("Alerty")).toBeVisible();
  await expect(page.getByLabel("Bramki")).toBeVisible();
});
