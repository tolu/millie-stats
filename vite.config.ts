import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
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
