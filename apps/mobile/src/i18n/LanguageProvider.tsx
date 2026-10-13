import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import {
  isLanguage,
  localeFor,
  setCurrentLanguage,
  strings,
  type Language,
  type Messages,
} from "./core";

const STORAGE_KEY = "rules-lawyer.language";

interface LanguageContextValue {
  language: Language;
  /** Saves the player's choice; it wins over the device language from then on. */
  setLanguage: (language: Language) => void;
  t: Messages;
  locale: string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function deviceLanguage(): Language {
  return getLocales()[0]?.languageCode === "es" ? "es" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const initial = deviceLanguage();
    setCurrentLanguage(initial);
    return initial;
  });

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (active && isLanguage(saved)) {
          setCurrentLanguage(saved);
          setLanguageState(saved);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setCurrentLanguage(next);
    setLanguageState(next);
    void SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, t: strings(language), locale: localeFor(language) }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useT(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useT must be used inside LanguageProvider.");
  return context;
}
