// ESLint flat config.
//
// eslint-config-next v16 ships NATIVE flat configs (`./core-web-vitals`,
// `./typescript` both export a config array) and requires eslint >= 9. Running
// them through FlatCompat — which exists to adapt OLD eslintrc-style shareable
// configs — fed a flat config into the eslintrc schema validator. Validation
// failed, and the validator then crashed formatting its own error message:
//   TypeError: Converting circular structure to JSON
//     ... property 'plugins' -> object with constructor 'Object'
//     --- property 'react' closes the circle
// (the react plugin object self-references, which JSON.stringify can't handle).
// That masked the real error and made lint unusable repo-wide. Import directly.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    // Build output and vendored code — never lint these. `.next` in particular
    // contains generated chunks that produce thousands of meaningless errors.
    ignores: [
      ".next/**",
      "dist/**",
      "node_modules/**",
      "next-env.d.ts",
      "supabase_types.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
