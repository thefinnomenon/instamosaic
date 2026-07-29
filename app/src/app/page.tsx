"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ImagePlus, LoaderCircle, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { Button, Label, Panel, TextInput, trackUiEvent } from "../components/ui.tsx";

type CheckState = "idle" | "checking" | "public" | "private" | "not_found" | "error";

type InstagramCheckResponse = {
  status?: CheckState;
  error?: string;
};

export default function LandingPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreview, setHeroPreview] = useState("");
  const [emailSettled, setEmailSettled] = useState(false);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const startedAt = useRef(Date.now());
  const handleStartedTracked = useRef(false);
  const formCompletedTracked = useRef(false);

  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), [email]);
  const showEmailValidation = emailSettled && email.trim().length > 0;
  const canSubmit = checkState === "public" && Boolean(heroFile) && emailValid && !submitting;

  useEffect(() => {
    void trackUiEvent("landing_page_loaded");
    void trackUiEvent("page_view", { page: "landing" });
  }, []);

  useEffect(() => () => {
    if (heroPreview) URL.revokeObjectURL(heroPreview);
  }, [heroPreview]);

  useEffect(() => {
    const value = username.trim();
    if (value && !handleStartedTracked.current) {
      handleStartedTracked.current = true;
      void trackUiEvent("instagram_handle_started");
    }
    if (value.length < 2) {
      setCheckState("idle");
      setMessage("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void runInstagramCheck(controller.signal);
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [username]);

  useEffect(() => {
    setEmailSettled(false);
    if (!email.trim()) return;
    const timer = window.setTimeout(() => setEmailSettled(true), 700);
    return () => window.clearTimeout(timer);
  }, [email]);

  useEffect(() => {
    if (canSubmit && !formCompletedTracked.current) {
      formCompletedTracked.current = true;
      void trackUiEvent("form_completed", { username: username.trim() }, undefined, email.trim());
    }
  }, [canSubmit, username, email]);

  async function runInstagramCheck(signal?: AbortSignal) {
    const value = username.trim();
    if (value.length < 2) return;
    setCheckState("checking");
    setMessage("");
    try {
      const params = new URLSearchParams({ username: value });
      if (emailValid) params.set("email", email.trim());
      const response = await fetch(`/api/instagram/check?${params.toString()}`, signal ? { signal } : undefined);
      const body = await response.text();
      const data = parseInstagramCheckResponse(body);
      if (!response.ok) throw new Error(data.error || "Unable to verify Instagram right now.");
      if (!data.status) throw new Error("Unable to verify Instagram right now.");
      setCheckState(data.status);
      if (data.status === "private") setMessage("Your Instagram profile is currently private.");
      else if (data.status === "not_found") setMessage("Instagram profile not found.");
      else if (data.status !== "public") setMessage("Unable to verify Instagram right now.");
      else setMessage("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCheckState("error");
      setMessage(error instanceof Error ? error.message : "Unable to verify Instagram right now.");
    }
  }

  function onHeroChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    if (heroPreview) URL.revokeObjectURL(heroPreview);
    setHeroFile(file);
    setHeroPreview(file ? URL.createObjectURL(file) : "");
    if (file) void trackUiEvent("hero_image_uploaded", { bytes: file.size, mime: file.type }, undefined, email || undefined);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const submittedAt = Date.now();
    setSubmitting(true);
    setSubmitError("");
    void trackUiEvent("submit_clicked", { username: username.trim() }, undefined, email.trim());

    const data = new FormData(event.currentTarget);
    data.set("startedAt", String(startedAt.current));
    try {
      const response = await fetch("/api/jobs", { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to create job.");
      await wait(Math.max(0, 2000 - (Date.now() - submittedAt)));
      router.push(`/status/${payload.job.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to create job.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><span>InstaMosaic</span></div>
      </header>

      <div className="landing-layout">
        <Panel className="form-panel">
          <div className="panel-header">
            <h1>Turn your Instagram into print-ready wall art.</h1>
            <p className="lede">Enter your Instagram, email, and image that becomes your mosaic.</p>
          </div>

          <form className="form-grid" onSubmit={submit}>
            <input type="hidden" name="startedAt" value={startedAt.current} />
            <label className="hidden-field">
              Website
              <input name="website" autoComplete="off" tabIndex={-1} />
            </label>

            <div className="label">
              <Label htmlFor="instagram-username">Instagram username</Label>
              <div className={`username-field-wrap ${checkState === "public" ? "username-valid" : isCheckError(checkState) ? "username-invalid" : ""}`}>
                <TextInput
                  id="instagram-username"
                  className="username-field"
                  name="username"
                  placeholder="yourhandle"
                  value={username}
                  autoComplete="off"
                  aria-invalid={isCheckError(checkState)}
                  aria-describedby={message ? "instagram-check-message" : undefined}
                  onChange={(event) => {
                    setUsername(event.currentTarget.value);
                    setCheckState("idle");
                    setMessage("");
                  }}
                />
                <UsernameCheckControl state={checkState} onRetry={() => {
                  void trackUiEvent("instagram_recheck_clicked", { username: username.trim() }, undefined, email || undefined);
                  void runInstagramCheck();
                }} />
              </div>
              <InstagramMessage state={checkState} message={message} />
            </div>

            <div className="label">
              <Label htmlFor="email">Email</Label>
              <div className={`email-field-wrap ${showEmailValidation ? (emailValid ? "email-valid" : "email-invalid") : ""}`}>
                <TextInput
                  id="email"
                  className="email-field"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  aria-invalid={showEmailValidation && !emailValid}
                  aria-describedby={showEmailValidation && !emailValid ? "email-message" : undefined}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  onBlur={() => {
                    setEmailSettled(email.trim().length > 0);
                    if (emailValid) void trackUiEvent("email_entered", {}, undefined, email.trim());
                  }}
                />
                <EmailCheckControl show={showEmailValidation} valid={emailValid} />
              </div>
              <EmailMessage show={showEmailValidation} valid={emailValid} />
            </div>

            <div className="label">
              <Label htmlFor="hero-image">Mosaic image</Label>
              <Label className="file-drop" htmlFor="hero-image">
                <input id="hero-image" name="hero" type="file" accept="image/jpeg,image/png,image/webp" onChange={onHeroChange} />
                <span className="file-icon">
                  {heroPreview ? <img className="file-thumbnail" src={heroPreview} alt="Selected mosaic image thumbnail" /> : <ImagePlus size={22} />}
                </span>
                <span className="file-meta">
                  <span className="file-title">{heroFile ? "Mosaic image selected" : "Choose the image to recreate"}</span>
                  <span className="file-subtitle">{heroFile?.name || "JPG, PNG, or WEBP up to 15MB."}</span>
                </span>
              </Label>
            </div>

            <Button type="submit" disabled={!canSubmit}>
              {submitting ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}
              {submitting ? "Creating mosaic..." : "Generate Mosaic"}
              {!submitting ? <ArrowRight size={18} /> : null}
            </Button>
            {submitError ? <p className="message" role="alert">{submitError}</p> : null}
          </form>
        </Panel>
      </div>
    </div>
  );
}

function EmailCheckControl({ show, valid }: { show: boolean; valid: boolean }) {
  return (
    <div className="email-check-control" aria-live="polite">
      {show && valid ? <Check size={18} aria-label="Email looks good" /> : null}
      {show && !valid ? <XCircle size={18} aria-label="Email needs attention" /> : null}
    </div>
  );
}

function EmailMessage({ show, valid }: { show: boolean; valid: boolean }) {
  return show && !valid ? <p id="email-message" className="input-message input-message-danger" role="status">Enter a valid email address.</p> : null;
}

function UsernameCheckControl({ state, onRetry }: { state: CheckState; onRetry: () => void }) {
  return (
    <div className="username-check-control" aria-live="polite">
      {state === "checking" ? <LoaderCircle className="spin" size={18} aria-label="Checking Instagram username" /> : null}
      {state === "public" ? <Check size={18} aria-label="Instagram profile is public" /> : null}
      {isCheckError(state) ? (
        <button className="input-icon-button" type="button" onClick={onRetry} aria-label="Retry Instagram check">
          <RefreshCw size={16} />
        </button>
      ) : null}
    </div>
  );
}

function InstagramMessage({ state, message }: { state: CheckState; message: string }) {
  return isCheckError(state) ? (
    <p id="instagram-check-message" className={`input-message ${state === "private" ? "input-message-warning" : "input-message-danger"}`} role="status">
      {message}
    </p>
  ) : null;
}

function isCheckError(state: CheckState) {
  return state === "private" || state === "not_found" || state === "error";
}

function parseInstagramCheckResponse(body: string): InstagramCheckResponse {
  if (!body.trim()) return {};
  try {
    return JSON.parse(body) as InstagramCheckResponse;
  } catch {
    return {};
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
