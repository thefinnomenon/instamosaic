import { GET as get } from "@app/routes/api/artwork/[token]/index.ts";
import { callLegacy, type NextRouteContext } from "../../_route.ts";

export function GET(request: Request, context: NextRouteContext): Promise<Response> {
  return callLegacy(get, request, context);
}
