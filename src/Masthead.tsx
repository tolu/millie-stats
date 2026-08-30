import type { JSX } from "@solidjs/web";

/**
 * The header, shared by every page.
 *
 * Page-specific controls go in through `children` rather than being props, so
 * nothing here has to know about a day, an entry or a weight. The day view
 * passes its already-bound <Weight> straight through.
 */
export default function Masthead(props: {
  /** Where the toggle goes from here — also what its label announces. */
  to: "journal" | "day";
  onToggle: () => void;
  children?: JSX.Element;
}) {
  return (
    <header class="masthead">
      <img class="mark" src="/millie-mark.webp" alt="" width="56" height="56" />
      <div>
        <h1>Millie</h1>
        <p>Pinnedyr og Border Collie</p>
      </div>
      {/* One group, so controls sit in the same place on every page. */}
      <div class="masthead-actions">
        {props.children}
        {/* Icon-only, so aria-label is the button's ONLY name. It says where
            the press goes rather than using aria-pressed: this codebase has
            been bitten by boolean ARIA attributes before. */}
        <button
          type="button"
          class="nav-toggle"
          onClick={props.onToggle}
          aria-label={props.to === "journal" ? "Vis journalen" : "Vis dagen"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {props.to === "journal" ? (
              <>
                <path d="M5 4h13a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5z" />
                <path d="M5 4v16" />
                <path d="M9 9h6M9 13h6" />
              </>
            ) : (
              <path d="M15 5l-7 7 7 7" />
            )}
          </svg>
        </button>
      </div>
    </header>
  );
}
