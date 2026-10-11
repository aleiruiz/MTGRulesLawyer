import assert from "node:assert/strict";
import test from "node:test";
import { createAiUsageReport } from "./ai-usage-report.mjs";

test("daily usage totals actual and active reserved costs, excluding released reservations", () => {
  const report = createAiUsageReport(
    [
      {
        kind: "RULES",
        status: "COMPLETED",
        count: 2n,
        actualCostMicros: 30n,
        reservedCostMicros: 0n,
        inputTokens: 20n,
        outputTokens: 10n,
      },
      {
        kind: "RULES",
        status: "IN_PROGRESS",
        count: 1n,
        actualCostMicros: 0n,
        reservedCostMicros: 50n,
        inputTokens: 0n,
        outputTokens: 0n,
      },
      {
        kind: "RULES",
        status: "RELEASED",
        count: 1n,
        actualCostMicros: 0n,
        reservedCostMicros: 0n,
        inputTokens: 0n,
        outputTokens: 0n,
      },
    ],
    {
      windowStart: "2026-10-11T00:00:00.000Z",
      generatedAt: "2026-10-11T12:00:00.000Z",
      dailyLimitMicros: 100n,
      alertThresholdMicros: 80n,
    },
  );

  assert.equal(report.actualCostMicros, "30");
  assert.equal(report.reservedCostMicros, "50");
  assert.equal(report.totalCostMicros, "80");
  assert.equal(report.completedReservations, 2);
  assert.equal(report.releasedReservations, 1);
  assert.equal(report.alert, true);
});
