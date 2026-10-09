import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules",
      "**/node_modules/**",
      "node_modules/**",
      "apps/mobile/node_modules/**",
      "**/dist/**",
      "**/.expo/**",
      "coverage/**",
    ],
  },
  eslint.configs.recommended,
  // API and contracts get type-aware server rules from their workspace tsconfigs.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["apps/api/**/*.ts", "packages/contracts/**/*.ts"],
  })),
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["apps/mobile/**/*.ts", "apps/mobile/**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "@typescript-eslint": tseslint.plugin },
  },
  {
    files: ["apps/api/**/*.ts", "packages/contracts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./apps/*/tsconfig.json", "./packages/*/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
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
    files: ["apps/mobile/**/*.ts", "apps/mobile/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: ["./apps/mobile/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["apps/api/**/*.ts", "packages/contracts/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  // Expo app files use React Native globals, Hooks rules, and typed TypeScript linting.
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        __DEV__: "readonly",
        fetch: "readonly",
        process: "readonly",
      },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
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
  prettier,
);
