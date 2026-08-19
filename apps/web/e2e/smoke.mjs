/**
 * Checkpoint 0F visual browser smoke/E2E test.
 *
 * Prerequisites: PostgreSQL running + migrated + seeded, the API dev
 * server on :4000, and the web dev server on :5173 (`npm run dev` in
 * each of apps/api and apps/web). Not wired into `npm test` — this is a
 * manual/CI-optional smoke check against a REAL browser (Playwright +
 * Chromium), not a unit/integration test; see docs/implementation-notes.md
 * Checkpoint 0F section for how it was run and what it found.
 *
 * Usage: node e2e/smoke.mjs   (from apps/web)
 */
import playwright from "playwright";
import { mkdirSync } from "node:fs";

const { chromium } = playwright;

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/e2e-screenshots";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") {
    console.log("   [console] " + msg.text());
    consoleErrors.push(msg.text());
  }
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("response", (res) => {
  if (res.status() >= 400) {
    const line = `HTTP ${res.status()} ${res.url()}`;
    consoleErrors.push(line);
    console.log("   [network] " + line);
  }
});

let step = 0;
function shot(name) {
  step += 1;
  return page.screenshot({ path: `${SCREENSHOT_DIR}/${String(step).padStart(2, "0")}-${name}.png`, fullPage: true });
}

console.log("1. Navigating to app root (should redirect to /login)...");
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForURL(/\/login/, { timeout: 5000 });
await shot("login-page");
console.log("   OK — redirected to /login as expected (no session yet).");

console.log("2. Filling login form and signing in as admin@demo.local...");
await page.fill('input[value="demo-gs"]', "demo-gs").catch(() => {});
// Fill by label text since inputs aren't easily selected by placeholder alone.
const tenantInput = page.locator("label", { hasText: "Tenant code" }).locator("input");
const emailInput = page.locator("label", { hasText: "Email" }).locator("input");
const passwordInput = page.locator("label", { hasText: "Password" }).locator("input");
await tenantInput.fill("demo-gs");
await emailInput.fill("admin@demo.local");
await passwordInput.fill("Admin12345!");
await page.click('button[type="submit"]');
await page.waitForURL(BASE + "/", { timeout: 8000 });
// The Overview landing heading ("Welcome to <tenant>") is the reliable,
// single, visible signal that the shell + Overview rendered (the tenant name
// itself appears in several places, some hidden per breakpoint).
await page.getByRole("heading", { name: /Welcome to/i }).waitFor({ timeout: 8000 });
await shot("overview-after-login");
console.log("   OK — logged in, Overview loaded, tenant name visible.");

console.log("3a. Checkpoint 1C.1: verifying capability-gated persona navigation...");
// admin@demo.local is is_full_access (tenant scope) → internal areas visible;
// "Complaints" is customer-scope only, so it is intentionally NOT shown here.
const navSections = ["Overview", "Queue", "Verification", "Management", "Administration"];
for (const label of navSections) {
  const visible = await page.locator(`nav >> text=${label}`).first().isVisible().catch(() => false);
  console.log(`   - nav "${label}": ${visible ? "visible" : "MISSING"}`);
}

console.log("3b. Navigating to Administration and verifying Phase 0 sections render...");
await page.click(`nav >> text=Administration`);
await page.waitForURL(BASE + "/administration", { timeout: 8000 });
await page.waitForSelector("text=Administration", { timeout: 8000 });
await shot("administration");
const sections = ["Legal Entities", "Users", "Audit Trail (recent)"];
for (const label of sections) {
  const visible = await page.locator(`text=${label}`).first().isVisible().catch(() => false);
  console.log(`   - "${label}": ${visible ? "visible" : "MISSING"}`);
}
// Note: "Organization Units" renders as "Sites" here because of a Terminology
// Configuration override (Checkpoint 0C feature) on the demo tenant —
// confirmed correct behavior via screenshot, not a defect.
const workflowVisible = await page.locator("text=/Workflow/i").first().isVisible().catch(() => false);
const sharedServicesVisible = await page.locator("text=/Notification|Scheduler|Integration|Document/i").first().isVisible().catch(() => false);
console.log(`   - Workflow section present: ${workflowVisible}`);
console.log(`   - Shared Services section present: ${sharedServicesVisible}`);

console.log("3c. Returning to Overview...");
await page.click(`nav >> text=Overview`);
await page.waitForURL(BASE + "/", { timeout: 8000 });

console.log("4. Checkpoint 0F: reloading the page — session should PERSIST (no bounce to /login)...");
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
const urlAfterReload = page.url();
const stillOnDashboard = urlAfterReload === BASE + "/";
await shot("dashboard-after-reload");
console.log(`   URL after reload: ${urlAfterReload} — session persisted: ${stillOnDashboard}`);

console.log("4b. Checkpoint 1C.7: responsive viewports — no horizontal page overflow...");
async function noHorizontalOverflow() {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
for (const vp of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
]) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.reload({ waitUntil: "networkidle" });
  const ok = await noHorizontalOverflow();
  console.log(`   - ${vp.name} (${vp.width}px): no horizontal overflow = ${ok}`);
}
// On mobile the navigation collapses behind a toggle button.
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
const toggleVisible = await page
  .locator('button[aria-label="Toggle navigation"]')
  .isVisible()
  .catch(() => false);
console.log(`   - mobile nav toggle visible: ${toggleVisible}`);
await page.setViewportSize({ width: 1280, height: 800 });

console.log("4c. Checkpoint 1C.7: PWA manifest present and valid...");
const manifestHref = await page.getAttribute('link[rel="manifest"]', "href").catch(() => null);
console.log(`   - <link rel=manifest>: ${manifestHref}`);
if (manifestHref) {
  const manifest = await page.evaluate(async (href) => {
    const res = await fetch(href);
    return res.ok ? res.json() : null;
  }, manifestHref);
  console.log(
    `   - manifest name="${manifest?.name}" display="${manifest?.display}" icons=${manifest?.icons?.length ?? 0}`,
  );
}
// Service Worker registers in PRODUCTION builds only (see main.tsx); against
// the dev server it is intentionally absent. Report support + any registration.
const swSupported = await page.evaluate(() => "serviceWorker" in navigator);
const swRegs = await page.evaluate(async () =>
  "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
);
console.log(`   - serviceWorker supported: ${swSupported}; registrations: ${swRegs} (0 expected on dev)`);

console.log("5. Checking localStorage for persisted session key...");
const storedSession = await page.evaluate(() => window.localStorage.getItem("abixell.session"));
console.log(`   localStorage 'abixell.session' present: ${storedSession !== null}`);

console.log("6. Signing out...");
await page.click('button:has-text("Sign out")');
await page.waitForURL(/\/login/, { timeout: 5000 });
const storedAfterLogout = await page.evaluate(() => window.localStorage.getItem("abixell.session"));
await shot("after-logout");
console.log(`   OK — redirected to /login. localStorage cleared: ${storedAfterLogout === null}`);

console.log("7. Confirming a stale/revoked session no longer grants access after logout...");
await page.reload({ waitUntil: "networkidle" });
await page.waitForURL(/\/login/, { timeout: 5000 });
console.log("   OK — still on /login after reload post-logout.");

console.log("\n=== Console errors captured during the whole run ===");
if (consoleErrors.length === 0) {
  console.log("(none)");
} else {
  consoleErrors.forEach((e) => console.log(" - " + e));
}

await browser.close();
console.log("\nE2E smoke test finished. Screenshots in " + SCREENSHOT_DIR + "");
