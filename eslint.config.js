// ESLint flat config (v9). Carica la custom rule locale per branded numeric types.
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
  // Negli altri pacchetti la rule è warning (cli/web possono usare math standard
  // su valori che NON arrivano dal core). L'engine è il guardiano.
  {
    files: ["packages/cli/src/**/*.ts", "packages/web/src/**/*.ts"],
    languageOptions: tsLanguageOptions,
    plugins: { "marble-love": marbleLove },
    rules: {
      "marble-love/no-raw-arith-on-branded": "warn",
    },
  },
  // oracle/ e harness/ sono fuori dai packages — base TS lint senza rule custom.
  {
    files: ["oracle/**/*.ts", "harness/**/*.ts"],
    languageOptions: tsLanguageOptions,
  },
];
