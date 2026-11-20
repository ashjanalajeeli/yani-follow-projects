// Standalone config: unit tests do not need the app's Vite/TanStack/Cloudflare plugins.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
