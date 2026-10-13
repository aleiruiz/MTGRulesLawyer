import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { myChallengesResponseSchema, type ChallengeResponse } from "@mtg-rules/contracts";
import { useAuth } from "../auth/AuthProvider";
import { apiUrl } from "../api-url";

/** The signed-in player's disputes, refreshed whenever the screen comes into view. */
export function useMyChallenges() {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [challenges, setChallenges] = useState<ChallengeResponse[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Only the newest request may update state, so a slow answer for a signed-out account (or an
  // older refresh) never replaces newer data.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    if (!accessToken) {
      setChallenges(null);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/me/challenges`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error();
      const result = myChallengesResponseSchema.parse(await response.json()).challenges;
      if (requestId === latestRequest.current) setChallenges(result);
    } catch {
      if (requestId === latestRequest.current) setError("Your disputes could not be loaded.");
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [accessToken]);

  // Reruns on focus and whenever the account changes, since `load` depends on the token.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { challenges, loading, error, reload: load };
}
