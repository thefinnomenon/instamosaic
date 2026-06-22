import { RefreshCw } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { Button, Panel, TextInput } from "../components/ui.tsx";

type Metrics = Record<string, any>;

export default function AdminPage() {
  const [password, setPassword] = createSignal("");
  const [metrics, setMetrics] = createSignal<Metrics | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin", { headers: { "x-admin-password": password() } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load dashboard.");
      setMetrics(data.metrics);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="page">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true" />
          <span>InstaMosaic Admin</span>
        </div>
      </header>

      <Panel class="form-panel">
        <h1>Admin dashboard</h1>
        <div class="form-grid">
          <label class="label">
            Admin password
            <TextInput type="password" value={password()} onInput={(event) => setPassword(event.currentTarget.value)} />
          </label>
          <Button type="button" onClick={load} disabled={loading()}>
            <RefreshCw size={17} />
            {loading() ? "Loading..." : "Load Dashboard"}
          </Button>
          <Show when={error()}>
            <p class="message" role="alert">{error()}</p>
          </Show>
        </div>
      </Panel>

      <Show when={metrics()}>
        {(data) => (
          <>
            <div class="admin-grid">
              <Metric label="Total jobs" value={data().totalJobs} />
              <Metric label="Completed" value={data().completedJobs} />
              <Metric label="Failed" value={data().failedJobs} />
              <Metric label="Revenue" value={`$${((data().revenueCents || 0) / 100).toFixed(2)}`} />
              <Metric label="Downloads" value={data().downloads} />
              <Metric label="Avg seconds" value={data().averageProcessingSeconds} />
              <Metric label="Completed rate" value={`${Math.round((data().conversion?.completedRate || 0) * 100)}%`} />
              <Metric label="Paid rate" value={`${Math.round((data().conversion?.paidRate || 0) * 100)}%`} />
            </div>

            <AdminTable title="Recent jobs" rows={data().recentJobs || []} />
            <AdminTable title="Recent analytics" rows={data().recentAnalytics || []} />
            <AdminTable title="Recent errors" rows={data().recentErrors || []} />
          </>
        )}
      </Show>
    </div>
  );
}

function Metric(props: { label: string; value: unknown }) {
  return (
    <div class="metric">
      <strong>{String(props.value ?? 0)}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function AdminTable(props: { title: string; rows: Record<string, unknown>[] }) {
  const keys = () => Object.keys(props.rows[0] || {}).slice(0, 8);
  return (
    <Panel class="form-panel">
      <h2>{props.title}</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <For each={keys()}>{(key) => <th>{key}</th>}</For>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(row) => (
                <tr>
                  <For each={keys()}>
                    {(key) => <td>{formatValue(row[key])}</td>}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function formatValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string" && value.length > 120) return `${value.slice(0, 117)}...`;
  return String(value);
}
