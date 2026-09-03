import "dotenv/config";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";
import { seedAdmin, seedDuenas } from "./services/auth.service";

const port = process.env.PORT || 8101;

async function main() {
  await dbConnect();
  await seedAdmin();
  await seedDuenas();

  const { app, server } = createApp();

  server.timeout = 10 * 60 * 1000;

  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

main();
