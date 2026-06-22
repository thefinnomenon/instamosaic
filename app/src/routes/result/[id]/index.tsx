import { useNavigate, useParams } from "@solidjs/router";
import { onMount } from "solid-js";

export default function ResultRedirect() {
  const params = useParams();
  const navigate = useNavigate();

  onMount(() => {
    navigate(`/status/${params.id}`, { replace: true });
  });

  return null;
}
