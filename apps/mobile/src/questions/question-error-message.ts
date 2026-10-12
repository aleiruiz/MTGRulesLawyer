/** An error whose message is already written for players. */
export class QuestionRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionRequestError";
  }
}

/** Shown for network failures and unexpected responses, whose raw messages are not for players. */
export const QUESTION_CONNECTION_ERROR =
  "The rules assistant could not be reached. Check your connection and try again.";

/** Player-facing text for an API error code; never shows the code itself. */
export function questionErrorMessage(
  errorCode: string | undefined,
  retryAfterSeconds?: number,
  fallback = "The rules assistant could not read this question right now. Try again in a moment.",
): string {
  const wait =
    retryAfterSeconds === undefined ? "" : ` Try again in ${formatWait(retryAfterSeconds)}.`;
  switch (errorCode) {
    case "AI_DAILY_LIMIT":
      return `You have reached today's limit of rules questions.${wait}`;
    case "AI_IP_BURST_LIMIT":
      return `Too many questions in a short time.${wait || " Wait a moment and try again."}`;
    case "AI_CONCURRENCY_LIMIT":
    case "AI_GLOBAL_COST_LIMIT":
    case "AI_EMERGENCY_STOP":
      return `The rules assistant is busy or paused right now.${wait || " Try again later."}`;
    default:
      return fallback;
  }
}

function formatWait(seconds: number): string {
  if (seconds <= 1) return "a moment";
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
}
