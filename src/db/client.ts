import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema";

const databaseUrlSchema = z.string().url();

function databaseUrl(): string {
  return databaseUrlSchema.parse(process.env.DATABASE_URL);
}

const globalDatabase = globalThis as typeof globalThis & {
  supportSql?: ReturnType<typeof postgres>;
};

export const sqlClient =
  globalDatabase.supportSql ??
  postgres(databaseUrl(), {
    max: process.env.NODE_ENV === "test" ? 10 : 20,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.supportSql = sqlClient;
}

export const db = drizzle(sqlClient, { schema });
export type Database = typeof db;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
