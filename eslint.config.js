// ESLint flat config (v9). Loads the local custom rule for branded numeric types.
import tsParser from "@typescript-eslint/parser";
import marbleLove from "./eslint-rules/index.js";

const tsLanguageOptions = {
  parser: tsParser,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/*.d.ts",
      "ghidra_project/**",
      "traces/**",
      "runs/**",
    ],
  },
  {
    files: ["packages/engine/src/**/*.ts"],
    languageOptions: tsLanguageOptions,
    plugins: { "marble-love": marbleLove },
    rules: {
      "marble-love/no-raw-arith-on-branded": "error",
    },
  },
  // Outside the engine this rule is a warning: CLI/web code can use ordinary
  // math for values that do not come from the core engine model.
  {
    files: ["packages/cli/src/**/*.ts", "packages/web/src/**/*.ts"],
    languageOptions: tsLanguageOptions,
    plugins: { "marble-love": marbleLove },
    rules: {
      "marble-love/no-raw-arith-on-branded": "warn",
    },
  },
  // oracle/ and harness/ sit outside packages; lint them without the custom rule.
  {
    files: ["oracle/**/*.ts", "harness/**/*.ts"],
    languageOptions: tsLanguageOptions,
  },
];
