import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Custom plugin: prevent useSearchParams() in page default exports without Suspense.
// Next.js requires useSearchParams to be in a Suspense-wrapped child component,
// otherwise static generation fails at build time.
const bobbinryPlugin = {
  rules: {
    "require-suspense-with-search-params": {
      meta: {
        type: "problem",
        messages: {
          requireSuspense:
            "useSearchParams() in a page's default export must be moved to a child component wrapped in <Suspense>. " +
            "See: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout",
        },
      },
      create(context) {
        const filename = context.filename || context.getFilename();
        if (
          !filename.includes("/app/") ||
          (!filename.endsWith("page.tsx") && !filename.endsWith("page.jsx"))
        ) {
          return {};
        }

        return {
          'CallExpression[callee.name="useSearchParams"]'(node) {
            let current = node.parent;
            let containingFunction = null;
            while (current) {
              if (
                current.type === "FunctionDeclaration" ||
                current.type === "FunctionExpression" ||
                current.type === "ArrowFunctionExpression"
              ) {
                containingFunction = current;
                break;
              }
              current = current.parent;
            }
            if (!containingFunction) return;

            if (
              containingFunction.parent &&
              containingFunction.parent.type === "ExportDefaultDeclaration"
            ) {
              context.report({ node, messageId: "requireSuspense" });
            }
          },
        };
      },
    },
  },
};

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    plugins: {
      bobbinry: bobbinryPlugin,
    },
    // Override rules — @typescript-eslint plugin is already loaded by nextTypescript above
    rules: {
      "bobbinry/require-suspense-with-search-params": "error",
      // Browser dialogs (alert/confirm/prompt) are banned — they block the event loop,
      // can't be styled or themed, and break the app's UX consistency. Use the inline
      // toast pattern (see apps/shell/src/app/membership/page.tsx) or a proper modal.
      "no-alert": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-assign-module-variable": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react/no-unescaped-entities": "off",
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "drizzle-orm",
            message: "Shell must not import drizzle-orm directly. Use the Fastify API via SDK instead.",
          },
          {
            name: "drizzle-orm/postgres-js",
            message: "Shell must not import drizzle-orm directly. Use the Fastify API via SDK instead.",
          },
          {
            name: "@/lib/db",
            message: "Shell must not import DB modules directly. Use the Fastify API via SDK instead.",
          },
        ],
      }],
    },
  },
];

export default eslintConfig;
