import { GET as get } from "@app/routes/api/instagram/check.ts";
import { callLegacy, type NextRouteContext } from "../../_route.ts";

export function GET(request: Request, context: NextRouteContext): Promise<Response> {
  return callLegacy(get, request, context);
}
