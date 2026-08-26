import { z } from "zod";

// In the Electron desktop fork the standalone Next.js server does NOT
// auto-load `.env.local` (that's a dev-only behaviour). Without that, every
// required env var above lands as `undefined` and the editor route 500s
// the moment SSR touches `webEnv`. We let the server boot by relaxing the
// schema for `OPENCUT_DESKTOP=1` builds and warning loudly about anything
// that ends up missing — the user can then decide whether to populate real
// credentials (Postgres / Redis / Freesound) or accept the stubs.
const isDesktop = process.env.OPENCUT_DESKTOP === "1";

const requiredUrl = (fallback: string) =>
	isDesktop ? z.string().optional() : z.url();

const requiredString = isDesktop
	? z.string().optional()
	: z.string().min(1);

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_MARBLE_API_URL: isDesktop
		? z.url().optional()
		: z.url(),

	// Server
	DATABASE_URL: isDesktop
		? z.string().optional()
		: z.string().refine(
				(url) =>
					url.startsWith("postgres://") ||
					url.startsWith("postgresql://"),
				"DATABASE_URL must be a postgres:// or postgresql:// URL",
			),

	BETTER_AUTH_SECRET: requiredString,
	UPSTASH_REDIS_REST_URL: requiredUrl(""),
	UPSTASH_REDIS_REST_TOKEN: requiredString,
	MARBLE_WORKSPACE_KEY: requiredString,
	FREESOUND_CLIENT_ID: requiredString,
	FREESOUND_API_KEY: requiredString,
});

export type WebEnv = z.infer<typeof webEnvSchema>;

const parseResult = webEnvSchema.safeParse(process.env);

if (!parseResult.success) {
	const issues = parseResult.error.issues
		.map((i) => `  - ${i.path.join(".")}: ${i.message}`)
		.join("\n");
	throw new Error(
		`Invalid environment variables:\n${issues}\n` +
			(isDesktop
				? "Hint: the desktop fork marks these as optional so the server boots without them, " +
					"but if you see this error something else is wrong."
				: "Hint: copy apps/web/.env.example to apps/web/.env.local and fill in real values."),
	);
}

export const webEnv = parseResult.data;

if (isDesktop) {
	const missing: string[] = [];
	if (!webEnv.DATABASE_URL) missing.push("DATABASE_URL");
	if (!webEnv.BETTER_AUTH_SECRET) missing.push("BETTER_AUTH_SECRET");
	if (!webEnv.UPSTASH_REDIS_REST_URL) missing.push("UPSTASH_REDIS_REST_URL");
	if (!webEnv.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
	if (!webEnv.MARBLE_WORKSPACE_KEY) missing.push("MARBLE_WORKSPACE_KEY");
	if (!webEnv.FREESOUND_CLIENT_ID) missing.push("FREESOUND_CLIENT_ID");
	if (!webEnv.FREESOUND_API_KEY) missing.push("FREESOUND_API_KEY");
	if (missing.length > 0) {
		console.warn(
			"[opencut-desktop] running without env vars: " +
				missing.join(", ") +
				"\n  Features that depend on them (auth, projects, sound search, blog) " +
				"will fail at runtime. See apps/web/.env.example for the full list.",
		);
	}
}
