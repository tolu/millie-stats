import { createMemo, createSignal, Errored, Match, onSettled, Switch } from "solid-js";
import "./styles.css";
import Day from "./Day";
import Journal from "./Journal";
import Login from "./Login";
import { osloDay } from "./lib/date";
import { routeFromSearch, searchForRoute } from "./lib/url";
import type { Route } from "./lib/url";

type AuthState = { authorised: boolean; configured: boolean };

// Registering makes the app installable on Android; iOS needs only the
// manifest. The worker itself caches nothing — see public/sw.js.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // An unavailable service worker costs installability, nothing else.
  });
}

export default function App() {
  const [auth, setAuth] = createSignal<AuthState | null>(null);

  // Asked once on boot. The document shell is a static prerendered file, so it
  // cannot carry per-request state — the client has to discover it.
  void fetch("/_auth")
    .then((r) => r.json() as Promise<AuthState>)
    .then(setAuth)
    .catch(() => setAuth({ authorised: false, configured: true }));

  // An explicit three-state view rather than nested <Show>: the nested form
  // kept the login on screen after a successful sign-in, because the outer
  // condition stayed truthy and its callback never re-evaluated.
  const view = createMemo(() => {
    const state = auth();
    if (!state) return "checking" as const;
    return state.authorised ? ("signed-in" as const) : ("login" as const);
  });

  return (
    <Switch>
      <Match when={view() === "checking"}>
        <div class="login" />
      </Match>
      <Match when={view() === "login"}>
        <Login
          configured={auth()?.configured ?? false}
          onSuccess={() => setAuth({ configured: true, authorised: true })}
        />
      </Match>
      <Match when={view() === "signed-in"}>
        {/* A failed read must not take the whole page down. Without this a
            single database hiccup replaces the app with a blank error page and
            no way back. */}
        <Errored fallback={(error, reset) => <Failure error={error} reset={reset} />}>
          <SignedIn />
        </Errored>
      </Match>
    </Switch>
  );
}

/**
 * Owns the route. Both pages sit inside App's error boundary, so a database
 * hiccup on either still degrades to <Failure> rather than a blank page.
 */
function SignedIn() {
  const today = osloDay();
  const [route, setRoute] = createSignal<Route>(routeFromSearch(location.search, today));

  onSettled(() => {
    // The browser would otherwise try to restore a scroll offset into a page
    // that has not rendered its list yet.
    history.scrollRestoration = "manual";
    const onPop = () => setRoute(routeFromSearch(location.search, today));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  });

  /**
   * A change of page pushes; moving between days replaces.
   *
   * That is what makes Back leave the journal, and leave a day opened from the
   * journal, without walking back through every day browsed with the chevrons.
   */
  function go(next: Route) {
    const changedView = next.view !== route().view;
    const search = searchForRoute(next, today) || location.pathname;
    if (changedView) history.pushState(null, "", search);
    else history.replaceState(null, "", search);
    setRoute(next);
    // The day view is long; without this the journal opens mid-list.
    if (changedView) scrollTo(0, 0);
  }

  return (
    <div class="shell">
      <Switch>
        <Match when={route().view === "day"}>
          <Day
            today={today}
            day={route().day}
            onDay={(day) => go({ view: "day", day })}
            onJournal={() => go({ view: "journal", day: route().day })}
          />
        </Match>
        <Match when={route().view === "journal"}>
          <Journal
            onDay={() => go({ view: "day", day: route().day })}
            onOpenDay={(day) => go({ view: "day", day })}
          />
        </Match>
      </Switch>
    </div>
  );
}

function Failure(props: { error: unknown; reset: () => void }) {
  const message = createMemo(() => {
    const raw = props.error;
    const value = typeof raw === "function" ? (raw as () => unknown)() : raw;
    return value instanceof Error ? value.message : String(value);
  });

  return (
    <div class="failure" role="alert">
      <h2>Noe gikk galt</h2>
      <p class="muted">{message()}</p>
      <button type="button" onClick={() => props.reset()}>
        Prøv igjen
      </button>
    </div>
  );
}
