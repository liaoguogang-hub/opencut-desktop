// Electron preload script. Exposes a minimal `window.electronAPI` object
// that the renderer can use to talk to the main process via the
// `opencut:` IPC channel. Currently empty — saved for future use when
// we need native filesystem access for SRT export or video file picking.

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
	platform: process.platform,
	versions: {
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		node: process.versions.node,
	},
});