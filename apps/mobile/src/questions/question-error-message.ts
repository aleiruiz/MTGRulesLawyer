import { strings } from "../i18n/core";

/** An error whose message is already written for players. */
export class QuestionRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionRequestError";
  }
}

/** Shown for network failures and unexpected responses, whose raw messages are not for players. */
export function questionConnectionError(): string {
  return strings().errors.connection;
}

/** Player-facing text for an API error code; never shows the code itself. */
export function questionErrorMessage(
  errorCode: string | undefined,
  retryAfterSeconds?: number,
  fallback = strings().errors.fallback,
): string {
  const t = strings().errors;
  const wait = retryAfterSeconds === undefined ? "" : t.tryAgainIn(formatWait(retryAfterSeconds));
  switch (errorCode) {
    case "AI_DAILY_LIMIT":
      return `${t.dailyLimit}${wait}`;
    case "AI_IP_BURST_LIMIT":
      return `${t.burst}${wait || t.burstWait}`;
    case "AI_CONCURRENCY_LIMIT":
    case "AI_GLOBAL_COST_LIMIT":
    case "AI_EMERGENCY_STOP":
      return `${t.busy}${wait || t.busyWait}`;
    default:
      return fallback;
  }
}

function formatWait(seconds: number): string {
  const t = strings().errors;
  if (seconds <= 1) return t.aMoment;
  if (seconds < 90) return t.seconds(Math.round(seconds));
  if (seconds < 90 * 60) return t.minutes(Math.round(seconds / 60));
  return t.hours(Math.round(seconds / 3600));
}
