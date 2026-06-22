import { A, useLocation, useParams } from "@solidjs/router";
import { Clock, CreditCard, Download, LoaderCircle, Maximize2, Minus, Plus, Printer, XCircle } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Badge, Button, Panel, trackUiEvent } from "../../../components/ui.tsx";

type PublicJob = {
  id: string;
  username: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  step: string;
  queuePosition: number | null;
  igPostCount: number;
  downloadedCount: number;
  skippedCount: number;
  photosUsed: number;
  processingStartedAt: string | null;
  processingSeconds: number | null;
  oldestImagePostAt: string | null;
  newestImagePostAt: string | null;
  heroWidth: number | null;
  heroHeight: number | null;
  mosaicWidth: number | null;
  mosaicHeight: number | null;
  errorMessage: string | null;
  paid: boolean;
  downloadToken?: string;
};

const tileCells = Array.from({ length: 80 });
const MIN_ZOOM = 50;
const MAX_ZOOM = 1000;
const ZOOM_STEP = 50;

export default function StatusPage() {
  const params = useParams();
  const location = useLocation();
  let previewFrame: HTMLDivElement | undefined;
  const activePointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
  let lastPinchDistance = 0;
  const [job, setJob] = createSignal<PublicJob | null>(null);
  const [error, setError] = createSignal("");
  const [zoom, setZoom] = createSignal(100);
  const [isDraggingPreview, setIsDraggingPreview] = createSignal(false);
  const [checkoutLoading, setCheckoutLoading] = createSignal(false);
  const [checkoutMessage, setCheckoutMessage] = createSignal("");
  const [confirmingCheckout, setConfirmingCheckout] = createSignal(false);
  const [downloadLoading, setDownloadLoading] = createSignal(false);
  const [downloadMessage, setDownloadMessage] = createSignal("");
  // Starts at 0 so the bar animates in from the left on first render.
  const [displayedProgress, setDisplayedProgress] = createSignal(0);
  createEffect(() => {
    const p = job()?.progress;
    if (p != null) requestAnimationFrame(() => setDisplayedProgress(Math.min(100, Math.max(0, Math.round(p)))));
  });
  const statusText = createMemo(() => {
    const current = job();
    if (!current) return "Loading your job...";
    if (current.status === "failed") return "Something went wrong.";
    if (current.status === "completed") return "Your mosaic is ready.";
    if (current.status === "queued") return queueStatusText(current.queuePosition);
    if (current.progress < 8) return "Checking Instagram...";
    if (current.progress < 72) return "Downloading and analyzing photos...";
    return "Building mosaic...";
  });
  const imageKind = createMemo(() => job()?.status === "completed" ? "master" : "hero");
  const checkoutSucceeded = createMemo(() => new URLSearchParams(location.search).get("checkout") === "success");

  async function load() {
    try {
      const response = await fetch(`/api/jobs/${params.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load job.");
      setJob(data.job);
      if (checkoutSucceeded() && data.job?.status === "completed" && !data.job?.paid) void confirmCheckout();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load job.");
    }
  }

  onMount(() => {
    void trackUiEvent("status_page_viewed", {}, params.id);
    void trackUiEvent("page_view", { page: "status" }, params.id);
    void load();
    const interval = window.setInterval(() => {
      const current = job();
      if (!current) return;
      if (current.status !== "completed" && current.status !== "failed") void load();
      if (checkoutSucceeded() && current.status === "completed" && !current.paid) void load();
    }, 2500);
    onCleanup(() => {
      window.clearInterval(interval);
    });
  });

  function zoomBy(delta: number, clientX?: number, clientY?: number) {
    zoomTo(zoom() + delta, clientX, clientY);
  }

  function zoomTo(nextZoom: number, clientX?: number, clientY?: number) {
    const frame = previewFrame;
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(nextZoom)));
    if (!frame || clampedZoom === zoom()) {
      setZoom(clampedZoom);
      return;
    }

    const rect = frame.getBoundingClientRect();
    const focalX = clientX == null ? rect.width / 2 : clientX - rect.left;
    const focalY = clientY == null ? rect.height / 2 : clientY - rect.top;
    const ratio = clampedZoom / zoom();
    const nextLeft = (frame.scrollLeft + focalX) * ratio - focalX;
    const nextTop = (frame.scrollTop + focalY) * ratio - focalY;

    setZoom(clampedZoom);
    requestAnimationFrame(() => {
      frame.scrollLeft = nextLeft;
      frame.scrollTop = nextTop;
    });
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (!previewFrame?.requestFullscreen) return;
    await previewFrame.requestFullscreen();
  }

  async function checkoutDigital() {
    const current = job();
    if (!current || checkoutLoading()) return;
    setCheckoutLoading(true);
    setCheckoutMessage("");
    void trackUiEvent("checkout_clicked", { product: "digital" }, current.id);

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: current.id })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to start checkout.");
      window.location.href = data.url;
    } catch (checkoutError) {
      setCheckoutMessage(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function confirmCheckout() {
    if (confirmingCheckout()) return;
    setConfirmingCheckout(true);
    setCheckoutMessage("");

    try {
      const sessionId = new URLSearchParams(location.search).get("session_id") || undefined;
      const response = await fetch("/api/stripe/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: params.id, sessionId })
      });
      const data = await response.json();
      if (response.ok) {
        setJob(data.job);
      } else if (response.status !== 409) {
        throw new Error(data.error || "Unable to confirm checkout.");
      }
    } catch (confirmError) {
      setCheckoutMessage(confirmError instanceof Error ? confirmError.message : "Unable to confirm checkout.");
    } finally {
      setConfirmingCheckout(false);
    }
  }

  async function downloadDigital() {
    const current = job();
    if (!current?.downloadToken || downloadLoading()) return;
    setDownloadLoading(true);
    setDownloadMessage("");

    try {
      const response = await fetch(`/api/download/${current.downloadToken}/bundle`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "Unable to download the digital file.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filenameFromContentDisposition(response.headers.get("Content-Disposition")) || `instamosaic-${current.username}-digital-files.zip`;
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (downloadError) {
      setDownloadMessage(downloadError instanceof Error ? downloadError.message : "Unable to download the digital file.");
    } finally {
      setDownloadLoading(false);
    }
  }

  function handlePreviewWheel(event: WheelEvent) {
    if (job()?.status !== "completed" || !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP, event.clientX, event.clientY);
  }

  function handlePreviewPointerDown(event: PointerEvent) {
    if (job()?.status !== "completed" || !previewFrame) return;
    if (event.target instanceof Element && event.target.closest(".preview-controls")) return;

    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    previewFrame.setPointerCapture(event.pointerId);

    if (activePointers.size === 2) {
      lastPinchDistance = pointerDistance();
      dragStart = null;
      setIsDraggingPreview(false);
      return;
    }

    if (zoom() <= 100) return;
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: previewFrame.scrollLeft,
      scrollTop: previewFrame.scrollTop
    };
    setIsDraggingPreview(true);
  }

  function handlePreviewPointerMove(event: PointerEvent) {
    if (job()?.status !== "completed" || !previewFrame || !activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size >= 2) {
      event.preventDefault();
      const distance = pointerDistance();
      if (lastPinchDistance > 0 && distance > 0) {
        const center = pointerCenter();
        zoomTo(zoom() * (distance / lastPinchDistance), center.x, center.y);
      }
      lastPinchDistance = distance;
      return;
    }

    if (!dragStart) return;
    event.preventDefault();
    previewFrame.scrollLeft = dragStart.scrollLeft - (event.clientX - dragStart.x);
    previewFrame.scrollTop = dragStart.scrollTop - (event.clientY - dragStart.y);
  }

  function handlePreviewPointerUp(event: PointerEvent) {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) lastPinchDistance = 0;
    if (activePointers.size === 0) {
      dragStart = null;
      setIsDraggingPreview(false);
    }
  }

  function pointerDistance(): number {
    const points = [...activePointers.values()];
    if (points.length < 2 || !points[0] || !points[1]) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function pointerCenter(): { x: number; y: number } {
    const points = [...activePointers.values()];
    if (points.length < 2 || !points[0] || !points[1]) return { x: 0, y: 0 };
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  }

  return (
    <div class="page">
      <header class="topbar">
        <A class="brand" href="/">
          <span class="brand-mark" aria-hidden="true" />
          <span>InstaMosaic</span>
        </A>
        <Show when={job()}>
          {(current) => <Badge tone={current().status === "completed" ? "success" : current().status === "failed" ? "danger" : "neutral"}>{current().status}</Badge>}
        </Show>
      </header>

      <Panel class="status-panel">
        <Show when={job()} fallback={<p class="message">{error() || "Loading job..."}</p>}>
          {(current) => (
            <div class={`status-hero ${current().status === "completed" ? "status-hero-complete" : ""}`}>
              <div class="status-copy">
                <p class="eyebrow">@{current().username}</p>
                <h1>{current().status === "completed" ? "Your mosaic is ready." : current().status === "failed" ? "We couldn't finish this mosaic." : current().status === "queued" ? "Your mosaic is queued." : "Your mosaic is processing."}</h1>
                <Show when={current().status !== "completed"}>
                  <p class="lede">{statusText()}</p>
                </Show>
              </div>

              <div
                ref={previewFrame}
                class={`status-image-wrap ${previewFrameClass(current())}${isDraggingPreview() ? " status-image-dragging" : ""}`}
                onWheel={handlePreviewWheel}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={handlePreviewPointerUp}
                onPointerCancel={handlePreviewPointerUp}
                onContextMenu={(event) => current().status === "completed" && event.preventDefault()}
              >
                <img
                  class="status-hero-image"
                  src={`/api/jobs/${current().id}/preview?kind=${imageKind()}`}
                  alt={current().status === "completed" ? `Full-resolution InstaMosaic for @${current().username}` : `Uploaded hero image for @${current().username}`}
                  draggable={false}
                  style={current().status === "completed" ? { width: `${zoom()}%` } : undefined}
                />
                <Show when={current().status === "completed"}>
                  <div class="preview-controls" aria-label="Mosaic controls">
                    <Button type="button" variant="secondary" class="icon-button preview-control" onClick={() => zoomBy(-ZOOM_STEP)} aria-label="Zoom out">
                      <Minus size={16} />
                    </Button>
                    <span class="preview-zoom-label">{zoom()}%</span>
                    <Button type="button" variant="secondary" class="icon-button preview-control" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in">
                      <Plus size={16} />
                    </Button>
                    <Button type="button" variant="secondary" class="icon-button preview-control" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
                      <Maximize2 size={16} />
                    </Button>
                  </div>
                </Show>
                <Show when={current().status !== "completed" && current().status !== "failed"}>
                  <div class="processing-overlay" aria-hidden="true">
                    <div class="tile-break-overlay">
                      <For each={tileCells}>
                        {(_, index) => <span class="tile-break-cell" style={`--tile-index:${index()};`} />}
                      </For>
                    </div>
                    <div class="processing-scan" />
                    <div class="processing-spinner">
                      <LoaderCircle class="spin" size={24} />
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </Show>

        <div class="status-progress-row">
          <span>{Math.min(100, Math.max(0, displayedProgress()))}%</span>
          <span>{statusText()}</span>
        </div>
        <div class="progress-shell" aria-label={`Progress ${displayedProgress()}%`}>
          <div class="progress-fill" style={{ width: `${displayedProgress()}%` }} />
        </div>

        <Show when={job()}>
          {(current) => (
            <>
              <Show when={current().status === "completed"}>
                <div class="status-result">
                  <div class="stat-grid">
                    <div class="stat"><span>Instagram photos used</span><strong>{current().photosUsed || current().downloadedCount}</strong></div>
                    <Show when={formatPhotoCoverage(current().oldestImagePostAt, current().newestImagePostAt)}>
                      {(coverage) => <div class="stat"><span>Photo history</span><strong>{coverage()}</strong></div>}
                    </Show>
                    <div class="stat"><span>Processing time</span><strong>{formatProcessingTime(current().processingSeconds)}</strong></div>
                  </div>

                  <div class="result-actions">
                    <Show when={current().paid && current().downloadToken} fallback={
                      <Button type="button" onClick={checkoutDigital} disabled={checkoutLoading() || confirmingCheckout()}>
                        <CreditCard size={18} />
                        {checkoutLoading() ? "Opening checkout..." : confirmingCheckout() ? "Confirming payment..." : "Buy Digital Download - $4.99"}
                      </Button>
                    }>
                      <Button type="button" onClick={downloadDigital} disabled={downloadLoading()}>
                        <Download size={16} />
                        {downloadLoading() ? "Preparing Download..." : "Download Digital"}
                      </Button>
                    </Show>
                    <Button type="button" variant="secondary" disabled>
                      <Printer size={16} />
                      Order Physical Print
                    </Button>
                  </div>
                  <Show when={checkoutMessage()}>
                    <p class="message" role="alert">{checkoutMessage()}</p>
                  </Show>
                  <Show when={downloadMessage()}>
                    <p class="message" role="alert">{downloadMessage()}</p>
                  </Show>
                </div>
              </Show>

              <Show when={current().status === "failed"}>
                <p class="message message-inline" role="alert"><XCircle size={18} /> {current().errorMessage || "The worker failed."}</p>
              </Show>
            </>
          )}
        </Show>

        <Show when={job() && job()?.status !== "completed" && job()?.status !== "failed"}>
          <p class="message message-inline"><Clock size={18} /> This page updates automatically, and we'll email you when your mosaic is ready.</p>
        </Show>
      </Panel>
    </div>
  );
}

function formatProcessingTime(seconds: number | null): string {
  if (seconds == null) return "Done";
  return formatDuration(seconds);
}

function queueStatusText(position: number | null): string {
  if (!position || position < 1) return "Waiting for the next worker slot...";
  if (position === 1) return "You're next in line.";
  return `You're #${position} in line.`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes <= 0) return `${remainder}s`;
  return `${minutes}m${remainder}s`;
}

function isLandscapeMosaic(job: PublicJob): boolean {
  return typeof job.mosaicWidth === "number" && typeof job.mosaicHeight === "number" && job.mosaicWidth > job.mosaicHeight;
}

function previewFrameClass(job: PublicJob): string {
  const orientationClass = isLandscapePreview(job) ? "status-image-landscape" : "status-image-portrait";
  if (job.status === "completed") return `status-image-complete ${orientationClass}`;
  if (job.status === "failed") return `status-image-failed ${orientationClass}`;
  return `status-image-processing ${orientationClass}`;
}

function isLandscapePreview(job: PublicJob): boolean {
  const width = job.status === "completed" ? job.mosaicWidth : job.heroWidth;
  const height = job.status === "completed" ? job.mosaicHeight : job.heroHeight;
  return typeof width === "number" && typeof height === "number" && width > height;
}

function formatPhotoCoverage(oldest: string | null, newest: string | null): string | null {
  if (!oldest || !newest) return null;
  const oldestMs = Date.parse(oldest);
  const newestMs = Date.parse(newest);
  if (!Number.isFinite(oldestMs) || !Number.isFinite(newestMs)) return null;

  const diffDays = Math.max(0, Math.round((newestMs - oldestMs) / 86_400_000));
  const oldestLabel = formatMonthYear(oldestMs);
  const newestLabel = formatMonthYear(newestMs);
  if (diffDays < 31) return oldestLabel === newestLabel ? oldestLabel : `${oldestLabel} - ${newestLabel}`;

  const years = Math.floor(diffDays / 365);
  const months = Math.round((diffDays % 365) / 30);
  const duration = years > 0 ? `${years}y${months > 0 ? ` ${months}mo` : ""}` : `${Math.max(1, months)}mo`;
  return `${duration} (${oldestLabel} - ${newestLabel})`;
}

function formatMonthYear(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(timestamp));
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]);
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? null;
}
