import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withContentCollections } from "@content-collections/next";

const nextConfig: NextConfig = {
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	output: "standalone",
	// Electron desktop opens the dev server at 127.0.0.1 while HMR
	// assets are normally scoped to "localhost". Allow both so the
	// Turbopack HMR websocket is not blocked by Next 16's same-origin
	// guard. Production builds ignore this list.
	allowedDevOrigins: ["127.0.0.1", "localhost"],
	// The desktop build runs the Next standalone server on Electron's
	// embedded Node.js, whose NODE_MODULE_VERSION does not match the
	// `sharp` binary that ships with the standalone tree. Disabling
	// image optimization lets us skip the native module entirely.
	images: {
		unoptimized: process.env.OPENCUT_DESKTOP === "1",
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.marblecms.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
			{
				protocol: "https",
				hostname: "api.simplesvg.com",
			},
			{
				protocol: "https",
				hostname: "api.unisvg.com",
			},
			{
				protocol: "https",
				hostname: "cdn.brandfetch.io",
			},
		],
	},
};

export default withContentCollections(withBotId(nextConfig));
