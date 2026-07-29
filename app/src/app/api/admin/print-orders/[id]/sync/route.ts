import { POST as post } from "@app/routes/api/admin/print-orders/[id]/sync.ts";
import { callLegacy, type NextRouteContext } from "../../../../_route.ts";

export function POST(request: Request, context: NextRouteContext): Promise<Response> {
  return callLegacy(post, request, context);
}
