# OpenCut Desktop

A fork of [OpenCut-classic](https://github.com/opencut-app/opencut-classic) packaged as a single Windows `.exe`.

## What it does

1. **Local Whisper transcription** — runs `onnx-community/whisper-small` (q4) in a Web Worker inside Electron. The model files are downloaded from `hf-mirror.com` on first use.
2. **Cloud translation to Chinese** — the captions panel sends the Whisper output to [MiniMax](https://platform.minimaxi.com)'s chat completions endpoint (`https://api.minimaxi.com/v1/chat/completions`) with the `MiniMax-Text-01` model. The model name, base URL and API key are all configurable from the UI and persist to `localStorage`.
3. **SRT export** — three flavours: `captions.en.srt`, `captions.zh.srt`, `captions.bilingual.srt`.

Everything else is stock OpenCut-classic (preview, timeline, effects, etc.).

## Project layout

```
apps/web/
  src/
    services/
      minimax/        ← MiniMax API client + batched translation
      transcription/  ← Whisper worker (kept from upstream)
      srt-export/     ← SubRipTime writer (single + bilingual)
    subtitles/
      components/
        assets-view.tsx   ← "Translate to Chinese" checkbox + 3 export buttons
  electron/
    main.cjs          ← Electron main process (spawns `next dev`/`next start`)
    preload.cjs       ← contextBridge stub for future native IPC
electron-builder.yml  ← NSIS installer config
```

## Development

```bash
# from the repo root (D:\opencut-desktop)
cd apps/web
bun install --linker=hoisted      # D-drive sandbox workaround for symlinks
bun run dev                       # opens http://localhost:3000
```

Then in a separate terminal:

```bash
cd apps/web
bun run electron:dev              # Electron window opens, loads localhost:3000
```

## Production EXE

```bash
cd apps/web
bun run electron:build            # outputs release/OpenCut Desktop-Setup-0.1.0.exe
```

The installer is a standard NSIS `.exe` (~200 MB, includes Chromium).

## Pre-baked Whisper weights (optional, for offline use)

The default config pulls Whisper from `hf-mirror.com`. To ship the model inside the EXE so the app works without internet:

```bash
# from the repo root
bash scripts/download-models.sh
# downloads ~500 MB into apps/web/public/models/
# electron-builder.yml already lists `public/**/*` in the asar bundle
```

The worker falls back to the local copy automatically when `env.allowLocalModels = true`.

## Configuration

The MiniMax API key is entered in the Captions panel ("Show MiniMax settings") and stored in Electron's user-data directory via `localStorage`. No `.env` file is required for production builds.

## Known limitations

- Video import still goes through OpenCut's existing upload flow (multipart → server-side blob). For fully offline use that piece would need a refactor; for now it works on any machine that can serve `localhost`.
- Translation target is hard-coded to Simplified Chinese. Adding more languages is a one-line change in `assets-view.tsx` plus an entry in the `TARGET_LANGUAGE_NAMES` map inside `services/minimax/translate.ts`.
- No installer code-signing. SmartScreen will warn the first time the user runs the `.exe`.