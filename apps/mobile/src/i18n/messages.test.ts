import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { questionErrorMessage } from "../questions/question-error-message";
import { setCurrentLanguage } from "./core";
import { en } from "./en";
import { es } from "./es";

function shape(value: unknown, path = ""): string[] {
  if (typeof value === "function") return [`${path}:function`];
  if (Array.isArray(value)) return value.flatMap((item, index) => shape(item, `${path}[${index}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, child]) => shape(child, path ? `${path}.${key}` : key));
  }
  return [`${path}:${typeof value}`];
}

function texts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(texts);
  return [];
}

void describe("UI text", () => {
  afterEach(() => setCurrentLanguage("en"));

  void it("has the same keys in every language", () => {
    assert.deepEqual(shape(es), shape(en));
  });

  void it("has no empty text", () => {
    for (const text of [...texts(en), ...texts(es)]) assert.notEqual(text.trim(), "");
  });

  void it("builds error messages in the current language", () => {
    setCurrentLanguage("es");
    assert.equal(
      questionErrorMessage("AI_DAILY_LIMIT", 7_200),
      "Llegaste al límite de preguntas de reglas de hoy. Inténtalo de nuevo en 2 horas.",
    );
    setCurrentLanguage("en");
    assert.equal(
      questionErrorMessage("AI_DAILY_LIMIT", 7_200),
      "You have reached today's limit of rules questions. Try again in 2 hours.",
    );
  });
});
