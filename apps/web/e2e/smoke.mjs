/**
 * Phase 11E browser smoke for the real local development topology.
 *
 * Prerequisites: PostgreSQL running, migrated, seeded, permissions synced,
 * API on :4000, and Web on :5173. This remains manual/CI-optional and is not
 * part of the API integration-test count.
 *
 * Usage: npm run e2e -w apps/web
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import playwright from "playwright";

const { chromium } = playwright;
const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? join(tmpdir(), "abixell-one-e2e-screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const unexpectedDiagnostics = [];
const expectedHttpFailures = [];
let step = 0;

function expectHttpFailure(pathname, status) {
  expectedHttpFailures.push({ pathname, status });
}

page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().startsWith("Failed to load resource: the server responded with a status of")
  ) {
    unexpectedDiagnostics.push(`console: ${message.text()}`);
  }
});
page.on("pageerror", (error) => {
  unexpectedDiagnostics.push(`pageerror: ${error.message}`);
});
page.on("requestfailed", (request) => {
  unexpectedDiagnostics.push(
    `requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
  );
});
page.on("response", (response) => {
  if (response.status() < 400) return;
  const pathname = new URL(response.url()).pathname;
  const expectedIndex = expectedHttpFailures.findIndex(
    (expected) => expected.pathname === pathname && expected.status === response.status(),
  );
  if (expectedIndex >= 0) {
    expectedHttpFailures.splice(expectedIndex, 1);
    return;
  }
  unexpectedDiagnostics.push(`HTTP ${response.status()} ${response.url()}`);
});

async function shot(name) {
  step += 1;
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `${String(step).padStart(2, "0")}-${name}.png`),
    fullPage: true,
  });
}

async function assertVisible(locator, message) {
  await locator.waitFor({ state: "visible", timeout: 8000 });
  assert.equal(await locator.isVisible(), true, message);
}

async function assertNoHorizontalOverflow(label) {
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  assert.equal(noOverflow, true, `${label} has page-level horizontal overflow`);
}

async function assertMinimumTouchTarget(locator, label) {
  const box = await locator.boundingBox();
  assert.ok(box, `${label} has no bounding box`);
  assert.ok(box.width >= 44, `${label} is only ${box.width}px wide`);
  assert.ok(box.height >= 44, `${label} is only ${box.height}px high`);
}

try {
  console.log("1. Authentication and persisted session");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForURL(/\/login/, { timeout: 5000 });
  await shot("login-page");

  const tenantInput = page.getByLabel("Tenant code");
  const emailInput = page.getByLabel("Email");
  const passwordInput = page.getByLabel("Password");
  await tenantInput.fill("demo-gs");
  await emailInput.fill("admin@demo.local");
  await passwordInput.fill("Admin12345!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 8000 });
  await assertVisible(page.getByRole("heading", { name: /Welcome to/i }), "Overview did not render");
  assert.ok(await page.evaluate(() => window.localStorage.getItem("abixell.session")), "Session was not persisted");

  await page.reload({ waitUntil: "networkidle" });
  assert.equal(page.url(), `${BASE}/`, "Persisted session returned to login after reload");
  await assertVisible(page.getByRole("heading", { name: /Welcome to/i }), "Overview did not restore");
  await shot("overview-desktop");

  console.log("2. Grouped desktop shell and capability-gated destinations");
  const desktopNav = page.locator("aside").filter({ has: page.locator("#desktop-navigation-filter") });
  for (const group of ["Operations", "Enterprise Core", "Governance & Platform"]) {
    await assertVisible(desktopNav.getByRole("heading", { name: group, exact: true }), `Missing ${group} group`);
  }
  for (const destination of ["Overview", "HSE", "Administration", "Admin Console"]) {
    await assertVisible(
      desktopNav.getByRole("link", { name: destination, exact: true }),
      `Missing ${destination} navigation link`,
    );
  }
  assert.equal(
    await page.getByRole("button", { name: "Open navigation" }).isVisible(),
    false,
    "Desktop should use the persistent sidebar",
  );

  await desktopNav.getByLabel("Filter navigation").fill("Admin Console");
  await assertVisible(
    desktopNav.getByRole("link", { name: "Admin Console", exact: true }),
    "Visible navigation filtering lost Admin Console",
  );
  assert.equal(
    await desktopNav.getByRole("link", { name: "HSE", exact: true }).isVisible(),
    false,
    "Navigation filter did not hide non-matching destinations",
  );
  await desktopNav.getByRole("button", { name: "Clear navigation filter" }).click();

  console.log("3. Live Admin Console overview and durable section navigation");
  await desktopNav.getByRole("link", { name: "Admin Console", exact: true }).click();
  await page.waitForURL(`${BASE}/admin`, { timeout: 8000 });
  await assertVisible(page.getByRole("heading", { name: "Admin Console", exact: true }), "Admin Console missing");
  await assertVisible(page.getByText("Read only", { exact: true }), "Server-declared read-only badge missing");
  await assertVisible(page.getByRole("link", { name: "Open Roles" }), "Roles summary card is not navigable");
  assert.equal(
    await page.getByRole("link", { name: "Open Users" }).count(),
    0,
    "Users summary must remain non-navigable without a privacy-minimized list endpoint",
  );
  await shot("admin-overview");

  await page.getByRole("link", { name: "Open Roles" }).click();
  await page.waitForURL(`${BASE}/admin?section=roles`);
  await assertVisible(page.getByRole("heading", { name: "Roles", exact: true }), "Roles section missing");

  const sectionNav = page.getByRole("navigation", { name: "Admin Console sections" });
  await sectionNav.getByRole("link", { name: "Permissions", exact: true }).click();
  await page.waitForURL(`${BASE}/admin?section=permissions`);
  await assertVisible(
    page.getByRole("heading", { name: "Permissions", exact: true }),
    "Permissions section missing",
  );
  await page.goBack({ waitUntil: "networkidle" });
  await page.waitForURL(`${BASE}/admin?section=roles`);
  await page.goForward({ waitUntil: "networkidle" });
  await page.waitForURL(`${BASE}/admin?section=permissions`);

  const permissionFilter = page.getByLabel("Filter permissions");
  await permissionFilter.fill("admin.console.read");
  await assertVisible(page.getByText(/Showing \d+ of \d+/), "Permission result count missing");
  await assertVisible(page.getByRole("button", { name: "Clear filters" }), "Clear Filters action missing");
  await page.getByRole("button", { name: "Clear filters" }).click();
  assert.equal(await permissionFilter.inputValue(), "", "Clear Filters did not reset the query");

  const liveSections = [
    ["Modules", "modules", "Modules"],
    ["Workflows", "workflows", "Workflow definitions"],
    ["Recent activity", "audit", "Recent activity"],
  ];
  for (const [label, key, heading] of liveSections) {
    await sectionNav.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL(`${BASE}/admin?section=${key}`);
    await assertVisible(page.getByRole("heading", { name: heading, exact: true }), `${label} section missing`);
  }
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(page.url(), `${BASE}/admin?section=audit`, "Section query did not survive reload");
  await assertVisible(page.getByRole("heading", { name: "Recent activity", exact: true }), "Reload lost active section");

  await page.goto(`${BASE}/admin?section=unknown`, { waitUntil: "networkidle" });
  await assertVisible(page.getByText("Read-only foundation", { exact: true }), "Unknown section did not fall back to Overview");
  assert.equal(
    await sectionNav.getByRole("link", { name: "Overview", exact: true }).getAttribute("aria-current"),
    "page",
    "Unknown section did not mark Overview current",
  );

  console.log("4. Responsive drawer, focus behavior, touch targets, and overflow");
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await assertNoHorizontalOverflow(viewport.name);
    if (viewport.width < 1024) {
      const menu = page.getByRole("button", { name: "Open navigation" });
      await assertVisible(menu, `${viewport.name} menu trigger missing`);
      await assertMinimumTouchTarget(menu, `${viewport.name} menu trigger`);
      await menu.click();
      const drawer = page.getByRole("dialog", { name: /.+/ });
      await assertVisible(drawer, `${viewport.name} drawer did not open`);
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "Close navigation",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
        "Close navigation",
        `${viewport.name} drawer did not receive focus`,
      );
      await assertMinimumTouchTarget(
        drawer.getByRole("link", { name: "Overview", exact: true }),
        `${viewport.name} navigation link`,
      );

      const drawerFilter = drawer.getByLabel("Filter navigation");
      await drawerFilter.fill("no matching destination");
      await drawer.getByRole("button", { name: "Clear filter", exact: true }).click();
      assert.equal(
        await drawerFilter.evaluate((element) => element === document.activeElement),
        true,
        `${viewport.name} clear filter did not return focus to the filter input`,
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await drawer.evaluate((element) => element.contains(document.activeElement)),
        true,
        `${viewport.name} focus escaped the open navigation drawer`,
      );

      await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "detached" });
      assert.equal(
        await menu.evaluate((element) => element === document.activeElement),
        true,
        `${viewport.name} drawer did not restore focus to its trigger`,
      );
      await assertNoHorizontalOverflow(`${viewport.name} after drawer close`);

      if (viewport.name === "tablet") {
        await menu.click();
        const breakpointDrawer = page.getByRole("dialog", { name: /.+/ });
        await assertVisible(breakpointDrawer, "Tablet drawer did not reopen");
        await page.setViewportSize({ width: 1280, height: 800 });
        await breakpointDrawer.waitFor({ state: "detached" });
        await page.waitForFunction(() => document.body.style.overflow !== "hidden");
        assert.notEqual(
          await page.evaluate(() => document.body.style.overflow),
          "hidden",
          "Crossing the desktop breakpoint left body scrolling locked",
        );
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await assertVisible(menu, "Tablet menu trigger did not return after breakpoint check");
      }
    }
  }
  await shot("admin-mobile");
  await page.setViewportSize({ width: 1280, height: 800 });

  console.log("5. Intercepted deterministic Admin Console states");
  const rolesDenied = async (route) => {
    expectHttpFailure("/api/admin/roles", 403);
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Forbidden" }) });
  };
  await page.route("**/api/admin/roles", rolesDenied);
  await page.goto(`${BASE}/admin?section=roles`, { waitUntil: "networkidle" });
  await assertVisible(page.getByText("You do not have access to this area"), "403 denial state missing");
  await assertVisible(page.getByText("config.read", { exact: true }), "Required permission badge missing");
  await assertVisible(page.getByRole("link", { name: "Back to overview" }), "Denial recovery action missing");
  await page.unroute("**/api/admin/roles", rolesDenied);

  const modulesExpired = async (route) => {
    expectHttpFailure("/api/admin/modules", 401);
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Expired" }) });
  };
  await page.route("**/api/admin/modules", modulesExpired);
  await page.goto(`${BASE}/admin?section=modules`, { waitUntil: "networkidle" });
  await assertVisible(page.getByText("Your session has expired"), "401 session-expired state missing");
  await assertVisible(page.getByRole("button", { name: "Sign in again" }), "Session recovery action missing");
  await page.unroute("**/api/admin/modules", modulesExpired);
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });

  let auditAttempts = 0;
  let auditShouldFail = true;
  const auditRetry = async (route) => {
    auditAttempts += 1;
    if (auditShouldFail) {
      // React StrictMode intentionally mounts effects twice in development,
      // so register each observed intercepted failure rather than assuming one.
      expectHttpFailure("/api/admin/audit/recent", 500);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary administration failure" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "retry-recovered-event",
          action: "admin.retry.recovered",
          entityType: "admin_console",
          actorUserId: null,
          createdAt: "2026-08-24T00:00:00.000Z",
        },
      ]),
    });
  };
  await page.route("**/api/admin/audit/recent", auditRetry);
  await page.goto(`${BASE}/admin?section=audit`, { waitUntil: "domcontentloaded" });
  await assertVisible(page.getByRole("alert"), "500 error state missing");
  const attemptsBeforeRetry = auditAttempts;
  auditShouldFail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await assertVisible(
    page.getByRole("cell", { name: "admin.retry.recovered", exact: true }),
    "Retry did not recover",
  );
  assert.equal(auditAttempts, attemptsBeforeRetry + 1, "Retry did not issue one replacement request");
  await page.unroute("**/api/admin/audit/recent", auditRetry);

  const workflowsEmpty = async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  };
  await page.route("**/api/admin/workflows", workflowsEmpty);
  await page.goto(`${BASE}/admin?section=workflows`, { waitUntil: "networkidle" });
  await assertVisible(page.getByText("No workflow definitions configured"), "Empty workflow state missing");
  await page.unroute("**/api/admin/workflows", workflowsEmpty);

  console.log("6. PWA metadata");
  const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
  assert.ok(manifestHref, "Manifest link is missing");
  const manifest = await page.evaluate(async (href) => {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
    return response.json();
  }, manifestHref);
  assert.equal(manifest.name, "Enterprise Management System", "Unexpected PWA manifest name");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "PWA icons are incomplete");

  console.log("7. Logout and post-logout protection");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/login/, { timeout: 5000 });
  assert.equal(
    await page.evaluate(() => window.localStorage.getItem("abixell.session")),
    null,
    "Logout did not clear persisted session",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForURL(/\/login/, { timeout: 5000 });
  await shot("after-logout");

  assert.deepEqual(expectedHttpFailures, [], "Not all expected intercepted failures were observed");
  assert.deepEqual(
    unexpectedDiagnostics,
    [],
    `Unexpected browser diagnostics:\n${unexpectedDiagnostics.join("\n")}`,
  );

  console.log(`\nE2E smoke passed. Temporary screenshots: ${SCREENSHOT_DIR}`);
} finally {
  await context.close();
  await browser.close();
}
