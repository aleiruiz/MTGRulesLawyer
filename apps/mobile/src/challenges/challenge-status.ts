import type { ChallengeResponse } from "@mtg-rules/contracts";
import { colors } from "../theme";
import { strings } from "../i18n/core";

/** How a dispute's state reads to the player who sent it. */
export function challengeStatus(challenge: ChallengeResponse): {
  label: string;
  color: string;
  background: string;
} {
  const t = strings().disputes.status;
  switch (challenge.status) {
    case "open":
      return {
        label: t.open,
        color: colors.textSoft,
        background: colors.neutralSurface,
      };
    case "needs_information":
      return {
        label: t.needs_information,
        color: colors.info,
        background: colors.infoSurface,
      };
    case "approved":
      return {
        label: challenge.latestDecision?.correctedRulingVersion ? t.corrected : t.agreed,
        color: colors.success,
        background: colors.successSurface,
      };
    case "rejected":
      return { label: t.rejected, color: colors.warning, background: colors.warningSurface };
  }
}
