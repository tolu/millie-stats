import type { JSX } from "@solidjs/web";

export default function Document(props: { children?: JSX.Element }) {
  return (
    <html lang="no">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Millie - Pinnedyr og Border Collie</title>
      </head>
      <body>{props.children}</body>
    </html>
  );
}
