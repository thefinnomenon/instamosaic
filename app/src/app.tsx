import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import "./app.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <main class="app-shell">
          <Suspense>{props.children}</Suspense>
          <footer class="app-footer">
            <a href="mailto:chris@finnternet.com">Contact Us</a>
          </footer>
        </main>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
