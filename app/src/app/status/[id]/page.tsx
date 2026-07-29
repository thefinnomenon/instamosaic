"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Clock, CreditCard, Download, LoaderCircle, Maximize2, Minus, Plus, Printer, Share2, X, XCircle } from "lucide-react";
import { Badge, Button, Panel, trackUiEvent } from "../../../components/ui.tsx";
import { PRINT_PRICES, formatUsd, printPriceCents, printShippingEstimate } from "../../../lib/print-pricing.ts";

type PublicPrintOrder = {
  id: number;
  status: string;
  printshrimpOrderId: string | null;
  tracking: string | null;
  trackingCourier: string | null;
  completed: boolean | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type PublicJob = {
  id: string;
  username: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  step: string;
  queuePosition: number | null;
  igPostCount: number | null;
  downloadedCount: number;
  skippedCount: number;
  photosUsed: number;
  processingStartedAt: string | null;
  updatedAt: string;
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
  printOrder: PublicPrintOrder | null;
};

type PointerPosition = { x: number; y: number };
type DragStart = PointerPosition & { scrollLeft: number; scrollTop: number };

const tileCells = Array.from({ length: 80 });
const MIN_ZOOM = 50;
const MAX_ZOOM = 1000;
const ZOOM_STEP = 50;
const FRAME_COLORS = ["Black", "White", "Oak"];

export default function StatusPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const activePointersRef = useRef(new Map<number, PointerPosition>());
  const dragStartRef = useRef<DragStart | null>(null);
  const lastPinchDistanceRef = useRef(0);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealMessage, setRevealMessage] = useState("");
  const [preloadedRevealBlob, setPreloadedRevealBlob] = useState<Blob | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [printMessage, setPrintMessage] = useState("");
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printSize, setPrintSize] = useState("20x30");
  const [printFramed, setPrintFramed] = useState(false);
  const [printFrameColor, setPrintFrameColor] = useState("Black");

  const id = params.id;
  const checkoutSucceeded = searchParams.get("checkout") === "success";
  const selectedPrintPrice = useMemo(() => printPriceCents(printSize, printFramed), [printSize, printFramed]);
  const statusText = useMemo(() => {
    if (!job) return "Loading your job...";
    if (job.status === "failed") return "Something went wrong.";
    if (job.status === "completed") return "Your mosaic is ready.";
    if (job.status === "queued") return queueStatusText(job.queuePosition);
    if (job.progress < 8) return "Checking Instagram...";
    if (job.progress < 72) return "Downloading and analyzing photos...";
    return "Building mosaic...";
  }, [job]);
  const imageKind = job?.status === "completed" ? "master" : "hero";
  const revealVideoUrl = job?.downloadToken ? `/api/download/${job.downloadToken}/reveal` : "";

  async function load() {
    try {
      const response = await fetch(`/api/jobs/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load job.");
      setJob(data.job);
      setError("");
      if (checkoutSucceeded && data.job?.status === "completed" && !data.job?.paid) void confirmCheckout();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load job.");
    }
  }

  useEffect(() => {
    void trackUiEvent("status_page_viewed", {}, id);
    void trackUiEvent("page_view", { page: "status" }, id);
    void load();
    const interval = window.setInterval(() => {
      setJob((current) => {
        if (!current || (current.status !== "completed" && current.status !== "failed") || (checkoutSucceeded && current.status === "completed" && !current.paid)) {
          void load();
        }
        return current;
      });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [id, checkoutSucceeded]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDisplayedProgress(Math.min(100, Math.max(0, Math.round(job?.progress ?? 0))));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [job?.progress]);

  useEffect(() => {
    if (!job?.downloadToken || job.status !== "completed" || !revealVideoUrl || preloadedRevealBlob) return;
    const controller = new AbortController();
    fetch(`${revealVideoUrl}?preload=1`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Reveal video is not ready yet.");
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        setPreloadedRevealBlob(blob);
      })
      .catch((preloadError) => {
        if (!(preloadError instanceof DOMException && preloadError.name === "AbortError")) {
          console.warn("Unable to preload reveal video.", preloadError);
        }
      });
    return () => controller.abort();
  }, [job?.downloadToken, job?.status, preloadedRevealBlob, revealVideoUrl]);

  function zoomBy(delta: number, clientX?: number, clientY?: number) {
    zoomTo(zoom + delta, clientX, clientY);
  }

  function zoomTo(nextZoom: number, clientX?: number, clientY?: number) {
    const frame = previewFrameRef.current;
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(nextZoom)));
    if (!frame || clampedZoom === zoom) {
      setZoom(clampedZoom);
      return;
    }
    const rect = frame.getBoundingClientRect();
    const focalX = clientX == null ? rect.width / 2 : clientX - rect.left;
    const focalY = clientY == null ? rect.height / 2 : clientY - rect.top;
    const ratio = clampedZoom / zoom;
    const nextLeft = (frame.scrollLeft + focalX) * ratio - focalX;
    const nextTop = (frame.scrollTop + focalY) * ratio - focalY;
    setZoom(clampedZoom);
    window.requestAnimationFrame(() => {
      frame.scrollLeft = nextLeft;
      frame.scrollTop = nextTop;
    });
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await previewFrameRef.current?.requestFullscreen?.();
  }

  async function checkoutDigital() {
    if (!job || checkoutLoading) return;
    setCheckoutLoading(true);
    setCheckoutMessage("");
    void trackUiEvent("checkout_clicked", { product: "digital" }, job.id);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id })
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
    if (confirmingCheckout) return;
    setConfirmingCheckout(true);
    setCheckoutMessage("");
    try {
      const sessionId = searchParams.get("session_id") || undefined;
      const response = await fetch("/api/stripe/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id, sessionId })
      });
      const data = await response.json();
      if (response.ok) setJob(data.job);
      else if (response.status !== 409) throw new Error(data.error || "Unable to confirm checkout.");
    } catch (confirmError) {
      setCheckoutMessage(confirmError instanceof Error ? confirmError.message : "Unable to confirm checkout.");
    } finally {
      setConfirmingCheckout(false);
    }
  }

  async function downloadDigital() {
    if (!job?.downloadToken || downloadLoading) return;
    setDownloadLoading(true);
    setDownloadMessage("");
    try {
      const response = await fetch(`/api/download/${job.downloadToken}/bundle`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "Unable to download the digital file.");
      }
      downloadBlob(
        await response.blob(),
        filenameFromContentDisposition(response.headers.get("Content-Disposition")) || `instamosaic-${job.username}-digital-files.zip`
      );
    } catch (downloadError) {
      setDownloadMessage(downloadError instanceof Error ? downloadError.message : "Unable to download the digital file.");
    } finally {
      setDownloadLoading(false);
    }
  }

  async function shareRevealVideo() {
    if (!job?.downloadToken || !revealVideoUrl || revealLoading) return;
    setRevealMessage("");
    void trackUiEvent("share_reveal_clicked", {}, job.id);
    try {
      const shareTitle = `InstaMosaic for @${job.username}`;
      const shareText = `Built from ${job.photosUsed || job.downloadedCount} Instagram photos.`;
      if (preloadedRevealBlob) {
        const file = new File([preloadedRevealBlob], `instamosaic-${job.username}-reveal.mp4`, { type: "video/mp4" });
        const shareData = { title: shareTitle, text: shareText, files: [file] };
        if (navigator.canShare?.(shareData)) {
          await navigator.share(shareData);
          return;
        }
      }
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText, url: revealVideoUrl });
        return;
      }
      await copyToClipboard(new URL(revealVideoUrl, window.location.origin).toString());
      setRevealMessage("Reveal video link copied.");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setRevealMessage(shareError instanceof Error ? shareError.message : "Unable to share the reveal video.");
    }
  }

  async function checkoutPrint() {
    if (!job || printLoading) return;
    setPrintLoading(true);
    setPrintMessage("");
    void trackUiEvent("checkout_clicked", { product: "physical_print" }, job.id);
    try {
      const response = await fetch("/api/stripe/print-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, size: printSize, framed: printFramed, frameColor: printFrameColor })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to start print checkout.");
      window.location.href = data.url;
    } catch (printError) {
      setPrintMessage(printError instanceof Error ? printError.message : "Unable to start print checkout.");
    } finally {
      setPrintLoading(false);
    }
  }

  function handlePreviewWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (job?.status !== "completed" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP, event.clientX, event.clientY);
  }

  function handlePreviewPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const frame = previewFrameRef.current;
    if (job?.status !== "completed" || !frame) return;
    if (event.target instanceof Element && event.target.closest(".preview-controls")) return;
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    frame.setPointerCapture(event.pointerId);
    if (activePointersRef.current.size === 2) {
      lastPinchDistanceRef.current = pointerDistance(activePointersRef.current);
      dragStartRef.current = null;
      setIsDraggingPreview(false);
      return;
    }
    if (zoom <= 100) return;
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: frame.scrollLeft,
      scrollTop: frame.scrollTop
    };
    setIsDraggingPreview(true);
  }

  function handlePreviewPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const frame = previewFrameRef.current;
    const pointers = activePointersRef.current;
    if (job?.status !== "completed" || !frame || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      event.preventDefault();
      const distance = pointerDistance(pointers);
      if (lastPinchDistanceRef.current > 0 && distance > 0) {
        const center = pointerCenter(pointers);
        zoomTo(zoom * (distance / lastPinchDistanceRef.current), center.x, center.y);
      }
      lastPinchDistanceRef.current = distance;
      return;
    }
    const dragStart = dragStartRef.current;
    if (!dragStart) return;
    event.preventDefault();
    frame.scrollLeft = dragStart.scrollLeft - (event.clientX - dragStart.x);
    frame.scrollTop = dragStart.scrollTop - (event.clientY - dragStart.y);
  }

  function handlePreviewPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) lastPinchDistanceRef.current = 0;
    if (activePointersRef.current.size === 0) {
      dragStartRef.current = null;
      setIsDraggingPreview(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true" /><span>InstaMosaic</span></a>
        {job ? <Badge tone={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : "neutral"}>{job.status}</Badge> : null}
      </header>

      <Panel className="status-panel">
        {job ? (
          <div className={`status-hero ${job.status === "completed" ? "status-hero-complete" : ""}`}>
            <div className="status-copy">
              <p className="eyebrow">@{job.username}</p>
              <h1>{job.status === "completed" ? "Your mosaic is ready." : job.status === "failed" ? "We couldn't finish this mosaic." : job.status === "queued" ? "Your mosaic is queued." : "Your mosaic is processing."}</h1>
              {job.status !== "completed" ? <p className="lede">{statusText}</p> : null}
            </div>

            <div
              ref={previewFrameRef}
              className={`status-image-wrap ${previewFrameClass(job)}${isDraggingPreview ? " status-image-dragging" : ""}`}
              onWheel={handlePreviewWheel}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={handlePreviewPointerUp}
              onPointerCancel={handlePreviewPointerUp}
              onContextMenu={(event) => job.status === "completed" && event.preventDefault()}
            >
              <img
                className="status-hero-image"
                src={`/api/jobs/${job.id}/preview?kind=${imageKind}${job.status === "completed" ? `&v=${encodeURIComponent(job.updatedAt)}` : ""}`}
                alt={job.status === "completed" ? `Full-resolution InstaMosaic for @${job.username}` : `Uploaded hero image for @${job.username}`}
                draggable={false}
                style={job.status === "completed" ? { width: `${zoom}%` } : undefined}
              />
              {job.status === "completed" ? (
                <div className="preview-controls" aria-label="Mosaic controls">
                  <Button type="button" variant="secondary" className="icon-button preview-control" onClick={() => zoomBy(-ZOOM_STEP)} aria-label="Zoom out" title="Zoom out"><Minus size={16} /></Button>
                  <span className="preview-zoom-label">{zoom}%</span>
                  <Button type="button" variant="secondary" className="icon-button preview-control" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in" title="Zoom in"><Plus size={16} /></Button>
                  <Button type="button" variant="secondary" className="icon-button preview-control" onClick={toggleFullscreen} aria-label="Toggle fullscreen" title="Toggle fullscreen"><Maximize2 size={16} /></Button>
                </div>
              ) : null}
              {job.status !== "completed" && job.status !== "failed" ? (
                <div className="processing-overlay" aria-hidden="true">
                  <div className="tile-break-overlay">
                    {tileCells.map((_, index) => <span key={index} className="tile-break-cell" style={{ "--tile-index": index } as CSSProperties} />)}
                  </div>
                  <div className="processing-scan" />
                  <div className="processing-spinner"><LoaderCircle className="spin" size={24} /></div>
                </div>
              ) : null}
            </div>
          </div>
        ) : <p className="message">{error || "Loading job..."}</p>}

        <div className="status-progress-row">
          <span>{displayedProgress}%</span>
          <span>{statusText}</span>
        </div>
        <div className="progress-shell" aria-label={`Progress ${displayedProgress}%`}>
          <div className="progress-fill" style={{ width: `${displayedProgress}%` }} />
        </div>

        {job?.status === "completed" ? (
          <div className="status-result">
            <div className="stat-grid">
              <div className="stat"><span>Instagram photos used</span><strong>{job.photosUsed || job.downloadedCount}</strong></div>
              {formatPhotoCoverage(job.oldestImagePostAt, job.newestImagePostAt) ? <div className="stat"><span>Photo history</span><strong>{formatPhotoCoverage(job.oldestImagePostAt, job.newestImagePostAt)}</strong></div> : null}
              <div className="stat"><span>Processing time</span><strong>{formatProcessingTime(job.processingSeconds)}</strong></div>
            </div>

            <div className="result-actions">
              {job.paid ? (
                <Button type="button" onClick={downloadDigital} disabled={downloadLoading}><Download size={16} />{downloadLoading ? "Preparing Download..." : "Download Digital Files"}</Button>
              ) : (
                <Button type="button" onClick={checkoutDigital} disabled={checkoutLoading}><CreditCard size={16} />{checkoutLoading ? "Opening checkout..." : "Buy Digital Files - $4.99"}</Button>
              )}
              <Button type="button" variant="secondary" onClick={shareRevealVideo} disabled={revealLoading}><Share2 size={16} />{revealLoading ? "Preparing Video..." : "Share Reveal Video"}</Button>
              <Button type="button" variant="secondary" onClick={() => setPrintModalOpen(true)}><Printer size={16} />Order Print</Button>
            </div>
            {checkoutMessage ? <p className="message" role="alert">{checkoutMessage}</p> : null}
            {downloadMessage ? <p className="message" role="alert">{downloadMessage}</p> : null}
            {revealMessage ? <p className="message" role="alert">{revealMessage}</p> : null}
            {printMessage ? <p className="message" role="alert">{printMessage}</p> : null}
            {job.printOrder ? (
              <div className="print-order-card">
                <div><span>Print order</span><strong>{printOrderTitle(job.printOrder)}</strong></div>
                <p>{printOrderMessage(job.printOrder)}</p>
                {job.printOrder.tracking ? <p>Tracking: <strong>{job.printOrder.tracking}</strong>{job.printOrder.trackingCourier ? ` via ${job.printOrder.trackingCourier}` : ""}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {job?.status === "failed" ? <p className="message message-inline" role="alert"><XCircle size={18} />{job.errorMessage || "The worker failed."}</p> : null}
        {job && job.status !== "completed" && job.status !== "failed" ? <p className="message message-inline"><Clock size={18} />This page updates automatically, and we'll email you when your mosaic is ready.</p> : null}
      </Panel>

      {printModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !printLoading && setPrintModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="print-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><p className="eyebrow">Physical print</p><h2 id="print-modal-title">Order Print</h2></div>
              <Button type="button" variant="ghost" className="icon-button" onClick={() => setPrintModalOpen(false)} disabled={printLoading} aria-label="Close print options" title="Close"><X size={18} /></Button>
            </div>
            <div className="modal-form">
              <label className="label">Size<select className="field" value={printSize} onChange={(event) => setPrintSize(event.currentTarget.value)}>{PRINT_PRICES.map((price) => <option key={price.size} value={price.size}>{price.label}</option>)}</select></label>
              <label className="checkbox-row"><input type="checkbox" checked={printFramed} onChange={(event) => setPrintFramed(event.currentTarget.checked)} /><span>Add frame</span></label>
              {printFramed ? <label className="label">Frame color<select className="field" value={printFrameColor} onChange={(event) => setPrintFrameColor(event.currentTarget.value)}>{FRAME_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}</select></label> : null}
              <div className="print-price-card"><span>Total</span><strong>{formatUsd(selectedPrintPrice)}</strong></div>
              <p className="message">All prints use matte paper and include standard shipping. {printShippingEstimate()} Also includes your digital file download and social video.</p>
            </div>
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setPrintModalOpen(false)} disabled={printLoading}>Cancel</Button>
              <Button type="button" onClick={checkoutPrint} disabled={printLoading}><Printer size={16} />{printLoading ? "Opening checkout..." : "Continue to Checkout"}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function pointerDistance(pointers: Map<number, PointerPosition>): number {
  const points = [...pointers.values()];
  if (!points[0] || !points[1]) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function pointerCenter(pointers: Map<number, PointerPosition>): PointerPosition {
  const points = [...pointers.values()];
  if (!points[0] || !points[1]) return { x: 0, y: 0 };
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
}

function formatProcessingTime(seconds: number | null): string {
  return seconds == null ? "Done" : formatDuration(seconds);
}

function queueStatusText(position: number | null): string {
  if (!position || position < 1) return "Waiting for the next worker slot...";
  if (position === 1) return "You're next in line.";
  return `You're #${position} in line.`;
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes <= 0) return `${remainder}s`;
  return `${minutes}m${remainder}s`;
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

function printOrderTitle(order: PublicPrintOrder): string {
  if (order.status === "test_mode") return "Test order received";
  if (order.status === "failed") return "Print order needs attention";
  if (order.completed) return "Delivered";
  if (order.tracking) return "Shipped";
  if (order.status) return titleCase(order.status);
  return "Order received";
}

function printOrderMessage(order: PublicPrintOrder): string {
  if (order.status === "test_mode") return "Stripe test checkout completed. No real PrintShrimp order was submitted.";
  if (order.status === "failed") return order.errorMessage || "We could not submit this order to the printer.";
  if (order.completed) return "Your print has been marked complete.";
  if (order.tracking) return "Your print has shipped.";
  if (order.printshrimpOrderId) return "Your print order was sent to the printer. Tracking will appear here when available.";
  return "Your print order was received. Tracking will appear here when available.";
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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
