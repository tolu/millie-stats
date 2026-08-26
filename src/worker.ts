/// <reference types="@solidjs/vite-plugin/virtual-solid-manifest" />
// The Cloudflare-side entry.
//
// Solid's start mode hands server-function dispatch to us
// (serverFunctions.devMiddleware: false) so "use server" code runs inside
// workerd and sees the real D1 binding in dev, exactly as in production. The
// Cloudflare plugin owns every dev request, so this entry also has to serve
// the document shell — Solid's own dev middleware stands down when a provider
// takes the environment.
//
// In production the static assets binding answers first and only /_server and
// SPA deep links reach this code.
//
// The manifest import is a side effect on purpose: without it, functions only
// referenced from client code never register.
import { handleRequest } from "virtual:solid-ssr-handler";
import { handleServerFunctionRequest } from "virtual:solid-server-function-handler";
import "virtual:solid-server-function-manifest";

// Re-exported for the plugin's post-build step: it imports the built
// dist/server/server.js and calls handleRequest() once to prerender the
// document shell into dist/client/index.html. Our entry replaced Solid's, so
// the export has to come back out through here.
export { handleRequest };

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/_server" || url.pathname.startsWith("/_server/")) {
      return handleServerFunctionRequest(request);
    }
    return handleRequest(request);
  },
};
