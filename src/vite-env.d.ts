/// <reference types="vite/client" />

declare module "virtual:solid-ssr-handler" {
  export function handleRequest(request: Request): Promise<Response>;
  const app: { fetch(request: Request): Promise<Response> };
  export default app;
}
declare module "virtual:solid-server-function-handler" {
  export function handleServerFunctionRequest(request: Request): Promise<Response>;
}
declare module "virtual:solid-server-function-manifest" {}
