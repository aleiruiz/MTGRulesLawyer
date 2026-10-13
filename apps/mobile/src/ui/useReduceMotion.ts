import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** True when the player asked the system to reduce motion; animations then hold still. */
export default function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduceMotion(value);
      })
      // Without an answer, animate: a stuck null would hold back whatever waits on it.
      .catch(() => {
        if (active) setReduceMotion(false);
      });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) =>
      setReduceMotion(value),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
