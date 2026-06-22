import { createHandler, StartServer } from "@solidjs/start/server";
import type { JSX } from "solid-js";

type DocumentProps = {
  assets: JSX.Element;
  children: JSX.Element;
  scripts: JSX.Element;
};

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }: DocumentProps) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#f6f7f4" />
          <title>InstaMosaic</title>
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
