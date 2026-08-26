import { defineConfig } from "vitest/config";

// Deliberately plain: these suites cover pure logic (dates, serialization,
// trend maths) and must not drag the Solid RC compiler or the Workers runtime
// into the test path. The D1 layer is verified against real workerd instead.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
