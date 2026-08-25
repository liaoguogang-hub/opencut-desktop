/**
 * Translation service built on top of the MiniMax chat completions client.
 *
 * The translation is done as a single batched request: the source segments
 * are serialised into a JSON array, the model is asked to translate each
 * entry while keeping the index numbers intact, and we re-attach the
 * original `start`/`end` timestamps from the request on the client side.
 *
 * This is much cheaper than per-segment calls because:
 * - one round-trip instead of N
 * - the model sees full context across segments (better for pronouns)
 * - prompt overhead is amortised
 *
 * The service runs in the main thread (not a worker) because it's a small
 * fetch + JSON parse. For long videos we still want a worker, but the
 * Whisper worker already handles the heavy lifting.
 */

import type { TranscriptionSegment } from "@/transcription/types";
import { chat, type MiniMaxConfig } from "./client";

export interface TranslationSegmentResult {
	text: string;
	start: number;
	end: number;
}

export interface TranslationResult {
	segments: TranslationSegmentResult[];
	srcLang: string;
	targetLang: string;
}

const SYSTEM_PROMPT = `You are a subtitle translator. The user will provide a JSON array of subtitle segments, each with "index" (integer), "text" (string in the source language), and "start"/"end" (seconds). Translate each segment's "text" into the target language while:

1. Keeping the "index" numbers unchanged so the order is preserved
2. Producing natural, idiomatic translations — no literal word-for-word
3. Keeping each translation short (subtitle conventions)
4. Returning ONLY a JSON object of the form {"translations": [{"index": 0, "text": "..."}, {"index": 1, "text": "..."}, ...]}

Do not add commentary, explanations, or any text outside the JSON object.`;

const TARGET_LANGUAGE_NAMES: Record<string, string> = {
	zh: "Simplified Chinese (中文)",
	"zh-cn": "Simplified Chinese (中文)",
	"zh-hans": "Simplified Chinese (中文)",
	en: "English",
	es: "Spanish",
	it: "Italian",
	fr: "French",
	de: "German",
	pt: "Portuguese",
	ru: "Russian",
	ja: "Japanese (日本語)",
};

const SOURCE_LANGUAGE_NAMES: Record<string, string> = {
	auto: "auto-detected",
	en: "English",
	es: "Spanish",
	it: "Italian",
	fr: "French",
	de: "German",
	pt: "Portuguese",
	ru: "Russian",
	ja: "Japanese (日本語)",
	zh: "Simplified Chinese",
};

function resolveTargetName(targetLang: string): string {
	return TARGET_LANGUAGE_NAMES[targetLang.toLowerCase()] ?? targetLang;
}

function resolveSourceName(srcLang: string): string {
	return SOURCE_LANGUAGE_NAMES[srcLang.toLowerCase()] ?? srcLang;
}

function buildUserPrompt({
	segments,
	targetLang,
}: {
	segments: TranscriptionSegment[];
	targetLang: string;
}): string {
	const serialised = segments.map((segment, idx) => ({
		index: idx,
		text: segment.text.trim(),
		start: Number(segment.start.toFixed(3)),
		end: Number(segment.end.toFixed(3)),
	}));

	return [
		`Translate the following subtitle segments into ${resolveTargetName(targetLang)}.`,
		`Source language: ${resolveSourceName(segments[0]?.text ? "en" : "auto")}.`,
		`Segments (JSON array):`,
		"```json",
		JSON.stringify(serialised, null, 2),
		"```",
		`Return the JSON object {"translations": [...]} with translated text.`,
	].join("\n");
}

interface TranslationEntry {
	index: number;
	text: string;
}

interface TranslationPayload {
	translations: TranslationEntry[];
}

function extractJsonPayload(raw: string): TranslationPayload {
	// Strip optional code fences.
	let text = raw.trim();
	const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenceMatch && fenceMatch[1]) {
		text = fenceMatch[1].trim();
	}

	// Try direct parse first.
	try {
		return JSON.parse(text) as TranslationPayload;
	} catch {
		// Fall back to substring extraction.
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start !== -1 && end !== -1 && end > start) {
			return JSON.parse(text.slice(start, end + 1)) as TranslationPayload;
		}
		throw new Error("MiniMax returned a non-JSON response");
	}
}

export async function translateSegments({
	segments,
	srcLang,
	targetLang,
	config,
	onProgress,
}: {
	segments: TranscriptionSegment[];
	srcLang: string;
	targetLang: string;
	config: MiniMaxConfig;
	onProgress?: (current: number, total: number) => void;
}): Promise<TranslationResult> {
	if (segments.length === 0) {
		return { segments: [], srcLang, targetLang };
	}

	onProgress?.(0, segments.length);

	const content = await chat({
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		model: config.model,
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{
				role: "user",
				content: buildUserPrompt({ segments, targetLang }),
			},
		],
		temperature: 0.3,
	});

	const payload = extractJsonPayload(content);
	const entries = payload.translations ?? [];

	const byIndex = new Map<number, string>();
	for (const entry of entries) {
		if (typeof entry.index === "number" && typeof entry.text === "string") {
			byIndex.set(entry.index, entry.text);
		}
	}

	const result: TranslationSegmentResult[] = segments.map((segment, idx) => ({
		start: segment.start,
		end: segment.end,
		text: (byIndex.get(idx) ?? segment.text).trim(),
	}));

	onProgress?.(segments.length, segments.length);

	return {
		segments: result,
		srcLang,
		targetLang,
	};
}