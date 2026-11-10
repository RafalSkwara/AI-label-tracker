import { expect, type Page, test } from "@playwright/test";

// Credentials come from the environment only; never commit them.
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test("password login opens the home page; the Dziś tile renders the dashboard at 390 px", async ({ page }) => {
  test.skip(!email || !password, "set E2E_EMAIL and E2E_PASSWORD");
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email!);
  await page.getByLabel("Hasło").fill(password!);
  await page.getByRole("button", { name: "Zaloguj", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Asystent" })).toBeVisible();
  await page.getByRole("link", { name: /^Dziś/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
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
    // zapasy-only account: sees only its sections and tiles, other routes send it to the home page
    await login(sup, supEmail!, supPassword!);
    await expect(sup.getByRole("heading", { level: 1, name: "Asystent" })).toBeVisible();
    await expect(sup.getByRole("link", { name: "Zapasy", exact: true })).toBeVisible();
    await expect(sup.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(sup.getByRole("link", { name: "Użytkownicy", exact: true })).toHaveCount(0);
    await expect(sup.getByRole("link", { name: /^Pipeline/ })).toHaveCount(0);
    await sup.goto("/dashboard");
    await expect(sup).toHaveURL(/\/$/);
    await sup.goto("/admin/uzytkownicy");
    await expect(sup).toHaveURL(/\/$/);
    await sup.goto("/zapasy");

    // admin: all sections, then /zapasy
    await login(page, email!, password!);
    for (const l of ["Dashboard", "Zakupy", "Zapasy", "Użytkownicy"]) await expect(page.getByRole("link", { name: l, exact: true })).toBeVisible();
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

test("shopping list: create, add, edit, check, remove", async ({ page }) => {
  test.skip(!email || !password, "set E2E_EMAIL and E2E_PASSWORD");
  await login(page, email!, password!);
  await page.getByRole("link", { name: /^Zakupy/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Listy zakupów" })).toBeVisible();

  const list = `E2E ${Date.now()}`;
  await page.getByLabel("Nazwa nowej listy").fill(list);
  await page.getByRole("button", { name: "Utwórz" }).click();
  await expect(page.getByRole("heading", { level: 1, name: list })).toBeVisible();

  await page.getByLabel("Produkt", { exact: true }).fill("Mleko");
  await page.getByLabel("Ilość", { exact: true }).fill("2 l");
  await page.getByRole("button", { name: "Dodaj" }).click();
  // edit the quantity in place
  await page.getByRole("button", { name: "Edytuj: Mleko" }).click();
  await page.getByLabel("Ilość produktu").fill("1 l");
  await page.getByRole("button", { name: "Zapisz" }).click();
  await expect(page.getByRole("button", { name: "Edytuj: Mleko" })).toContainText("1 l");
  await page.getByRole("checkbox", { name: "Mleko" }).check();
  await expect(page.getByRole("region", { name: "Kupione" }).getByRole("checkbox", { name: "Mleko" })).toBeChecked();

  // survives a reload (saved in the database)
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Mleko" })).toBeChecked();
  await page.getByRole("button", { name: "Usuń: Mleko" }).click();
  await expect(page.getByRole("checkbox", { name: "Mleko" })).toHaveCount(0);

  // clean up: archive the test list
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Opcje listy" }).click();
  await page.getByRole("button", { name: "Archiwizuj listę" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Listy zakupów" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(list) })).toHaveCount(0);
});
