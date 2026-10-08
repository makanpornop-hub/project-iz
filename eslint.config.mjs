import tseslint from "typescript-eslint";
export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".runtime/**",
      ".data/**",
      ".logs/**",
      "backups/**",
      "next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
