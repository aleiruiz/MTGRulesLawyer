import eslint from "@eslint/js";
import importX from "eslint-plugin-import-x";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.expo/**", "coverage/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  { files: ["**/*.ts", "**/*.tsx"], plugins: { "@typescript-eslint": tseslint.plugin } },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "import-x": importX },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "import-x/no-cycle": "error",
    },
  },
  {
    files: ["apps/api/**/*.ts", "packages/contracts/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/mobile/**/*.tsx"],
    languageOptions: { globals: globals.browser },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Expo uses the automatic JSX runtime, and TypeScript provides component prop checking.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  { files: ["**/*.mjs", "**/*.js"], languageOptions: { globals: globals.node } },
);
