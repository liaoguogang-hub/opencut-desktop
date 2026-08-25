// Electron main process for OpenCut desktop.
//
// In development we spawn `bun run dev` so Turbopack + HMR stay available.
// In production we launch the Next.js standalone server (`next.config.ts`
// sets `output: "standalone"`) using the Node.js runtime that ships inside
// Electron itself. That way end users do not need to install Node.js or
// bun — the installer is fully self-contained.

const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");

const isDev = !app.isPackaged;
const PORT = Number.parseInt(process.env.OPENCUT_PORT ?? "3000", 10);
const HOST = "127.0.0.1";
// electron-builder copies `.next/standalone` to `resources/.next/standalone`
// via `extraResources`. In dev the same path lives next to APP_ROOT.
const STANDALONE_SERVER = path.join(
	APP_ROOT_FROM_PACKAGED(),
	".next",
	"standalone",
	"apps",
	"web",
	"server.js",
);

let nextProcess = null;
let mainWindow = null;

function APP_ROOT_FROM_PACKAGED() {
	// In packaged builds `process.resourcesPath` is the directory that holds
	// `app.asar` (and, via extraResources, our copied `.next/standalone`).
	// In dev __dirname/.. resolves to apps/web.
	return isDev ? path.join(__dirname, "..") : process.resourcesPath;
}

// On Windows, `bun` resolves through the npm shim (`bun.cmd`) which
// `CreateProcess` cannot execute directly. Look up the real `bun.exe` from
// the user's npm-global install so Electron's child_process.spawn can run it.
function resolveBunExe() {
	if (process.platform !== "win32") return "bun";
	const candidates = [
		process.env.OPENCUT_BUN_EXE,
		"C:\\Users\\guoga\\AppData\\Roaming\\npm\\node_modules\\bun\\bin\\bun.exe",
	];
	for (const candidate of candidates) {
		if (candidate && fs.existsSync(candidate)) return candidate;
	}
	return "bun"; // best-effort fallback; will ENOENT on bare PATH
}

function waitForServer(url, timeoutMs = 30000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const attempt = () => {
			const req = http.get(url, (response) => {
				response.resume();
				resolve();
			});
			req.on("error", () => {
				if (Date.now() - start > timeoutMs) {
					reject(new Error(`Server at ${url} did not become ready in ${timeoutMs}ms`));
					return;
				}
				setTimeout(attempt, 250);
			});
			req.setTimeout(2000, () => req.destroy());
		};
		attempt();
	});
}

function startNextServer() {
	const targetUrl = `http://${HOST}:${PORT}`;
	if (isDev) {
		// Dev: invoke Electron's embedded Node.js (`process.execPath` plus
		// `ELECTRON_RUN_AS_NODE=1`) with the hoisted `next` CLI from the
		// monorepo root. This mirrors the production spawn path so HMR works
		// without depending on bun's `.bunx` resolution or PATH lookup.
		const nextBin = path.join(
			__dirname,
			"..",
			"..",
			"..",
			"node_modules",
			"next",
			"dist",
			"bin",
			"next",
		);
		console.log(`[next] dev: spawning ${process.execPath} (as node) ${nextBin} dev --turbopack`);
		nextProcess = spawn(process.execPath, [nextBin, "dev", "--turbopack"], {
			cwd: APP_ROOT_FROM_PACKAGED(),
			env: {
				...process.env,
				HOST,
				PORT: String(PORT),
				NODE_ENV: "development",
				ELECTRON_RUN_AS_NODE: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
	} else {
		// Production: launch Next.js standalone server inside Electron's
		// embedded Node.js (no system Node required).
		if (!fs.existsSync(STANDALONE_SERVER)) {
			console.error(
				`[next] standalone server not found at ${STANDALONE_SERVER}. ` +
					"Make sure next build has run with output: standalone and " +
					"that electron-builder.yml unpacks .next/standalone/**/*.",
			);
		}
		console.log(`[next] prod: spawning ${process.execPath} ${STANDALONE_SERVER}`);
		nextProcess = spawn(process.execPath, [STANDALONE_SERVER], {
			cwd: APP_ROOT_FROM_PACKAGED(),
			env: {
				...process.env,
				HOST,
				PORT: String(PORT),
				NODE_ENV: "production",
				ELECTRON_RUN_AS_NODE: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
	}

	nextProcess.stdout.on("data", (chunk) => {
		process.stdout.write(`[next] ${chunk}`);
	});
	nextProcess.stderr.on("data", (chunk) => {
		process.stderr.write(`[next] ${chunk}`);
	});

	nextProcess.on("exit", (code) => {
		console.log(`[next] exited with code ${code}`);
		nextProcess = null;
	});

	// Make sure waitForServer knows where to point.
	return targetUrl;
}

async function createWindow(targetUrl) {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 1024,
		minHeight: 600,
		title: "OpenCut Desktop",
		backgroundColor: "#0b0b0f",
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	await waitForServer(targetUrl);
	await mainWindow.loadURL(targetUrl);
}

function shutdown() {
	if (nextProcess && !nextProcess.killed) {
		nextProcess.kill();
	}
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.destroy();
	}
	app.quit();
}

app.on("window-all-closed", () => {
	shutdown();
});

app.on("before-quit", () => {
	if (nextProcess && !nextProcess.killed) {
		nextProcess.kill();
	}
});

app.on("web-contents-created", (_event, contents) => {
	contents.on("will-navigate", (event, navigationUrl) => {
		const url = new URL(navigationUrl);
		if (url.origin !== `http://${HOST}:${PORT}`) {
			event.preventDefault();
			void shell.openExternal(navigationUrl);
		}
	});
});

app.whenReady().then(async () => {
	const targetUrl = startNextServer();
	try {
		await createWindow(targetUrl);
	} catch (error) {
		console.error("Failed to start OpenCut Desktop:", error);
		shutdown();
	}
});
