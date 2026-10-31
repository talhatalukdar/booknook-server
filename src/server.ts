import { createApp } from "./app";
import { closeDb, connectDb } from "./config/db";
import { env } from "./config/env";

async function main() {
  await connectDb();
  const server = createApp().listen(env.port, () => {
    console.log(`BookNook API listening on :${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err instanceof Error ? err.message : err);
  process.exit(1);
});
