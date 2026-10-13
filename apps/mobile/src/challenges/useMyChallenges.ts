import { useCallback, useState } from "react";
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

  const load = useCallback(async () => {
    if (!accessToken) {
      setChallenges(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/me/challenges`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error();
      setChallenges(myChallengesResponseSchema.parse(await response.json()).challenges);
    } catch {
      setError("Your disputes could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { challenges, loading, error, reload: load };
}
