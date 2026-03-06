import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Prevent unhandled pool errors from crashing the process
pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err.message);
});

export const db = drizzle(pool, { schema });
