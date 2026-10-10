/// <reference types="vite/client" />

// Replaced at build time by `define` in vite.config.ts — see buildStamp there.
declare const __BUILD_SHA__: string;
declare const __BUILT_AT__: string;

declare module "virtual:solid-ssr-handler" {
  export function handleRequest(request: Request): Promise<Response>;
  const app: { fetch(request: Request): Promise<Response> };
  export default app;
}
declare module "virtual:solid-server-function-handler" {
  export function handleServerFunctionRequest(request: Request): Promise<Response>;
}
declare module "virtual:solid-server-function-manifest" {}

// Only the one function vite.config.ts uses, rather than adding @types/node:
// tsconfig's `types` array is deliberately narrow, and Node's globals would
// collide with @cloudflare/workers-types' Request/Response/fetch.
declare module "node:child_process" {
  export function execSync(
    command: string,
    options: { encoding: "utf8"; stdio?: readonly string[] },
  ): string;
}
