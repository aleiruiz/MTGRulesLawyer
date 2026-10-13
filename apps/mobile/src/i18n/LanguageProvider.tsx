import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";
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

// The choice is not sensitive: on the web it lives in localStorage, where SecureStore has no
// implementation; on phones SecureStore is simply the storage the app already uses.
const storage = {
  get: async (): Promise<string | null> => {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    return SecureStore.getItemAsync(STORAGE_KEY);
  },
  set: async (value: string): Promise<void> => {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(STORAGE_KEY, value);
    else await SecureStore.setItemAsync(STORAGE_KEY, value);
  },
};

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

  // A pick made before the saved choice finishes loading wins over it.
  const picked = useRef(false);

  useEffect(() => {
    let active = true;
    storage
      .get()
      .then((saved) => {
        if (active && !picked.current && isLanguage(saved)) {
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
    picked.current = true;
    setCurrentLanguage(next);
    setLanguageState(next);
    void storage.set(next).catch(() => undefined);
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
