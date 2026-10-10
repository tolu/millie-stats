import { execSync } from "node:child_process";
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

/**
 * What the footer shows, so "is my fix live?" is answerable from the phone.
 *
 * The dirty marker matters: a build from an uncommitted worktree carries a sha
 * that does not describe what is running, and a build stamp you cannot trust
 * is worse than none. Falls back gracefully — a tarball with no .git still
 * builds, and the date alone still tells you whether a deploy landed.
 */
function buildStamp(): { sha: string; builtAt: string } {
  const git = (command: string): string =>
    execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let sha = "ukjent";
  try {
    sha = git("git rev-parse --short HEAD");
    if (git("git status --porcelain") !== "") sha += "-dirty";
  } catch {
    // Not a git checkout. Leave the fallback.
  }
  return { sha, builtAt: new Date().toISOString() };
}

const stamp = buildStamp();

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(stamp.sha),
    __BUILT_AT__: JSON.stringify(stamp.builtAt),
  },
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
