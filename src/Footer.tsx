import { For } from "solid-js";
import { formatShort } from "./lib/date";

/**
 * Which build is running, and where to look when it misbehaves.
 *
 * It sits inside the auth gate, so the links are only ever shown to someone
 * already signed in. They point at Cloudflare's dashboard, which asks for its
 * own login anyway — the `:account` placeholder is resolved by Cloudflare, so
 * no account id is written down here.
 */
export default function Footer() {
  // The stamp is an ISO instant; its date half is already a calendar day.
  const day = __BUILT_AT__.slice(0, 10);
  const built = `${formatShort(day)} ${day.slice(0, 4)}`;

  return (
    <footer class="footer">
      <p class="footer-build">
        {__BUILD_SHA__} · {built}
      </p>
      <p class="footer-links">
        <For each={LINKS}>
          {(link, index) => (
            <>
              {index() > 0 ? " · " : null}
              <a href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </>
          )}
        </For>
      </p>
    </footer>
  );
}

/**
 * The Cloudflare account these resources live in.
 *
 * Not a secret: an account id is an identifier, useless without an API token,
 * and this repository has carried the D1 `database_id` in wrangler.jsonc since
 * the first commit. Kept in one place so moving account is one edit.
 */
const ACCOUNT = "25b5c1e5fa76ec2926c5e103e9662f5d";
const DASH = `https://dash.cloudflare.com/${ACCOUNT}`;
/** Both worker links are tabs on the same service page. */
const WORKER = "/workers/services/view/millie-stats/production";
/** The same id as `d1_databases[0].database_id` in wrangler.jsonc. */
const D1_DATABASE = "d6f1686c-afce-49c9-8faf-e693579de54f";

const LINKS = [
  { label: "Worker", href: `${DASH}${WORKER}/metrics` },
  { label: "Logger", href: `${DASH}${WORKER}/observability/events` },
  { label: "D1", href: `${DASH}/workers/d1/databases/${D1_DATABASE}/metrics` },
  { label: "R2", href: `${DASH}/r2/default/buckets/millie-photos` },
  { label: "GitHub", href: "https://github.com/tolu/millie-stats" },
] as const;
