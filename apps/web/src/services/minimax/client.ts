/**
 * MiniMax (MiniMax) Chat Completions API client.
 *
 * Default base URL targets MiniMax's global endpoint. Translation is done by
 * asking an LLM (default `MiniMax-Text-01`) to translate the input segments
 * one-by-one into the target language and return them as a JSON array. The
 * prompt is carefully constructed so the model preserves segment boundaries
 * (using the same index numbers we send in) and time-stamps (we re-attach
 * the original `start`/`end` from the request on the client side).
 *
 * Configuration:
 * - API key is read from `localStorage` first (set in the Captions panel)
 *   then from `import.meta.env.VITE_MINIMAX_API_KEY` as a build-time default
 * - Base URL defaults to MiniMax's global endpoint, override with
 *   `VITE_MINIMAX_BASE_URL` if you self-host or use the China endpoint
 */

const DEFAULT_BASE_URL = "https://api.minimaxi.com/v1";
const DEFAULT_MODEL = "MiniMax-Text-01";

export interface MiniMaxConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
}

export interface MiniMaxChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface MiniMaxChatRequest {
	model?: string;
	messages: MiniMaxChatMessage[];
	temperature?: number;
	max_tokens?: number;
	response_format?: { type: "json_object" | "text" };
}

export interface MiniMaxChatChoice {
	index: number;
	message: { role: "assistant"; content: string };
	finish_reason: string;
}

export interface MiniMaxChatResponse {
	id: string;
	model: string;
	choices: MiniMaxChatChoice[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export class MiniMaxApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body?: string,
	) {
		super(message);
		this.name = "MiniMaxApiError";
	}
}

function resolveBaseUrl(override?: string): string {
	if (override && override.length > 0) return override;
	if (
		typeof import.meta !== "undefined" &&
		import.meta.env?.VITE_MINIMAX_BASE_URL
	) {
		return import.meta.env.VITE_MINIMAX_BASE_URL as string;
	}
	return DEFAULT_BASE_URL;
}

function resolveModel(override?: string): string {
	if (override && override.length > 0) return override;
	if (
		typeof import.meta !== "undefined" &&
		import.meta.env?.VITE_MINIMAX_MODEL
	) {
		return import.meta.env.VITE_MINIMAX_MODEL as string;
	}
	return DEFAULT_MODEL;
}

export async function chat({
	apiKey,
	baseUrl,
	model,
	messages,
	temperature = 0.3,
	maxTokens,
	responseFormat,
}: {
	apiKey: string;
	baseUrl?: string;
	model?: string;
	messages: MiniMaxChatMessage[];
	temperature?: number;
	maxTokens?: number;
	responseFormat?: "json_object" | "text";
}): Promise<string> {
	if (!apiKey) {
		throw new MiniMaxApiError("MiniMax API key is not configured", 0);
	}

	const url = `${resolveBaseUrl(baseUrl)}/chat/completions`;
	const body: MiniMaxChatRequest = {
		model: resolveModel(model),
		messages,
		temperature,
		...(maxTokens ? { max_tokens: maxTokens } : {}),
		...(responseFormat ? { response_format: { type: responseFormat } } : {}),
	};

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new MiniMaxApiError(
			`MiniMax chat completions failed: ${response.status} ${response.statusText}`,
			response.status,
			errorText,
		);
	}

	const json = (await response.json()) as MiniMaxChatResponse;
	const choice = json.choices?.[0];
	if (!choice) {
		throw new MiniMaxApiError(
			"MiniMax response contained no choices",
			response.status,
			JSON.stringify(json),
		);
	}

	return choice.message.content ?? "";
}