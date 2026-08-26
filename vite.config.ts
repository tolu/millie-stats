import { defineConfig, type Plugin } from "vite";
import solid from "@solidjs/vite-plugin";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Builds the client environment before anything else.
 *
 * The server bundle reads the client manifest at build time to write the entry
 * script tag into the prerendered shell. @cloudflare/vite-plugin orchestrates
 * the build and puts its server environment first, so without this the shell
 * bakes in the PREVIOUS build's asset hash and production serves an index.html
 * pointing at a script that no longer exists — a blank page, no error until
 * the browser rejects the SPA fallback's text/html as a module.
 *
 * Solid does this itself when start mode runs with ssr: true. In client mode
 * it does not, so we do it here.
 */
function buildClientFirst(): Plugin {
  return {
    name: "millie:build-client-first",
    buildApp: {
      order: "pre",
      async handler(builder) {
        const client = builder.environments["client"];
        if (client && !client.isBuilt) await builder.build(client);
      },
    },
  };
}

export default defineConfig({
  plugins: [
    buildClientFirst(),
    // The Cloudflare plugin adopts Solid's `ssr` environment, so server
    // functions run inside workerd in dev exactly as they do in production —
    // meaning the D1 binding is the real thing, not a node-side stub.
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    // Client start mode: no index.html, no mount file. src/App.tsx is the app,
    // src/Document.tsx is the shell. `devMiddleware: false` hands server
    // function dispatch to the Cloudflare plugin so bindings are visible.
    solid({ start: true, serverFunctions: { devMiddleware: false } }),
  ],
});
