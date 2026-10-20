import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };
const testDb =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/dentistas_test";
// globalSetup runs in the main process, before any project `env` is applied: set it here too.
process.env.TEST_DATABASE_URL = testDb;

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/db/global-setup.ts"],
          env: { TEST_DATABASE_URL: testDb, DATABASE_URL: testDb },
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
    ],
  },
});
