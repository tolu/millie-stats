/// <reference types="vite/client" />

// Replaced at build time by `define` in vite.config.ts — see buildStamp there.
declare const __BUILD_SHA__: string;
declare const __BUILT_AT__: string;

// Only the one function vite.config.ts uses, rather than adding @types/node:
// tsconfig's `types` array is deliberately narrow, and Node's globals would
// collide with @cloudflare/workers-types' Request/Response/fetch.
declare module "node:child_process" {
  export function execSync(
    command: string,
    options: { encoding: "utf8"; stdio?: readonly string[] },
  ): string;
}
