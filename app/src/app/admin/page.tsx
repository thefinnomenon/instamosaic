"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, Send, X } from "lucide-react";
import { Badge, Button, Panel, TextInput } from "../../components/ui.tsx";

type Metrics = Record<string, any>;
type BatchResult = { username: string; status: "queued" | "failed"; jobId?: string; heroSource?: string; error?: string };

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncingPrintOrder, setSyncingPrintOrder] = useState<number | null>(null);
  const [marketingUsernames, setMarketingUsernames] = useState("");
  const [marketingReviewEmail, setMarketingReviewEmail] = useState("");
  const [marketingHeroSource, setMarketingHeroSource] = useState("auto");
  const [marketingRightsStatus, setMarketingRightsStatus] = useState("unknown");
  const [marketingRightsNotes, setMarketingRightsNotes] = useState("");
  const [marketingCaptionTemplate, setMarketingCaptionTemplate] = useState("");
  const [marketingSubmitting, setMarketingSubmitting] = useState(false);
  const [marketingResults, setMarketingResults] = useState<BatchResult[]>([]);
  const [marketingActionId, setMarketingActionId] = useState<number | null>(null);
  const [publishUrls, setPublishUrls] = useState<Record<number, string>>({});
  const [copiedPostId, setCopiedPostId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin", { headers: { "x-admin-password": password } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load dashboard.");
      setMetrics(data.metrics);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  async function syncPrintOrder(id: unknown) {
    const printOrderId = Number(id);
    if (!Number.isInteger(printOrderId) || printOrderId <= 0 || syncingPrintOrder) return;
    setSyncingPrintOrder(printOrderId);
    setError("");
    try {
      const response = await fetch(`/api/admin/print-orders/${printOrderId}/sync`, {
        method: "POST",
        headers: { "x-admin-password": password }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to sync print order.");
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Unable to sync print order.");
    } finally {
      setSyncingPrintOrder(null);
    }
  }

  async function createMarketingBatch() {
    if (marketingSubmitting) return;
    setMarketingSubmitting(true);
    setError("");
    setMarketingResults([]);
    try {
      const form = new FormData();
      form.set("usernames", marketingUsernames);
      form.set("reviewEmail", marketingReviewEmail);
      form.set("heroSource", marketingHeroSource);
      form.set("rightsStatus", marketingRightsStatus);
      form.set("rightsNotes", marketingRightsNotes);
      form.set("captionTemplate", marketingCaptionTemplate);
      const response = await fetch("/api/admin/marketing/batch", {
        method: "POST",
        headers: { "x-admin-password": password },
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !Array.isArray(data.results)) throw new Error(data.error || "Unable to create marketing batch.");
      setMarketingResults(data.results || []);
      await load();
    } catch (batchError) {
      setError(batchError instanceof Error ? batchError.message : "Unable to create marketing batch.");
    } finally {
      setMarketingSubmitting(false);
    }
  }

  async function updateMarketingPost(id: unknown, action: "approve" | "reject") {
    const postId = Number(id);
    if (!Number.isInteger(postId) || postId <= 0 || marketingActionId) return;
    setMarketingActionId(postId);
    setError("");
    try {
      const response = await fetch(`/api/admin/marketing/posts/${postId}/${action}`, {
        method: "POST",
        headers: { "x-admin-password": password }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Unable to ${action} marketing post.`);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Unable to ${action} marketing post.`);
    } finally {
      setMarketingActionId(null);
    }
  }

  async function markMarketingPublished(id: unknown) {
    const postId = Number(id);
    if (!Number.isInteger(postId) || postId <= 0 || marketingActionId) return;
    setMarketingActionId(postId);
    setError("");
    try {
      const response = await fetch(`/api/admin/marketing/posts/${postId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ permalink: publishUrls[postId] || "" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to mark post published.");
      await load();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Unable to mark post published.");
    } finally {
      setMarketingActionId(null);
    }
  }

  async function copyCaption(post: Record<string, unknown>) {
    const text = String(post.caption || "");
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedPostId(Number(post.id));
    window.setTimeout(() => setCopiedPostId((current) => current === Number(post.id) ? null : current), 1600);
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true" /><span>InstaMosaic Admin</span></a>
      </header>

      <Panel className="form-panel">
        <h1>Admin dashboard</h1>
        <div className="form-grid">
          <label className="label">
            Admin password
            <TextInput type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
          </label>
          <Button type="button" onClick={load} disabled={loading}>
            <RefreshCw size={17} />
            {loading ? "Loading..." : "Load Dashboard"}
          </Button>
          {error ? <p className="message" role="alert">{error}</p> : null}
        </div>
      </Panel>

      {metrics ? (
        <>
          <div className="admin-grid">
            <Metric label="Total jobs" value={metrics.totalJobs} />
            <Metric label="Completed" value={metrics.completedJobs} />
            <Metric label="Failed" value={metrics.failedJobs} />
            <Metric label="Revenue" value={`$${((metrics.revenueCents || 0) / 100).toFixed(2)}`} />
            <Metric label="Downloads" value={metrics.downloads} />
            <Metric label="Print orders" value={metrics.printOrders} />
            <Metric label="Avg time" value={formatDuration(metrics.averageProcessingSeconds)} />
            <Metric label="Completed rate" value={`${Math.round((metrics.conversion?.completedRate || 0) * 100)}%`} />
            <Metric label="Paid rate" value={`${Math.round((metrics.conversion?.paidRate || 0) * 100)}%`} />
          </div>

          <Panel className="form-panel">
            <div className="admin-section-header">
              <div>
                <h2>Marketing batch</h2>
                <p className="lede">Queue public accounts, auto-pick hero images, generate mosaics, and prepare review drafts.</p>
              </div>
              <Button type="button" variant="secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</Button>
            </div>
            <div className="marketing-form-grid">
              <label className="label marketing-usernames">
                Instagram usernames
                <textarea className="field textarea" rows={6} value={marketingUsernames} onChange={(event) => setMarketingUsernames(event.currentTarget.value)} placeholder="@username, @another_username" />
              </label>
              <div className="form-grid">
                <label className="label">
                  Review email
                  <TextInput value={marketingReviewEmail} onChange={(event) => setMarketingReviewEmail(event.currentTarget.value)} placeholder="chris@finnternet.com" />
                </label>
                <label className="label">
                  Hero source
                  <select className="field" value={marketingHeroSource} onChange={(event) => setMarketingHeroSource(event.currentTarget.value)}>
                    <option value="auto">Auto: profile, then most liked</option>
                    <option value="profile">Profile photo</option>
                    <option value="top_liked">Most liked post</option>
                    <option value="recent">Most recent image</option>
                  </select>
                </label>
                <label className="label">
                  Rights status
                  <select className="field" value={marketingRightsStatus} onChange={(event) => setMarketingRightsStatus(event.currentTarget.value)}>
                    <option value="unknown">Unknown</option>
                    <option value="cleared">Cleared</option>
                    <option value="needs_review">Needs review</option>
                  </select>
                </label>
              </div>
              <label className="label marketing-usernames">
                Caption template
                <textarea className="field textarea" rows={5} value={marketingCaptionTemplate} onChange={(event) => setMarketingCaptionTemplate(event.currentTarget.value)} placeholder={"We turned @{username}'s Instagram into a mosaic.\n\nWant one? instamosaic.com\n\n@{username} #InstaMosaic"} />
              </label>
              <label className="label">
                Rights notes
                <textarea className="field textarea" rows={5} value={marketingRightsNotes} onChange={(event) => setMarketingRightsNotes(event.currentTarget.value)} placeholder="License, permission, or internal review notes" />
              </label>
            </div>
            <div className="button-row">
              <Button type="button" onClick={createMarketingBatch} disabled={marketingSubmitting}><Send size={16} /> {marketingSubmitting ? "Queueing..." : "Queue Marketing Drafts"}</Button>
            </div>
            {marketingResults.length ? (
              <div className="batch-results">
                {marketingResults.map((result) => (
                  <div key={result.username} className={`batch-result batch-result-${result.status}`}>
                    <strong>@{result.username}</strong>
                    <span>{result.status === "queued" ? `Queued ${result.heroSource || ""}` : result.error}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>

          <MarketingQueue
            posts={metrics.recentMarketingPosts || []}
            actionId={marketingActionId}
            copiedPostId={copiedPostId}
            publishUrls={publishUrls}
            onCopyCaption={copyCaption}
            onApprove={(id) => updateMarketingPost(id, "approve")}
            onReject={(id) => updateMarketingPost(id, "reject")}
            onPublishUrl={(id, value) => setPublishUrls((current) => ({ ...current, [Number(id)]: value }))}
            onMarkPublished={markMarketingPublished}
          />

          <AdminTable title="Recent jobs" rows={metrics.recentJobs || []} />
          <AdminTable title="Recent print orders" rows={metrics.recentPrintOrders || []} action={(row) => (
            <Button type="button" variant="secondary" onClick={() => syncPrintOrder(row.id)} disabled={syncingPrintOrder === row.id}>
              <RefreshCw size={14} /> {syncingPrintOrder === row.id ? "Syncing..." : "Sync"}
            </Button>
          )} />
          <AdminTable title="Recent analytics" rows={metrics.recentAnalytics || []} />
          <AdminTable title="Recent errors" rows={metrics.recentErrors || []} />
        </>
      ) : null}
    </div>
  );
}

function MarketingQueue(props: {
  posts: Record<string, unknown>[];
  actionId: number | null;
  copiedPostId: number | null;
  publishUrls: Record<number, string>;
  onCopyCaption: (post: Record<string, unknown>) => void;
  onApprove: (id: unknown) => void;
  onReject: (id: unknown) => void;
  onPublishUrl: (id: unknown, value: string) => void;
  onMarkPublished: (id: unknown) => void;
}) {
  return (
    <Panel className="form-panel">
      <h2>Marketing review queue</h2>
      <div className="marketing-list">
        {props.posts.length ? props.posts.map((post) => {
          const id = Number(post.id);
          const status = String(post.status || "draft");
          const username = String(post.target || post.username || "");
          const jobId = String(post.job_id || "");
          const token = String(post.download_token || "");
          const busy = props.actionId === id;
          return (
            <article className="marketing-card" key={id}>
              <div className="marketing-card-header">
                <div>
                  <h3>@{username}</h3>
                  <div className="marketing-meta">
                    <Badge tone={badgeTone(status)}>{status}</Badge>
                    <span>{String(post.kind || "post")}</span>
                    <span>{String(post.best_asset_type || "asset pending")}</span>
                    {post.job_status && post.job_status !== "completed" ? <span>{String(post.job_status)} {String(post.job_progress || 0)}%</span> : null}
                  </div>
                </div>
                {jobId ? <a className="button button-secondary" href={`/status/${jobId}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Status</a> : null}
              </div>

              <div className="marketing-assets">
                {jobId ? <a href={`/api/jobs/${jobId}/preview`} target="_blank" rel="noreferrer">Social preview</a> : null}
                {jobId ? <a href={`/api/jobs/${jobId}/preview?kind=square`} target="_blank" rel="noreferrer">Square preview</a> : null}
                {token ? <a href={`/api/download/${token}/reveal`} target="_blank" rel="noreferrer">Reveal video</a> : null}
                {post.best_asset_path ? <span>{String(post.best_asset_path)}</span> : null}
              </div>

              <pre className="caption-preview">{String(post.caption || "")}</pre>

              <div className="button-row">
                <Button type="button" variant="secondary" onClick={() => props.onCopyCaption(post)}><Copy size={14} /> {props.copiedPostId === id ? "Copied" : "Copy Caption"}</Button>
                <a className="button button-secondary" href="https://www.instagram.com/" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open Instagram</a>
                <Button type="button" onClick={() => props.onApprove(id)} disabled={busy || status === "approved" || status === "published"}><Check size={14} /> Approve</Button>
                <Button type="button" variant="danger" onClick={() => props.onReject(id)} disabled={busy || status === "published"}><X size={14} /> Reject</Button>
              </div>

              <div className="publish-row">
                <TextInput value={props.publishUrls[id] || String(post.permalink || "")} onChange={(event) => props.onPublishUrl(id, event.currentTarget.value)} placeholder="Paste Instagram URL after publishing" />
                <Button type="button" variant="secondary" onClick={() => props.onMarkPublished(id)} disabled={busy || status === "published"}>Mark Published</Button>
              </div>
            </article>
          );
        }) : <p className="lede">No marketing drafts yet.</p>}
      </div>
    </Panel>
  );
}

function Metric(props: { label: string; value: unknown }) {
  return (
    <div className="metric">
      <strong>{String(props.value ?? 0)}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function AdminTable(props: { title: string; rows: Record<string, unknown>[]; action?: (row: Record<string, unknown>) => React.ReactNode }) {
  const keys = Object.keys(props.rows[0] || {}).slice(0, 8);
  return (
    <Panel className="form-panel">
      <h2>{props.title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {keys.map((key) => <th key={key}>{key}</th>)}
              {props.action ? <th>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, index) => (
              <tr key={String(row.id ?? index)}>
                {keys.map((key) => <td key={key}>{formatValue(row[key])}</td>)}
                {props.action ? <td>{props.action(row)}</td> : null}
              </tr>
            ))}
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

function formatDuration(value: unknown): string {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes <= 0) return `${remainingSeconds}s`;
  return `${minutes}m${remainingSeconds}s`;
}

function badgeTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "published" || status === "approved") return "success";
  if (status === "failed" || status === "rejected") return "danger";
  if (status === "draft" || status === "scheduled") return "warning";
  return "neutral";
}
