import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { webEnv } from "@/env/web";

// Build the postgres connection lazily so the module can be imported even
// when DATABASE_URL is missing (the Electron desktop fork runs without a
// real Postgres during smoke tests). Anything that actually touches `db`
// will throw a helpful error at use time instead of crashing at module load.
const url = webEnv.DATABASE_URL;
const client = url ? postgres(url) : null;
const _db = client ? drizzle(client, { schema }) : null;

export const db = _db ?? (new Proxy({} as ReturnType<typeof drizzle>, {
	get() {
		throw new Error(
			"DATABASE_URL is not configured. Set it in apps/web/.env.local " +
				"or pass OPENCUT_DESKTOP=1 with a real Postgres URL to use the editor.",
		);
	},
}) as ReturnType<typeof drizzle>);

export * from "./schema";
