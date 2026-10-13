import type { ChallengeResponse } from "@mtg-rules/contracts";
import { colors } from "../theme";

/** How a dispute's state reads to the player who sent it. */
export function challengeStatus(challenge: ChallengeResponse): {
  label: string;
  color: string;
  background: string;
} {
  switch (challenge.status) {
    case "open":
      return {
        label: "Waiting for a judge",
        color: colors.textSoft,
        background: colors.neutralSurface,
      };
    case "needs_information":
      return {
        label: "Judge asked you a question",
        color: colors.info,
        background: colors.infoSurface,
      };
    case "approved":
      return {
        label: challenge.latestDecision?.correctedRulingVersion ? "Corrected" : "Judge agreed",
        color: colors.success,
        background: colors.successSurface,
      };
    case "rejected":
      return { label: "Ruling stands", color: colors.warning, background: colors.warningSurface };
  }
}
