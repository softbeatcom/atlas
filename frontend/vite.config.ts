import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const e2eKeycloakMock = fileURLToPath(
  new URL("./tests/e2e/keycloak.mock.ts", import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias:
      process.env.ATLAS_E2E === "1"
        ? { "keycloak-js": e2eKeycloakMock }
        : undefined,
  },
  server: { host: "0.0.0.0" },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    setupFiles: ["./tests/unit/setup.ts"],
  },
});
