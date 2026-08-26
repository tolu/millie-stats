import { createSignal, Show } from "solid-js";

/**
 * The only thing between the open internet and the journal — and, more to the
 * point, between the internet and an endpoint that spends Anthropic credits.
 */
export default function Login(props: { onSuccess: () => void }) {
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy()) return;

    // Read the field at submit time rather than tracking it in a signal.
    // Password managers fill the input without firing input events, and a
    // programmatic fill-then-submit lands in the same tick, where Solid has
    // not flushed the signal yet. Both would submit an empty passphrase.
    const form = event.currentTarget as HTMLFormElement;
    const passphrase = String(new FormData(form).get("passphrase") ?? "");

    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/_login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (response.ok) props.onSuccess();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="login">
      <img src="/millie-hero.webp" alt="Millie" width="320" height="239" />
      <h1>Millie</h1>
      <p class="muted">Pinnedyr og Border Collie</p>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          <span>Passord</span>
          <input
            type="password"
            name="passphrase"
            autocomplete="current-password"
            required
          />
        </label>
        <button type="submit" disabled={busy()}>
          {busy() ? "Sjekker…" : "Logg inn"}
        </button>
        <Show when={failed()}>
          <p class="login-error" role="alert">
            Feil passord.
          </p>
        </Show>
      </form>
    </div>
  );
}
