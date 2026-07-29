const DEFAULT_GRAPH_API_VERSION = "v25.0";
const GRAPH_API_ORIGIN = "https://graph.instagram.com";
const CONTAINER_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 5_000;

type JsonObject = Record<string, unknown>;

export type PublishedInstagramMedia = {
  id: string;
  permalink: string | null;
};

export type InstagramPublisher = {
  publishCarousel(input: {
    revealVideoUrl: string;
    mosaicImageUrl: string;
    caption: string;
  }): Promise<PublishedInstagramMedia>;
  publishStory(input: { videoUrl: string }): Promise<PublishedInstagramMedia>;
};

export function instagramPublisherFromEnv(): InstagramPublisher {
  const userId = requiredEnv("INSTAGRAM_USER_ID");
  const accessToken = requiredEnv("INSTAGRAM_ACCESS_TOKEN");
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;

  return {
    async publishCarousel(input) {
      const revealId = await createMediaContainer({
        userId,
        accessToken,
        apiVersion,
        params: {
          media_type: "VIDEO",
          video_url: input.revealVideoUrl,
          is_carousel_item: "true"
        }
      });
      await waitForContainer({ containerId: revealId, accessToken, apiVersion });
      const mosaicId = await createMediaContainer({
        userId,
        accessToken,
        apiVersion,
        params: {
          image_url: input.mosaicImageUrl,
          is_carousel_item: "true"
        }
      });
      await waitForContainer({ containerId: mosaicId, accessToken, apiVersion });
      const carouselId = await createMediaContainer({
        userId,
        accessToken,
        apiVersion,
        params: {
          media_type: "CAROUSEL",
          children: `${revealId},${mosaicId}`,
          caption: input.caption
        }
      });
      await waitForContainer({ containerId: carouselId, accessToken, apiVersion });
      return publishContainer({ userId, containerId: carouselId, accessToken, apiVersion });
    },

    async publishStory(input) {
      const storyId = await createMediaContainer({
        userId,
        accessToken,
        apiVersion,
        params: {
          media_type: "STORIES",
          video_url: input.videoUrl
        }
      });
      await waitForContainer({ containerId: storyId, accessToken, apiVersion });
      return publishContainer({ userId, containerId: storyId, accessToken, apiVersion });
    }
  };
}

async function createMediaContainer(input: {
  userId: string;
  accessToken: string;
  apiVersion: string;
  params: Record<string, string>;
}): Promise<string> {
  const payload = await createMediaContainerPayload(input);
  return stringField(payload, "id", "Instagram did not return a media container ID.");
}

async function createMediaContainerPayload(input: {
  userId: string;
  accessToken: string;
  apiVersion: string;
  params: Record<string, string>;
}): Promise<JsonObject> {
  return graphRequest(
    `/${input.userId}/media`,
    input.accessToken,
    input.apiVersion,
    { method: "POST", params: input.params }
  );
}

async function waitForContainer(input: {
  containerId: string;
  accessToken: string;
  apiVersion: string;
}): Promise<void> {
  const deadline = Date.now() + CONTAINER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const payload = await graphRequest(
      `/${input.containerId}`,
      input.accessToken,
      input.apiVersion,
      { method: "GET", params: { fields: "status_code,status" } }
    );
    const statusCode = typeof payload.status_code === "string" ? payload.status_code : "";

    if (statusCode === "FINISHED") return;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      const detail = typeof payload.status === "string" ? ` ${payload.status}` : "";
      throw new Error(`Instagram media processing ended with ${statusCode}.${detail}`.trim());
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Instagram media processing timed out after 5 minutes.");
}

async function publishContainer(input: {
  userId: string;
  containerId: string;
  accessToken: string;
  apiVersion: string;
}): Promise<PublishedInstagramMedia> {
  const published = await graphRequest(
    `/${input.userId}/media_publish`,
    input.accessToken,
    input.apiVersion,
    { method: "POST", params: { creation_id: input.containerId } }
  );
  const id = stringField(published, "id", "Instagram did not return a published media ID.");
  let permalink: string | null = null;
  try {
    const media = await graphRequest(
      `/${id}`,
      input.accessToken,
      input.apiVersion,
      { method: "GET", params: { fields: "permalink" } }
    );
    permalink = typeof media.permalink === "string" ? media.permalink : null;
  } catch {
    // Stories may not expose a permalink.
  }
  return { id, permalink };
}

async function graphRequest(
  pathname: string,
  accessToken: string,
  apiVersion: string,
  input: { method: "GET" | "POST"; params: Record<string, string> }
): Promise<JsonObject> {
  const url = new URL(`${GRAPH_API_ORIGIN}/${apiVersion}${pathname}`);
  const params = new URLSearchParams(input.params);
  const response = input.method === "GET"
    ? await fetch(`${url}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    : await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      });
  const text = await response.text();
  const payload = parseObject(text);

  if (!response.ok) {
    const graphError = objectField(payload, "error");
    const message = typeof graphError?.message === "string" ? graphError.message : text.slice(0, 500);
    throw new Error(`Instagram API request failed (${response.status}): ${message}`);
  }
  return payload;
}

function parseObject(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function objectField(input: JsonObject, key: string): JsonObject | null {
  const value = input[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringField(input: JsonObject, key: string, errorMessage: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(errorMessage);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
