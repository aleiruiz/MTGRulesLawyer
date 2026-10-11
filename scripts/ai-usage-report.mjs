export function createAiUsageReport(
  rows,
  { windowStart, generatedAt, dailyLimitMicros, alertThresholdMicros },
) {
  let actualCostMicros = 0n;
  let reservedCostMicros = 0n;
  let completedReservations = 0;
  let releasedReservations = 0;

  const groups = rows.map((row) => {
    const actual = BigInt(row.actualCostMicros);
    const reserved = BigInt(row.reservedCostMicros);
    const count = Number(row.count);
    if (row.status === "COMPLETED") {
      actualCostMicros += actual;
      completedReservations += count;
    }
    if (row.status !== "RELEASED") reservedCostMicros += reserved;
    if (row.status === "RELEASED") releasedReservations += count;

    return {
      kind: row.kind,
      status: row.status,
      count,
      actualCostMicros: actual.toString(),
      reservedCostMicros: reserved.toString(),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
    };
  });

  const totalCostMicros = actualCostMicros + reservedCostMicros;
  return {
    event: "ai.usage.daily_report",
    windowStart,
    generatedAt,
    actualCostMicros: actualCostMicros.toString(),
    reservedCostMicros: reservedCostMicros.toString(),
    totalCostMicros: totalCostMicros.toString(),
    alertThresholdMicros: alertThresholdMicros.toString(),
    dailyLimitMicros: dailyLimitMicros.toString(),
    completedReservations,
    releasedReservations,
    groups,
    alert: totalCostMicros >= alertThresholdMicros,
  };
}
