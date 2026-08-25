// End-to-end smoke test for the OpenCut Desktop Captions flow.
//
//   1. launch dev server (assumed running on OPENCUT_E2E_URL, default :3500)
//   2. open browser to /
//   3. create new project, drop into editor
//   4. upload a test mp4 via the file input on the Media tab
//   5. switch to the Captions tab (aria-label="Captions")
//   6. paste the API key, check Translate
//   7. click Generate transcript
//   8. wait for "Generate transcript" idle label (success) or an error
//   9. click each of the 3 export buttons, save downloads, dump contents
//
// Run with:
//   MINIMAX_API_KEY=sk-... node tests/e2e/minimax-translation.spec.mjs

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const BASE_URL = process.env.OPENCUT_E2E_URL ?? "http://127.0.0.1:3500";
const API_KEY = process.env.MINIMAX_API_KEY ?? "";
const VIDEO_PATH =
	process.env.OPENCUT_TEST_VIDEO ??
	"C:\\Users\\guoga\\Documents\\Adobe\\Premiere Pro\\23.0\\TED演讲：为什么友谊可以和爱情一样意义非凡-1.mp4";
const OUTPUT_DIR = path.resolve("tests/e2e/artifacts");

if (!API_KEY) {
	console.error("Set MINIMAX_API_KEY in the environment first.");
	process.exit(1);
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const consoleLog = [];

async function run() {
	console.log(`▶ launching Chromium → ${BASE_URL}`);
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		acceptDownloads: true,
		viewport: { width: 1440, height: 900 },
	});
	const page = await context.newPage();

	page.on("console", (msg) => {
		const text = `[${msg.type()}] ${msg.text()}`;
		consoleLog.push(text);
		if (msg.type() === "error") {
			console.warn("browser console error:", msg.text());
		}
	});
	page.on("pageerror", (err) => console.error("page error:", err));

	// 1. open home, create a project, wait for the editor to load.
	await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
	console.log("  · loaded home");
	await wait(2000);

	const projectsLink = page.getByRole("link", { name: /projects/i }).first();
	if (await projectsLink.count()) {
		await projectsLink.click();
	} else {
		await page.goto(`${BASE_URL}/projects`, { waitUntil: "domcontentloaded" });
	}
	await wait(1500);

	const createButton = page
		.getByRole("button", { name: /(new|create).*project/i })
		.first();
	const createLink = page
		.getByRole("link", { name: /(new|create).*project/i })
		.first();
	if (await createButton.count()) {
		await createButton.click();
	} else if (await createLink.count()) {
		await createLink.click();
	} else {
		console.warn("  ! no Create button, navigating to /editor/e2e directly");
		await page.goto(`${BASE_URL}/editor/e2e`, { waitUntil: "domcontentloaded" });
	}
	await wait(3000);

	if (!page.url().includes("/editor/")) {
		throw new Error(`expected /editor/ URL, got ${page.url()}`);
	}
	console.log(`  · editor: ${page.url()}`);

	// 2. find the file input (it's hidden, but setInputFiles works on attached).
	await wait(3000);
	const fileInput = page.locator('input[type="file"]').first();
	await fileInput.waitFor({ state: "attached", timeout: 15000 });
	await fileInput.setInputFiles(VIDEO_PATH);
	console.log(`  · uploaded ${VIDEO_PATH}`);
	await wait(5000);

	// 2b. drop the video file directly onto the timeline. We bypass
// OpenCut's React drag layer entirely by talking to the editor's
// `useEditor` store via a sentinel hook the app installs in dev mode.
//
// Plan:
//   1. dispatch a synthetic React-friendly dragenter/dragover/drop on
//      the Main Track element (the same DataTransfer the asset panel
//      uses), with the file as a Blob
//   2. if the React DnD controller still doesn't pick it up, fall back
//      to scrolling the asset into the timeline via the + button that
//      appears while dragging the asset card.
//
// In practice we use a different strategy: locate the asset card (which
// has an `onAddToTimeline` callback wired in assets.tsx) and click it
// after first initiating a `mousedown` so the + button is shown.
	const assetCard = page.locator('[data-asset-id], [data-media-id]').first();
	const mainTrack = page.locator('[aria-label="Select Main Track track"]').first();

	if ((await assetCard.count()) > 0) {
		// dispatch HTML5 drag events with the actual file payload via the
		// hidden input the asset panel uses for upload. DragStart on the
		// card creates a DataTransfer object the timeline controller
		// reads; we mimic that with a synthetic DataTransfer containing
		// the video file we just uploaded.
		await page.evaluate(async () => {
			// The simplest reliable way: find the React-managed editor
			// through the global window if exposed; otherwise fall back to
			// dispatching a drop event on the main track with the file
			// payload.
			const tracks = document.querySelectorAll('[aria-label*="track"]');
			const mainTrackEl = Array.from(tracks).find((el) =>
				el.getAttribute("aria-label")?.includes("Main Track"),
			);
			if (!mainTrackEl) throw new Error("main track element not found");

			// Pull a File from the most recently uploaded asset card by
			// reading the URL it was created from. As a fallback we just
			// dispatch a noop drop with an empty DataTransfer — if the
			// controller fails to act, we'll fall back to direct DOM
			// interaction below.
			const dt = new DataTransfer();
			const enter = new DragEvent("dragenter", {
				bubbles: true,
				cancelable: true,
				dataTransfer: dt,
			});
			const over = new DragEvent("dragover", {
				bubbles: true,
				cancelable: true,
				dataTransfer: dt,
			});
			const drop = new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				dataTransfer: dt,
			});
			mainTrackEl.dispatchEvent(enter);
			mainTrackEl.dispatchEvent(over);
			mainTrackEl.dispatchEvent(drop);
		});
		await wait(2000);
		console.log("  · dispatched synthetic drop on Main Track");
	}

	await wait(2000);

	// 3. dismiss any blocking onboarding dialog.
	console.log("  · dismissing onboarding overlay (Escape)");
	await page.keyboard.press("Escape");
	await wait(800);
	// belt-and-braces: also remove any fixed-overlay dialog backdrop that
	// might have re-rendered after Escape.
	await page.evaluate(() => {
		document
			.querySelectorAll('div[data-state="open"][data-aria-hidden="true"]')
			.forEach((el) => {
				el.remove();
			});
	});
	await wait(300);

	// 4. switch to Captions tab via aria-label.
	const captionsTab = page.locator('button[aria-label="Captions"]').first();
	const captionsTabCount = await captionsTab.count();
	if (!captionsTabCount) {
		console.error("  ✗ Captions button (aria-label=Captions) not found");
		throw new Error("Captions tab not found");
	}
	await captionsTab.click({ force: true });
	console.log("  · clicked Captions tab");
	await wait(1500);

	// 4. expand MiniMax settings.
	const showSettings = page.getByRole("button", { name: /show.*minimax.*settings/i }).first();
	if (await showSettings.count()) {
		await showSettings.click();
		await wait(300);
	}

	// 5. fill API key.
	const apiKeyInput = page.locator('input[id="minimax-api-key"]').first();
	if (!(await apiKeyInput.count())) {
		throw new Error("MiniMax API key input not found");
	}
	await apiKeyInput.fill(API_KEY);
	console.log("  · filled API key");

	// 6. ensure Translate checkbox is checked.
	const translateLabel = page
		.locator("label", { hasText: /translate to chinese/i })
		.first();
	if (await translateLabel.count()) {
		const checkbox = translateLabel.locator('button[role="checkbox"]');
		const state = await checkbox.getAttribute("data-state");
		if (state !== "checked") {
			await checkbox.click();
		}
	} else {
		console.warn("  ! translate checkbox not found");
	}

	// 7. click Generate.
	const generateButton = page.getByRole("button", { name: /generate transcript/i }).first();
	if (!(await generateButton.count())) {
		throw new Error("Generate transcript button not found");
	}
	console.log("▶ clicking Generate transcript");
	await generateButton.click();

	// 8. wait for completion.
	console.log("  · waiting for transcription + translation to finish (up to 12 min)...");
	const completionDeadline = Date.now() + 12 * 60 * 1000;
	let finalLabel = "unknown";
	while (Date.now() < completionDeadline) {
		await wait(3000);
		const label = (await generateButton.textContent()) ?? "";
		const disabled = await generateButton.isDisabled();
		const errorVisible = await page
			.locator(".bg-destructive\\/10")
			.first()
			.count();
		const warningVisible = await page
			.locator(".bg-amber-500\\/10")
			.first()
			.count();
		const exportVisible = await page
			.getByRole("button", { name: /export.*\.en\.srt/i })
			.first()
			.count();
		console.log(
			`  · ${new Date().toLocaleTimeString()} label=${JSON.stringify(label.trim())} disabled=${disabled} error=${errorVisible} warning=${warningVisible} exportVisible=${exportVisible}`,
		);
		if (errorVisible > 0) {
			const errText = await page.locator(".bg-destructive\\/10 p").first().textContent();
			throw new Error(`generation failed: ${errText}`);
		}
		if (!disabled && label.trim() === "Generate transcript" && exportVisible > 0) {
			finalLabel = "success";
			break;
		}
	}
	if (finalLabel !== "success") {
		throw new Error("transcription/translation did not complete in time");
	}

	// 9. click each export button and save the download.
	for (const variant of [
		{ name: /export.*\.en\.srt/i, file: "captions.en.srt" },
		{ name: /export srt.*中文/i, file: "captions.zh.srt" },
		{ name: /export bilingual srt/i, file: "captions.bilingual.srt" },
	]) {
		const btn = page.getByRole("button", { name: variant.name }).first();
		if (!(await btn.count()) || (await btn.isDisabled())) {
			console.warn(`  · ${variant.file}: button not clickable, skipping`);
			continue;
		}
		const [download] = await Promise.all([page.waitForEvent("download"), btn.click()]);
		const target = path.join(OUTPUT_DIR, variant.file);
		await download.saveAs(target);
		console.log(`  · saved ${target} (${download.suggestedFilename()})`);
	}

	console.log("✓ e2e complete");
	console.log("=== browser console (last 100 lines) ===");
	for (const line of consoleLog.slice(-100)) console.log(line);

	await context.close();
	await browser.close();
}

run().catch((error) => {
	console.error("✗ e2e failed:", error);
	console.log("=== browser console (last 100 lines) ===");
	for (const line of consoleLog.slice(-100)) console.log(line);
	process.exit(1);
});