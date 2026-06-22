import type { JSX } from "solid-js";

export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const variant = props.variant || "primary";
  return (
    <button
      {...props}
      class={`button button-${variant}${props.class ? ` ${props.class}` : ""}`}
    >
      {props.children}
    </button>
  );
}

export function TextInput(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} class={`field${props.class ? ` ${props.class}` : ""}`} />;
}

export function Panel(props: { children: JSX.Element; class?: string }) {
  return <section class={`panel${props.class ? ` ${props.class}` : ""}`}>{props.children}</section>;
}

export function Badge(props: { children: JSX.Element; tone?: "neutral" | "success" | "warning" | "danger" }) {
  return <span class={`badge badge-${props.tone || "neutral"}`}>{props.children}</span>;
}

export async function trackUiEvent(event: string, metadata: Record<string, unknown> = {}, jobId?: string, user?: string) {
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, metadata, jobId, user })
    });
  } catch {
    // Analytics should never block the product flow.
  }
}
