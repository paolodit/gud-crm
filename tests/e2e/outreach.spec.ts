import { expect, test, type Page } from "@playwright/test";

async function createCompany(page: Page, name: string, suffix?: string) {
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Create a new opportunity" }).click();
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Opportunity title").fill("HSM retail compliance");
  await page.getByText("Organisation details", { exact: true }).click();
  await page.getByLabel("Company LinkedIn").fill("https://www.linkedin.com/company/example");
  await page.getByRole("button", { name: "Create opportunity", exact: true }).click();
  const panel = page.getByRole("dialog", { name: `${name} opportunity` });
  if (suffix) {
    await panel.getByRole("button", { name: "Add company phone" }).click();
    await page.getByLabel("Company phone (head office or switchboard)").fill(`020 7946 ${suffix}`);
    await page.getByRole("button", { name: "Save company", exact: true }).click();
    await expect(panel.getByRole("link", { name: `Head office · 020 7946 ${suffix}` })).toHaveAttribute("href", `tel:0207946${suffix}`);
  }
  await expect(panel.getByRole("link", { name: "Company LinkedIn" })).toHaveAttribute("href", "https://www.linkedin.com/company/example");
  return page.url();
}

test("guides a manually picked call session and records a follow-up in the CRM", async ({ page }) => {
  test.setTimeout(100_000);
  await page.goto("/outreach");
  await expect(page.getByRole("link", { name: "Outreach", exact: true })).toHaveCount(0);
  await page.goto("/settings");
  const toggle = page.getByLabel("Enable Outreach for this workspace");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.getByRole("link", { name: "Outreach", exact: true })).toBeVisible();

  const first = "DEMO · Outreach Retail A";
  const second = "DEMO · Outreach Retail B";
  await createCompany(page, first, "0951");
  await expect(page.getByRole("link", { name: "Start calling" })).toBeVisible();
  const secondUrl = await createCompany(page, second);
  await expect(page.getByRole("button", { name: "Add website" })).toBeVisible();

  await page.goto("/outreach");
  const query = page.getByRole("searchbox", { name: "Find a company or opportunity" });
  await query.fill(second);
  const company = page.locator(".outreach-company-list > li").filter({ hasText: second });
  await expect(company.getByRole("checkbox")).toBeDisabled();
  await company.getByRole("button", { name: "Review phone details" }).click();
  const contactDetails = company.getByRole("form", { name: `Contact details for ${second}` });
  await expect(contactDetails.getByLabel("Company phone")).toBeFocused();
  await expect(contactDetails.getByRole("link", { name: "Search the web" })).toHaveAttribute("href", /official%20head%20office%20phone/);
  await contactDetails.getByLabel("Company phone").fill("020 7946 0952");
  await contactDetails.getByLabel("Company website").fill("example.com/head-office");
  await contactDetails.getByRole("button", { name: "Save contact details" }).click();
  await expect(company.getByRole("link", { name: "Website", exact: true })).toHaveAttribute("href", "https://example.com/head-office");
  await expect(query).toHaveValue(second);
  await expect(page).toHaveURL(/\/outreach$/);
  await query.clear();
  await page.getByRole("checkbox", { name: new RegExp(second) }).check();
  await page.getByRole("checkbox", { name: new RegExp(first) }).check();
  await page.getByRole("button", { name: "Edit call guide" }).click();
  const guide = page.getByRole("region", { name: "Edit shared call guide" });
  await guide.getByLabel("Gatekeeper opener").fill("Hi, who looks after store compliance across your sites?");
  await guide.getByRole("group", { name: "Objection 4" }).getByLabel("Suggested reply").fill("Which part of the overview would help most?");
  await guide.getByRole("button", { name: "Save call guide" }).click();
  await expect(guide).toHaveCount(0);
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByRole("heading", { name: second })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading", { name: second })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByRole("button", { name: "Prepare call" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /checked this number against/ }).check();
  await page.getByRole("button", { name: "Prepare call" }).click();
  await expect(page.getByRole("link", { name: "Call 020 7946 0952" })).toHaveAttribute("href", "tel:02079460952");
  await expect(page.getByText(/who looks after store compliance across your sites/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Website", exact: true })).toHaveAttribute("href", "https://example.com/head-office");
  await page.getByRole("button", { name: "Decision-maker", exact: true }).click();
  await expect(page.getByText(/Would you have 15 minutes/)).toBeVisible();
  const objection = page.locator(".outreach-objections li").filter({ hasText: "Send me information" });
  await expect(objection.getByText("Which part of the overview would help most?")).toBeVisible();
  await objection.getByRole("button", { name: "Add to outcome" }).click();
  await page.getByRole("button", { name: "Log outcome" }).click();
  await page.getByRole("combobox", { name: "Outcome", exact: true }).selectOption("follow_up");
  await page.getByLabel("Call notes").fill("Asked for the overview.");
  await page.getByLabel("Follow-up task", { exact: true }).fill("Send the HSM overview");
  await page.getByLabel("Follow-up date and time").fill("2027-01-15T10:30");
  await page.route("**/outreach", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(page.locator(".outreach-result").getByRole("alert")).toContainText("Your notes are still here");
  await expect(page.getByLabel("Call notes")).toHaveValue("Asked for the overview.");
  await page.unroute("**/outreach");
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Call saved to the CRM" })).toBeVisible();
  await page.getByRole("button", { name: "Skip company" }).click();
  await expect(page.getByText("1 call logged · 1 skipped")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(secondUrl);
  const savedOpportunity = page.getByRole("dialog", { name: `${second} opportunity` });
  await expect(savedOpportunity.getByText(/Asked for the overview/)).toBeVisible();
  await expect(savedOpportunity.getByText("Send the HSM overview", { exact: true })).toBeVisible();
  await page.goto("/settings");
  await toggle.uncheck();
  await expect(page.getByRole("link", { name: "Outreach", exact: true })).toHaveCount(0);
  expect((await page.goto("/outreach"))?.status()).toBe(404);
});
