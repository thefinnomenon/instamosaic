import { redirect } from "next/navigation";

export default async function ResultRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/status/${id}`);
}
