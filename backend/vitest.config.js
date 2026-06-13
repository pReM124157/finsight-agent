import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    fileParallelism: false,
    isolate: true,
    sequence: {
      shuffle: false,
      setupFiles: "list"
    },
    include: [
      "tests/safety.test.js",
      "src/tests/scanner.formatter.test.js",
      "src/tests/outcome-lifecycle.test.js",
      "tests/integration/bootstrap-contamination.integration.test.js",
      "tests/integration/fundamental-normalization.integration.test.js",
      "tests/integration/institutional-output.integration.test.js",
      "tests/integration/migrations.integration.test.js",
      "tests/integration/pipeline.integration.test.js",
      "tests/integration/presentation-abstraction.integration.test.js",
      "tests/integration/provider-failover.integration.test.js",
      "tests/integration/provider-normalization.integration.test.js",
      "tests/integration/recommendation-delivery.integration.test.js",
      "tests/integration/scheduler-lease.integration.test.js",
      "tests/integration/webhook-signature.integration.test.js",
      "tests/integration/provider-resilience.integration.test.js",
      "tests/integration/pdf-report.integration.test.js",
      "tests/integration/scanner-formatter.integration.test.js",
      "tests/integration/pipeline-regression.integration.test.js",
      "tests/integration/elitescanner.guardrail.test.js",
      "tests/integration/recommendation-audit-guardrail.test.js"
    ]
  }
});
