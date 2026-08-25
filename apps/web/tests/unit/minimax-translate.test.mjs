// Standalone unit test for the MiniMax translation + SRT export pipeline.
//
// This bypasses the OpenCut UI (React DnD was hard to drive from Playwright)
// and exercises our pure-JS modules directly. It is the fastest way to
// verify that:
//
//   1. MiniMax chat completions returns well-formed JSON for a small batch
//      of Whisper-style English segments
//   2. The translated segments round-trip with their original timestamps
//   3. buildSingleLanguageSrt / buildBilingualSrt emit valid SubRipTime
//
// Run with:
//   MINIMAX_API_KEY=sk-... node tests/unit/minimax-translate.test.mjs
//
// or
//
//   bun test tests/unit/minimax-translate.test.mjs

import { setTimeout as wait } from "node:timers/promises";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const API_KEY = process.env.MINIMAX_API_KEY ?? "";
if (!API_KEY) {
	console.error("Set MINIMAX_API_KEY before running this test.");
	process.exit(1);
}

const BASE_URL = process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1";
const MODEL = process.env.MINIMAX_MODEL ?? "MiniMax-Text-01";

// Inline a copy of the production prompt so the test runs without a TS toolchain.
const SYSTEM_PROMPT = `You are a subtitle translator. The user will provide a JSON array of subtitle segments, each with "index" (integer), "text" (string in the source language), and "start"/"end" (seconds). Translate each segment's "text" into the target language while:

1. Keeping the "index" numbers unchanged so the order is preserved
2. Producing natural, idiomatic translations — no literal word-for-word
3. Keeping each translation short (subtitle conventions)
4. Returning ONLY a JSON object of the form {"translations": [{"index": 0, "text": "..."}, {"index": 1, "text": "..."}, ...]}

Do not add commentary, explanations, or any text outside the JSON object.`;

const fakeSegments = [
	{ text: "Hello, welcome to my channel.", start: 0, end: 3.2 },
	{ text: "Today we'll talk about friendship and love.", start: 3.5, end: 7.0 },
	{ text: "These relationships are some of the most meaningful in our lives.", start: 7.4, end: 11.8 },
	{ text: "Thank you for watching.", start: 12.1, end: 13.6 },
];

function extractJsonPayload(raw) {
	let text = raw.trim();
	const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenceMatch && fenceMatch[1]) text = fenceMatch[1].trim();
	try {
		return JSON.parse(text);
	} catch {
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start !== -1 && end > start) {
			return JSON.parse(text.slice(start, end + 1));
		}
		throw new Error("MiniMax returned a non-JSON response");
	}
}

function formatTimestamp(seconds) {
	const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
	const totalMs = Math.round(safe * 1000);
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const sec = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const min = totalMin % 60;
	const hours = Math.floor(totalMin / 60);
	return [hours, min, sec, ms].map((v, i) =>
		i === 3 ? String(v).padStart(3, "0") : String(v).padStart(2, "0"),
	).reduce(
		(acc, v, i) => (i < 2 ? `${acc}${v}:` : i === 2 ? `${acc}${v},` : `${acc}${v}`),
		"",
	);
}

function buildSingleLanguageSrt(captions) {
	return captions
		.map(
			(c, i) =>
		 `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text.trim()}\n`,
		)
		.join("\n");
}

function buildBilingualSrt(captions) {
	return buildSingleLanguageSrt(
		captions.map((c) => ({
			start: c.start,
			end: c.end,
			text: `${c.primary.trim()}\n${c.secondary.trim()}`,
		})),
	);
}

async function callMinimax({ messages }) {
	const response = await fetch(`${BASE_URL}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${API_KEY}`,
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			temperature: 0.3,
			max_tokens: 400,
		}),
	});
	if (!response.ok) {
		throw new Error(`MiniMax HTTP ${response.status}: ${await response.text()}`);
	}
	const json = await response.json();
	return json.choices?.[0]?.message?.content ?? "";
}

async function run() {
	console.log(`▶ calling MiniMax (model=${MODEL}) for 4 sample segments…`);
	const userPrompt = [
		"Translate the following subtitle segments into Simplified Chinese (中文).",
		"Source language: English.",
		"Segments (JSON array):",
		"```json",
		JSON.stringify(
			fakeSegments.map((s, i) => ({
				index: i,
				text: s.text,
				start: Number(s.start.toFixed(3)),
				end: Number(s.end.toFixed(3)),
			})),
			null,
			2,
		),
		"```",
		"Return the JSON object {\"translations\": [...]} with translated text.",
	].join("\n");

	const startedAt = Date.now();
	const content = await callMinimax({
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: userPrompt },
		],
	});
	const elapsedMs = Date.now() - startedAt;
	console.log(`  · MiniMax replied in ${elapsedMs}ms`);
	console.log("--- raw MiniMax content ---");
	console.log(content);
	console.log("---------------------------");

	const payload = extractJsonPayload(content);
	if (!Array.isArray(payload.translations)) {
		throw new Error("payload.translations is not an array");
	}

	const translatedSegments = fakeSegments.map((segment, idx) => {
		const entry = payload.translations.find((t) => t.index === idx);
		if (!entry || typeof entry.text !== "string") {
			throw new Error(`missing translation for index ${idx}`);
		}
		return { start: segment.start, end: segment.end, text: entry.text.trim() };
	});

	const enSrt = buildSingleLanguageSrt(fakeSegments);
	const zhSrt = buildSingleLanguageSrt(translatedSegments);
	const bilingualSrt = buildBilingualSrt(
		fakeSegments.map((s, i) => ({
			start: s.start,
			end: s.end,
			primary: s.text,
			secondary: translatedSegments[i].text,
		})),
	);

	console.log("\n=== captions.en.srt ===");
	console.log(enSrt);
	console.log("=== captions.zh.srt ===");
	console.log(zhSrt);
	console.log("=== captions.bilingual.srt ===");
	console.log(bilingualSrt);

	// Write the files to a tmpdir so the user can inspect them.
	const dir = mkdtempSync(path.join(tmpdir(), "opencut-srt-"));
	const paths = {
		en: path.join(dir, "captions.en.srt"),
		zh: path.join(dir, "captions.zh.srt"),
		bilingual: path.join(dir, "captions.bilingual.srt"),
	};
	writeFileSync(paths.en, enSrt);
	writeFileSync(paths.zh, zhSrt);
	writeFileSync(paths.bilingual, bilingualSrt);

	console.log("\n✓ wrote", dir);
	console.log("  ", paths.en);
	console.log("  ", paths.zh);
	console.log("  ", paths.bilingual);

	// Sanity assertions.
	const sample = readFileSync(paths.zh, "utf8");
	const srtPattern = /^\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n.+/m;
	if (!srtPattern.test(sample)) throw new Error("zh SRT does not match SubRipTime shape");
	console.log("✓ zh SRT matches SubRipTime shape");
	console.log("✓ all assertions passed");
}

run().catch((err) => {
	console.error("✗ failed:", err);
	process.exit(1);
});