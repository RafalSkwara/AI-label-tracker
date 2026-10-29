import { expect, type Page, test } from "@playwright/test";

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

const supEmail = process.env.E2E_SUPPLIES_EMAIL;
const supPassword = process.env.E2E_SUPPLIES_PASSWORD;

async function login(page: Page, mail: string, pass: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(mail);
  await page.getByLabel("Hasło").fill(pass);
  await page.getByRole("button", { name: "Zaloguj", exact: true }).click();
}

test("roles protect routes; supplies check syncs between two accounts", async ({ page, browser }) => {
  test.skip(!email || !password || !supEmail || !supPassword, "set E2E_EMAIL, E2E_PASSWORD, E2E_SUPPLIES_EMAIL and E2E_SUPPLIES_PASSWORD");
  const { baseURL, viewport } = test.info().project.use;
  const supCtx = await browser.newContext({ baseURL, viewport });
  const sup = await supCtx.newPage();
  let name = "";
  try {
    // zapasy-only account: lands on /zapasy, sees only that section, cannot open the others
    await login(sup, supEmail!, supPassword!);
    await expect(sup).toHaveURL(/\/zapasy$/);
    await expect(sup.getByRole("link", { name: "Zapasy" })).toBeVisible();
    await expect(sup.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(sup.getByRole("link", { name: "Użytkownicy" })).toHaveCount(0);
    await sup.goto("/");
    await expect(sup).toHaveURL(/\/zapasy$/);
    await sup.goto("/admin/uzytkownicy");
    await expect(sup).toHaveURL(/\/zapasy$/);

    // admin: all three sections, then /zapasy
    await login(page, email!, password!);
    for (const l of ["Dashboard", "Zapasy", "Użytkownicy"]) await expect(page.getByRole("link", { name: l })).toBeVisible();
    await page.goto("/zapasy");

    // check an item as the supplies user, expect it checked for the admin within 5 s
    const first = sup.getByRole("region", { name: "A: niezbędne" }).getByRole("checkbox", { checked: false }).first();
    name = (await first.getAttribute("aria-label"))!;
    await first.check();
    await expect(page.getByRole("checkbox", { name })).toBeChecked({ timeout: 5000 });
  } finally {
    // restore the state from the admin side and expect the supplies user to see it unchecked
    if (name) {
      await page.getByRole("checkbox", { name }).uncheck();
      await expect(sup.getByRole("checkbox", { name })).not.toBeChecked({ timeout: 5000 });
    }
    await supCtx.close();
  }
});
