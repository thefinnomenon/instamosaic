export { Badge } from "./ui/badge.tsx";
export { Button } from "./ui/button.tsx";
export { Card as Panel } from "./ui/card.tsx";
export { Input as TextInput } from "./ui/input.tsx";
export { Label } from "./ui/label.tsx";

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
