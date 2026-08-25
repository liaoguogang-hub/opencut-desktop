import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReducer, useRef, useState } from "react";
import { extractTimelineAudio } from "@/media/mediabunny";
import { useEditor } from "@/editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionProgress,
} from "@/transcription/types";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/media/audio";
import { buildCaptionChunks } from "@/transcription/caption";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { parseSubtitleFile } from "@/subtitles/parse";
import { Spinner } from "@/components/ui/spinner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import { AlertCircleIcon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DiagnosticSeverity } from "@/diagnostics/types";
import { translateSegments } from "@/services/minimax/translate";
import { buildBilingualSrt, buildSingleLanguageSrt } from "@/services/srt-export/export";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

const MINIMAX_API_KEY_STORAGE = "opencut.minimax.apiKey";
const MINIMAX_BASE_URL_STORAGE = "opencut.minimax.baseUrl";
const MINIMAX_MODEL_STORAGE = "opencut.minimax.model";

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}
/* eslint-enable opencut/prefer-object-params */

interface StoredCaptions {
	source: CaptionChunk[];
	sourceLanguage: string;
	translated?: { language: string; chunks: CaptionChunk[] };
}

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [translateToChinese, setTranslateToChinese] = useState(true);
	const [apiKey, setApiKey] = useState(
		() => localStorage.getItem(MINIMAX_API_KEY_STORAGE) ?? "",
	);
	const [baseUrl, setBaseUrl] = useState(
		() => localStorage.getItem(MINIMAX_BASE_URL_STORAGE) ?? "",
	);
	const [model, setModel] = useState(
		() => localStorage.getItem(MINIMAX_MODEL_STORAGE) ?? "",
	);
	const [showSettings, setShowSettings] = useState(false);
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	const [stored, setStored] = useState<StoredCaptions | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor();

	const isProcessing = processing.status === "processing";

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			dispatch({
				type: "update_step",
				step: `Loading transcription model ${Math.round(progress.progress)}%`,
			});
		} else if (progress.status === "transcribing") {
			dispatch({ type: "update_step", step: "Transcribing..." });
		}
	};

	const insertCaptions = ({
		captions,
		trackLabel,
	}: {
		captions: CaptionChunk[];
		trackLabel?: string;
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({ editor, captions });
		return trackId !== null;
	};

	const handleGenerateTranscript = async () => {
		dispatch({ type: "start", step: "Extracting audio..." });
		try {
			const audioBlob = await extractTimelineAudio({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			dispatch({ type: "update_step", step: "Preparing audio..." });
			const { samples } = await decodeAudioToFloat32({
				audioBlob,
				sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
			});

			const result = await transcriptionService.transcribe({
				audioData: samples,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				onProgress: handleProgress,
			});

			dispatch({ type: "update_step", step: "Generating captions..." });
			const sourceChunks = buildCaptionChunks({ segments: result.segments });

			const sourceLanguage = result.language || selectedLanguage;

			if (!insertCaptions({ captions: sourceChunks })) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			const warnings: string[] = [];

			if (translateToChinese) {
				if (!apiKey.trim()) {
					warnings.push(
						"Translation skipped: MiniMax API key not configured. Open settings below to add it.",
					);
				} else {
					dispatch({ type: "update_step", step: "Translating to Chinese..." });
					try {
						const translation = await translateSegments({
							segments: result.segments,
							srcLang: sourceLanguage,
							targetLang: "zh",
							config: {
								apiKey: apiKey.trim(),
								baseUrl: baseUrl.trim() || undefined,
								model: model.trim() || undefined,
							},
							onProgress: () => {
								/* no-op; the single batched call has no useful per-segment progress */
							},
						});

						const translatedChunks = buildCaptionChunks({
							segments: translation.segments,
						});

						if (
							!insertCaptions({
								captions: translatedChunks,
							})
						) {
							warnings.push("Failed to insert Chinese captions into the timeline.");
						} else {
							setStored({
								source: sourceChunks,
								sourceLanguage,
								translated: {
									language: "zh",
									chunks: translatedChunks,
								},
							});
						}
					} catch (error) {
						console.error("Translation failed:", error);
						const message =
							error instanceof Error
								?error
								: "Unknown translation error";
						warnings.push(`Translation failed: ${message}`);
					}
				}
			} else {
				setStored({
					source: sourceChunks,
					sourceLanguage,
				});
			}

			dispatch({ type: "succeed", warnings });
		} catch (error) {
			console.error("Transcription failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		dispatch({ type: "start", step: "Reading subtitle file..." });
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: "No valid subtitle cues were found in the subtitle file",
				});
				return;
			}

			dispatch({ type: "update_step", step: "Importing subtitles..." });

			if (!insertCaptions({ captions: result.captions })) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					`Imported ${result.captions.length} subtitle cue(s) and skipped ${result.skippedCueCount} malformed cue(s).`,
				);
			}

			setStored({
				source: result.captions,
				sourceLanguage: "imported",
			});

			dispatch({ type: "succeed", warnings: nextWarnings });
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const persistApiKey = (next: string) => {
		setApiKey(next);
		if (next) {
			localStorage.setItem(MINIMAX_API_KEY_STORAGE, next);
		} else {
			localStorage.removeItem(MINIMAX_API_KEY_STORAGE);
		}
	};

	const persistBaseUrl = (next: string) => {
		setBaseUrl(next);
		if (next) {
			localStorage.setItem(MINIMAX_BASE_URL_STORAGE, next);
		} else {
			localStorage.removeItem(MINIMAX_BASE_URL_STORAGE);
		}
	};

	const persistModel = (next: string) => {
		setModel(next);
		if (next) {
			localStorage.setItem(MINIMAX_MODEL_STORAGE, next);
		} else {
			localStorage.removeItem(MINIMAX_MODEL_STORAGE);
		}
	};

	const downloadFile = ({ name, content }: { name: string; content: string }) => {
		const blob = new Blob([content], { type: "application/x-subrip" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = name;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);
	};

	const handleExportSource = () => {
		if (!stored?.source.length) return;
		const srt = buildSingleLanguageSrt(
			stored.source.map((caption) => ({
				start: caption.startTime,
				end: caption.startTime + caption.duration,
				text: caption.text,
			})),
		);
		downloadFile({ name: "captions.en.srt", content: srt });
	};

	const handleExportTranslation = () => {
		if (!stored?.translated?.chunks.length) return;
		const srt = buildSingleLanguageSrt(
			stored.translated.chunks.map((caption) => ({
				start: caption.startTime,
				end: caption.startTime + caption.duration,
				text: caption.text,
			})),
		);
		downloadFile({ name: "captions.zh.srt", content: srt });
	};

	const handleExportBilingual = () => {
		if (!stored?.source.length || !stored?.translated?.chunks.length) return;
		const aligned = stored.source.map((caption, idx) => ({
			start: caption.startTime,
			end: caption.startTime + caption.duration,
			primary: caption.text,
			secondary: stored.translated?.chunks[idx]?.text ?? caption.text,
		}));
		downloadFile({ name: "captions.bilingual.srt", content: buildBilingualSrt(aligned) });
	};

	const generateButtonLabel = () => {
		if (isProcessing) return processing.step;
		return "Generate transcript";
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	const hasTranslation = Boolean(stored?.translated?.chunks.length);

	return (
		<PanelView
			title="Captions"
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
						>
							<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							Import
						</Button>
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						<SectionField label="Source language">
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a language" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto detect</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						<SectionField
							label="Translation"
							description="Translate to Simplified Chinese using MiniMax."
						>
							<label className="flex items-center gap-2 rounded-sm border px-2 py-1.5 text-sm hover:bg-accent/40 cursor-pointer">
								<Checkbox
									checked={translateToChinese}
									onCheckedChange={(value) => setTranslateToChinese(Boolean(value))}
								/>
								<span>Translate to Chinese (中文)</span>
							</label>
						</SectionField>
						<SectionField
							label="MiniMax API key"
							description={
								translateToChinese
									? "Required for translation. Saved locally to your browser profile."
									: "Saved locally. Only used when translation is enabled."
							}
						>
							<div className="flex flex-col gap-1.5">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-xs w-fit"
									onClick={() => setShowSettings((current) => !current)}
								>
									{showSettings ? "Hide" : "Show"} MiniMax settings
								</Button>
								{showSettings && (
									<div className="flex flex-col gap-2 rounded-md border p-2">
										<div className="flex flex-col gap-1">
											<Label htmlFor="minimax-api-key" className="text-xs">
												API key
											</Label>
											<Input
												id="minimax-api-key"
												type="password"
												autoComplete="off"
												placeholder="sk-..."
												value={apiKey}
												onChange={(event) => persistApiKey(event.target.value)}
											/>
										</div>
										<div className="flex flex-col gap-1">
											<Label htmlFor="minimax-base-url" className="text-xs">
												Base URL (optional)
											</Label>
											<Input
												id="minimax-base-url"
												type="text"
												autoComplete="off"
												placeholder="https://api.minimaxi.com/v1"
												value={baseUrl}
												onChange={(event) => persistBaseUrl(event.target.value)}
											/>
										</div>
										<div className="flex flex-col gap-1">
											<Label htmlFor="minimax-model" className="text-xs">
												Model (optional)
											</Label>
											<Input
												id="minimax-model"
												type="text"
												autoComplete="off"
												placeholder="MiniMax-Text-01"
												value={model}
												onChange={(event) => persistModel(event.target.value)}
											/>
										</div>
									</div>
								)}
							</div>
						</SectionField>
					</SectionFields>

					<Button
						type="button"
						className="mt-auto w-full"
						onClick={handleGenerateTranscript}
						disabled={isProcessing || activeDiagnostics.length > 0}
					>
						{isProcessing && <Spinner className="mr-1" />}
						{generateButtonLabel()}
					</Button>

					{stored?.source.length ? (
						<div className="flex flex-col gap-2 rounded-md border p-3">
							<div className="text-muted-foreground text-xs">
								{stored.source.length} caption(s) ready · source: {stored.sourceLanguage}
								{hasTranslation
									? ` · translated: ${stored.translated?.language ?? "?"}`
									: ""}
							</div>
							<div className="grid grid-cols-3 gap-1.5">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={handleExportSource}
									disabled={isProcessing}
								>
									Export .en.srt
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={handleExportTranslation}
									disabled={isProcessing || !hasTranslation}
								>
									Export SRT (中文)
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={handleExportBilingual}
									disabled={isProcessing || !hasTranslation}
								>
									Export bilingual SRT
								</Button>
							</div>
						</div>
					) : null}

					{error && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}