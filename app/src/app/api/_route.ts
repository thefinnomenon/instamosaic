export type LegacyApiEvent = {
  request: Request;
  params: Record<string, string | undefined>;
};

export type LegacyHandler = (event: LegacyApiEvent) => Response | Promise<Response>;

export type NextRouteContext = {
  params?: Record<string, string | undefined> | Promise<Record<string, string | undefined>>;
};

export async function callLegacy(handler: LegacyHandler, request: Request, context: NextRouteContext = {}): Promise<Response> {
  return handler({
    request,
    params: context.params ? await context.params : {}
  });
}
