import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

async function main() {
  const migrationClient = postgres(process.env.DATABASE_URL!, { max: 1 });
  const migrationDatabase = drizzle(migrationClient);

  await migrate(migrationDatabase, { migrationsFolder: "drizzle" });
  await migrationClient.end();

  console.log("Database migrations applied.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
