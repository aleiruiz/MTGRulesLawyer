import { en, type Messages } from "./en";
import { es } from "./es";

export type Language = "en" | "es";
export const LANGUAGES: readonly Language[] = ["es", "en"];
export const languageNames: Record<Language, string> = { en: "English", es: "Español" };

const catalogs: Record<Language, Messages> = { en, es };

// The language the UI shows right now. LanguageProvider keeps it in sync, so code outside
// components (error messages built while a request fails) uses the same language.
let current: Language = "en";

export function setCurrentLanguage(language: Language): void {
  current = language;
}

export function currentLanguage(): Language {
  return current;
}

/** The UI text for the current language. */
export function strings(language: Language = current): Messages {
  return catalogs[language];
}

/** The locale for dates and numbers. */
export function localeFor(language: Language = current): string {
  return language === "es" ? "es-MX" : "en-US";
}

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "es";
}

export type { Messages };
