/**
 * SubRipTime (.srt) subtitle writer.
 *
 * Each caption becomes a single SRT block:
 *
 *     1
 *     00:00:01,000 --> 00:00:04,500
 *     First line of subtitle
 *
 *     2
 *     00:00:05,000 --> 00:00:08,000
 *     Second subtitle
 *
 * Three formats are produced from the same caption list:
 *
 * 1. Single-language: one block per caption, text in one language
 * 2. Bilingual:        one block per caption, "English\nChinese" stacked
 *                       (or any source/target pair supplied by the caller)
 *
 * Timestamps are SRT-style (HH:MM:SS,mmm). The writer tolerates captions
 * with `start`/`end` in seconds (Float32 from mediabunny's decoded audio)
 * and normalises them.
 */

export interface SrtCaption {
	start: number;
	end: number;
	/** Primary text (e.g. English) */
	text: string;
	/** Optional secondary text (e.g. Chinese) for bilingual output */
	secondaryText?: string;
}

function pad(value: number, width: number): string {
	return String(Math.max(0, Math.floor(value))).padStart(width, "0");
}

function formatTimestamp(seconds: number): string {
	const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
	const totalMs = Math.round(safe * 1000);
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const sec = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const min = totalMin % 60;
	const hours = Math.floor(totalMin / 60);
	return `${pad(hours, 2)}:${pad(min, 2)}:${pad(sec, 2)},${pad(ms, 3)}`;
}

function normaliseText(text: string): string {
	return text.replace(/\r\n/g, "\n").trim();
}

function buildBlock(index: number, caption: SrtCaption): string {
	const lines = [normaliseText(caption.text)];
	if (caption.secondaryText) {
		const secondary = normaliseText(caption.secondaryText);
		if (secondary.length > 0) {
			lines.push(secondary);
		}
	}
	return [
		String(index + 1),
		`${formatTimestamp(caption.start)} --> ${formatTimestamp(caption.end)}`,
		lines.join("\n"),
		"",
	].join("\n");
}

export function buildSrt(captions: SrtCaption[]): string {
	return captions.map((caption, idx) => buildBlock(idx, caption)).join("\n");
}

export function buildSingleLanguageSrt(
	captions: Array<{ start: number; end: number; text: string }>,
): string {
	return buildSrt(captions);
}

export function buildBilingualSrt(
	captions: Array<{ start: number; end: number; primary: string; secondary: string }>,
): string {
	return buildSrt(
		captions.map((caption) => ({
			start: caption.start,
			end: caption.end,
			text: caption.primary,
			secondaryText: caption.secondary,
		})),
	);
}