import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  // generate works without a database; migrate/studio need DATABASE_URL.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
