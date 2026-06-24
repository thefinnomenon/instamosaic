import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type JobStep =
  | "Job created"
  | "Instagram verified"
  | "Downloading photos"
  | "Generating tiles"
  | "Building mosaic"
  | "Generating exports"
  | "Done"
  | "Failed";

export type Job = {
  id: string;
  username: string;
  email: string;
  status: JobStatus;
  progress: number;
  step: JobStep | string;
  ig_public: number | null;
  ig_post_count: number | null;
  downloaded_count: number;
  skipped_count: number;
  photos_used: number;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  retry_count: number;
  paid_at: string | null;
  amount_paid_cents: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  hero_path: string;
  output_dir: string;
  preview_path: string | null;
  square_preview_path: string | null;
  download_token: string;
  ip_address: string | null;
  metadata: string | null;
};

export type PublicJob = {
  id: string;
  username: string;
  email: string;
  status: JobStatus;
  progress: number;
  step: string;
  queuePosition: number | null;
  igPublic: boolean | null;
  igPostCount: number | null;
  downloadedCount: number;
  skippedCount: number;
  photosUsed: number;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  paid: boolean;
  previewAvailable: boolean;
  squarePreviewAvailable: boolean;
  downloadToken?: string;
  processingSeconds: number | null;
  oldestImagePostAt: string | null;
  newestImagePostAt: string | null;
  heroWidth: number | null;
  heroHeight: number | null;
  mosaicWidth: number | null;
  mosaicHeight: number | null;
  printOrder: PublicPrintOrder | null;
};

export type PublicPrintOrder = {
  id: number;
  status: string;
  printshrimpOrderId: string | null;
  tracking: string | null;
  trackingCourier: string | null;
  completed: boolean | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateJobInput = {
  id?: string;
  username: string;
  email: string;
  heroPath: string;
  outputDir: string;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
};

export type PrintOrder = {
  id: number;
  job_id: string;
  stripe_session_id: string;
  external_order_number: string;
  status: string;
  printshrimp_order_id: string | null;
  tracking: string | null;
  tracking_courier: string | null;
  completed: number | null;
  request_payload: string | null;
  response_payload: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

let db: Database.Database | null = null;

export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function appRoot(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJson = path.join(directory, "package.json");
    if (existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { workspaces?: unknown };
        if (Array.isArray(parsed.workspaces)) return directory;
      } catch {
        // Keep walking if package.json is unreadable.
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return process.cwd();
}

export function storageDir(): string {
  return path.resolve(appRoot(), "storage");
}

export function dbPath(): string {
  return path.join(storageDir(), "instamosaic.sqlite");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

export function getDb(): Database.Database {
  if (db) return db;
  const filename = dbPath();
  mkdirSync(path.dirname(filename), { recursive: true });
  db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initDb(db);
  return db;
}

export function initDb(database = getDb()): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 5,
      step TEXT NOT NULL DEFAULT 'Job created',
      ig_public INTEGER,
      ig_post_count INTEGER,
      downloaded_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      photos_used INTEGER NOT NULL DEFAULT 0,
      processing_started_at TEXT,
      processing_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      amount_paid_cents INTEGER,
      currency TEXT,
      stripe_session_id TEXT,
      hero_path TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      preview_path TEXT,
      square_preview_path TEXT,
      download_token TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_email_status ON jobs(email, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_ip_status ON jobs(ip_address, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_stripe_session ON jobs(stripe_session_id);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      event TEXT NOT NULL,
      user TEXT,
      ip TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_event_created ON analytics_events(event, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_job ON analytics_events(job_id, created_at);

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      level TEXT NOT NULL DEFAULT 'info',
      event TEXT NOT NULL,
      user TEXT,
      message TEXT NOT NULL,
      stack TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_logs_level_created ON logs(level, created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_job ON logs(job_id, created_at);

    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      token TEXT NOT NULL,
      output_type TEXT NOT NULL,
      ip TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_downloads_job ON downloads(job_id, started_at);

    CREATE TABLE IF NOT EXISTS rate_limits (
      scope TEXT NOT NULL,
      identity TEXT NOT NULL,
      window_start_ms INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY(scope, identity)
    );

    CREATE TABLE IF NOT EXISTS print_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      stripe_session_id TEXT NOT NULL UNIQUE,
      external_order_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      printshrimp_order_id TEXT,
      tracking TEXT,
      tracking_courier TEXT,
      completed INTEGER,
      request_payload TEXT,
      response_payload TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_print_orders_job ON print_orders(job_id, created_at);
  `);
  ensureColumn(database, "print_orders", "tracking", "TEXT");
  ensureColumn(database, "print_orders", "tracking_courier", "TEXT");
  ensureColumn(database, "print_orders", "completed", "INTEGER");
}

export function closeDb(): void {
  if (!db) return;
  db.close();
  db = null;
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return;
  database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

export function createJob(input: CreateJobInput): Job {
  const database = getDb();
  const id = input.id ?? randomUUID();
  const createdAt = nowIso();
  const token = randomToken();
  database
    .prepare(
      `INSERT INTO jobs (
        id, username, email, status, progress, step, created_at, updated_at,
        hero_path, output_dir, download_token, ip_address, metadata
      ) VALUES (
        @id, @username, @email, 'queued', 5, 'Job created', @createdAt, @createdAt,
        @heroPath, @outputDir, @downloadToken, @ipAddress, @metadata
      )`
    )
    .run({
      id,
      username: input.username,
      email: input.email,
      createdAt,
      heroPath: input.heroPath,
      outputDir: input.outputDir,
      downloadToken: token,
      ipAddress: input.ipAddress ?? null,
      metadata: JSON.stringify(input.metadata ?? {})
    });

  const job = getJob(id);
  if (!job) throw new Error("Job insert failed");
  trackEvent({ event: "job_created", jobId: id, user: input.email, ip: input.ipAddress ?? undefined });
  logInfo({ event: "job_created", jobId: id, user: input.email, message: `Created job for ${input.username}` });
  return job;
}

export function getJob(id: string): Job | null {
  return (getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined) ?? null;
}

export function getJobByDownloadToken(token: string): Job | null {
  return (getDb().prepare("SELECT * FROM jobs WHERE download_token = ?").get(token) as Job | undefined) ?? null;
}

export function getJobByStripeSession(sessionId: string): Job | null {
  return (getDb().prepare("SELECT * FROM jobs WHERE stripe_session_id = ?").get(sessionId) as Job | undefined) ?? null;
}

const jobPatchFields = new Set([
  "status",
  "progress",
  "step",
  "ig_public",
  "ig_post_count",
  "downloaded_count",
  "skipped_count",
  "photos_used",
  "processing_started_at",
  "processing_completed_at",
  "error_message",
  "retry_count",
  "paid_at",
  "amount_paid_cents",
  "currency",
  "stripe_session_id",
  "preview_path",
  "square_preview_path",
  "metadata"
]);

export function updateJob(id: string, patch: Partial<Job>): Job {
  const entries = Object.entries(patch).filter(([key, value]) => jobPatchFields.has(key) && value !== undefined);
  if (entries.length === 0) {
    const job = getJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    return job;
  }

  const updatedAt = nowIso();
  const assignments = entries.map(([key]) => `${key} = @${key}`).join(", ");
  getDb()
    .prepare(`UPDATE jobs SET ${assignments}, updated_at = @updatedAt WHERE id = @id`)
    .run({
      id,
      updatedAt,
      ...Object.fromEntries(entries)
    });

  const job = getJob(id);
  if (!job) throw new Error(`Job not found after update: ${id}`);
  return job;
}

export function claimNextJob(): Job | null {
  const database = getDb();
  const now = nowIso();
  const row = database
    .prepare(
      `SELECT * FROM jobs
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get() as Job | undefined;

  if (!row) return null;

  const result = database
    .prepare(
      `UPDATE jobs
       SET status = 'processing', progress = 5, step = 'Job created',
           processing_started_at = COALESCE(processing_started_at, @now),
           updated_at = @now
       WHERE id = @id AND status = 'queued'`
    )
    .run({ id: row.id, now });

  if (result.changes === 0) return null;
  return getJob(row.id);
}

export function incrementJobRetry(id: string): void {
  getDb().prepare("UPDATE jobs SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
}

export function markJobPaid(input: {
  jobId: string;
  stripeSessionId?: string | null;
  amountPaidCents?: number | null;
  currency?: string | null;
}): Job {
  return updateJob(input.jobId, {
    paid_at: nowIso(),
    stripe_session_id: input.stripeSessionId ?? null,
    amount_paid_cents: input.amountPaidCents ?? null,
    currency: input.currency ?? null
  });
}

export function getPrintOrderByStripeSession(sessionId: string): PrintOrder | null {
  return (getDb().prepare("SELECT * FROM print_orders WHERE stripe_session_id = ?").get(sessionId) as PrintOrder | undefined) ?? null;
}

export function getPrintOrder(id: number): PrintOrder | null {
  return (getDb().prepare("SELECT * FROM print_orders WHERE id = ?").get(id) as PrintOrder | undefined) ?? null;
}

export function getLatestPrintOrderForJob(jobId: string): PrintOrder | null {
  return (getDb()
    .prepare("SELECT * FROM print_orders WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(jobId) as PrintOrder | undefined) ?? null;
}

export function createPrintOrder(input: {
  jobId: string;
  stripeSessionId: string;
  externalOrderNumber: string;
  requestPayload: unknown;
}): PrintOrder {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO print_orders (
        job_id, stripe_session_id, external_order_number, status, request_payload, created_at, updated_at
      ) VALUES (
        @jobId, @stripeSessionId, @externalOrderNumber, 'submitting', @requestPayload, @now, @now
      )`
    )
    .run({
      jobId: input.jobId,
      stripeSessionId: input.stripeSessionId,
      externalOrderNumber: input.externalOrderNumber,
      requestPayload: JSON.stringify(input.requestPayload),
      now
    });
  const order = getPrintOrderByStripeSession(input.stripeSessionId);
  if (!order) throw new Error("Print order insert failed");
  return order;
}

export function markPrintOrderSubmitted(input: {
  stripeSessionId: string;
  printshrimpOrderId?: string | null;
  responsePayload: unknown;
  status?: string | null;
  tracking?: string | null;
  trackingCourier?: string | null;
  completed?: boolean | null;
}): void {
  getDb()
    .prepare(
      `UPDATE print_orders
       SET status = COALESCE(@status, 'submitted'),
           printshrimp_order_id = @printshrimpOrderId,
           tracking = @tracking,
           tracking_courier = @trackingCourier,
           completed = @completed,
           response_payload = @responsePayload,
           error_message = NULL,
           updated_at = @updatedAt
       WHERE stripe_session_id = @stripeSessionId`
    )
    .run({
      stripeSessionId: input.stripeSessionId,
      printshrimpOrderId: input.printshrimpOrderId ?? null,
      status: input.status ?? null,
      tracking: input.tracking ?? null,
      trackingCourier: input.trackingCourier ?? null,
      completed: input.completed == null ? null : input.completed ? 1 : 0,
      responsePayload: JSON.stringify(input.responsePayload),
      updatedAt: nowIso()
    });
}

export function updatePrintOrderStatus(input: {
  stripeSessionId: string;
  printshrimpOrderId?: string | null;
  status?: string | null;
  tracking?: string | null;
  trackingCourier?: string | null;
  completed?: boolean | null;
  responsePayload: unknown;
}): void {
  getDb()
    .prepare(
      `UPDATE print_orders
       SET printshrimp_order_id = COALESCE(@printshrimpOrderId, printshrimp_order_id),
           status = COALESCE(@status, status),
           tracking = @tracking,
           tracking_courier = @trackingCourier,
           completed = @completed,
           response_payload = @responsePayload,
           error_message = NULL,
           updated_at = @updatedAt
       WHERE stripe_session_id = @stripeSessionId`
    )
    .run({
      stripeSessionId: input.stripeSessionId,
      printshrimpOrderId: input.printshrimpOrderId ?? null,
      status: input.status ?? null,
      tracking: input.tracking ?? null,
      trackingCourier: input.trackingCourier ?? null,
      completed: input.completed == null ? null : input.completed ? 1 : 0,
      responsePayload: JSON.stringify(input.responsePayload),
      updatedAt: nowIso()
    });
}

export function markPrintOrderFailed(input: {
  stripeSessionId: string;
  errorMessage: string;
  responsePayload?: unknown;
}): void {
  getDb()
    .prepare(
      `UPDATE print_orders
       SET status = 'failed',
           error_message = @errorMessage,
           response_payload = COALESCE(@responsePayload, response_payload),
           updated_at = @updatedAt
       WHERE stripe_session_id = @stripeSessionId`
    )
    .run({
      stripeSessionId: input.stripeSessionId,
      errorMessage: input.errorMessage,
      responsePayload: input.responsePayload == null ? null : JSON.stringify(input.responsePayload),
      updatedAt: nowIso()
    });
}

export function toPublicJob(job: Job, includeDownloadToken = false): PublicJob {
  const started = job.processing_started_at ? Date.parse(job.processing_started_at) : Number.NaN;
  const completed = job.processing_completed_at ? Date.parse(job.processing_completed_at) : Number.NaN;
  const processingSeconds = Number.isFinite(started) && Number.isFinite(completed) ? Math.max(0, Math.round((completed - started) / 1000)) : null;
  const metadata = parseJobMetadata(job.metadata);
  const instagramMetadata = metadata.instagram && typeof metadata.instagram === "object" ? metadata.instagram as Record<string, unknown> : {};
  const mosaicMetadata = metadata.mosaic && typeof metadata.mosaic === "object" ? metadata.mosaic as Record<string, unknown> : {};

  return {
    id: job.id,
    username: job.username,
    email: job.email,
    status: job.status,
    progress: job.progress,
    step: job.step,
    queuePosition: queuePosition(job),
    igPublic: job.ig_public == null ? null : job.ig_public === 1,
    igPostCount: job.ig_post_count,
    downloadedCount: job.downloaded_count,
    skippedCount: job.skipped_count,
    photosUsed: job.photos_used,
    processingStartedAt: job.processing_started_at,
    processingCompletedAt: job.processing_completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    errorMessage: job.error_message,
    paid: Boolean(job.paid_at),
    previewAvailable: Boolean(job.preview_path),
    squarePreviewAvailable: Boolean(job.square_preview_path),
    ...(includeDownloadToken ? { downloadToken: job.download_token } : {}),
    processingSeconds,
    oldestImagePostAt: typeof instagramMetadata.oldestImagePostAt === "string" ? instagramMetadata.oldestImagePostAt : null,
    newestImagePostAt: typeof instagramMetadata.newestImagePostAt === "string" ? instagramMetadata.newestImagePostAt : null,
    heroWidth: finiteNumber(metadata.heroWidth),
    heroHeight: finiteNumber(metadata.heroHeight),
    mosaicWidth: finiteNumber(mosaicMetadata.masterWidth),
    mosaicHeight: finiteNumber(mosaicMetadata.masterHeight),
    printOrder: toPublicPrintOrder(getLatestPrintOrderForJob(job.id))
  };
}

function toPublicPrintOrder(order: PrintOrder | null): PublicPrintOrder | null {
  if (!order) return null;
  return {
    id: order.id,
    status: order.status,
    printshrimpOrderId: order.printshrimp_order_id,
    tracking: order.tracking,
    trackingCourier: order.tracking_courier,
    completed: order.completed == null ? null : order.completed === 1,
    errorMessage: order.error_message,
    createdAt: order.created_at,
    updatedAt: order.updated_at
  };
}

function queuePosition(job: Job): number | null {
  if (job.status !== "queued") return null;
  const value = getDb()
    .prepare(
      `SELECT COUNT(*) + 1 AS position
       FROM jobs
       WHERE status = 'queued'
         AND (created_at < @createdAt OR (created_at = @createdAt AND id < @id))`
    )
    .get({ createdAt: job.created_at, id: job.id }) as { position?: number } | undefined;
  return typeof value?.position === "number" ? value.position : null;
}

function parseJobMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function trackEvent(input: {
  event: string;
  jobId?: string | undefined;
  user?: string | undefined;
  ip?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): void {
  getDb()
    .prepare(
      `INSERT INTO analytics_events (job_id, event, user, ip, metadata, created_at)
       VALUES (@jobId, @event, @user, @ip, @metadata, @createdAt)`
    )
    .run({
      jobId: input.jobId ?? null,
      event: input.event,
      user: input.user ?? null,
      ip: input.ip ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: nowIso()
    });
}

export function logInfo(input: {
  event: string;
  message: string;
  jobId?: string | undefined;
  user?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): void {
  writeLog({ ...input, level: "info" });
}

export function logWarn(input: {
  event: string;
  message: string;
  jobId?: string | undefined;
  user?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): void {
  writeLog({ ...input, level: "warn" });
}

export function logError(input: {
  event: string;
  message: string;
  jobId?: string | undefined;
  user?: string | undefined;
  stack?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): void {
  writeLog({ ...input, level: "error" });
}

function writeLog(input: {
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  jobId?: string | undefined;
  user?: string | undefined;
  stack?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): void {
  getDb()
    .prepare(
      `INSERT INTO logs (job_id, level, event, user, message, stack, metadata, created_at)
       VALUES (@jobId, @level, @event, @user, @message, @stack, @metadata, @createdAt)`
    )
    .run({
      jobId: input.jobId ?? null,
      level: input.level,
      event: input.event,
      user: input.user ?? null,
      message: input.message,
      stack: input.stack ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: nowIso()
    });
}

export function assertRateLimit(input: {
  scope: string;
  identity: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const database = getDb();
  const nowMs = Date.now();
  const row = database
    .prepare("SELECT * FROM rate_limits WHERE scope = ? AND identity = ?")
    .get(input.scope, input.identity) as { window_start_ms: number; count: number } | undefined;

  if (!row || nowMs - row.window_start_ms >= input.windowMs) {
    database
      .prepare("INSERT OR REPLACE INTO rate_limits (scope, identity, window_start_ms, count) VALUES (?, ?, ?, 1)")
      .run(input.scope, input.identity, nowMs);
    return { allowed: true, remaining: Math.max(0, input.limit - 1), retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((input.windowMs - (nowMs - row.window_start_ms)) / 1000));
  if (row.count >= input.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  database
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE scope = ? AND identity = ?")
    .run(input.scope, input.identity);
  return { allowed: true, remaining: Math.max(0, input.limit - row.count - 1), retryAfterSeconds: 0 };
}

export function hasActiveJobForIp(ip: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM jobs WHERE ip_address = ? AND status IN ('queued', 'processing') LIMIT 1")
    .get(ip);
  return Boolean(row);
}

export function hasActiveJobForEmail(email: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM jobs WHERE lower(email) = lower(?) AND status IN ('queued', 'processing') LIMIT 1")
    .get(email);
  return Boolean(row);
}

export function recordDownloadStarted(input: { jobId: string; token: string; outputType: string; ip?: string | undefined }): number {
  const result = getDb()
    .prepare(
      `INSERT INTO downloads (job_id, token, output_type, ip, started_at)
       VALUES (@jobId, @token, @outputType, @ip, @startedAt)`
    )
    .run({
      jobId: input.jobId,
      token: input.token,
      outputType: input.outputType,
      ip: input.ip ?? null,
      startedAt: nowIso()
    });
  trackEvent({ event: "download_started", jobId: input.jobId, ip: input.ip, metadata: { outputType: input.outputType } });
  return Number(result.lastInsertRowid);
}

export function recordDownloadCompleted(downloadId: number, jobId: string, outputType: string, ip?: string | undefined): void {
  getDb().prepare("UPDATE downloads SET completed_at = ? WHERE id = ?").run(nowIso(), downloadId);
  trackEvent({ event: "download_completed", jobId, ip, metadata: { outputType } });
}

export function getDashboardMetrics(): Record<string, unknown> {
  const database = getDb();
  const scalar = <T>(sql: string, params: unknown[] = []): T => {
    const row = database.prepare(sql).get(...params) as Record<string, T> | undefined;
    return row ? (Object.values(row)[0] as T) : (0 as T);
  };

  const totalJobs = scalar<number>("SELECT COUNT(*) AS value FROM jobs");
  const completedJobs = scalar<number>("SELECT COUNT(*) AS value FROM jobs WHERE status = 'completed'");
  const failedJobs = scalar<number>("SELECT COUNT(*) AS value FROM jobs WHERE status = 'failed'");
  const paidJobs = scalar<number>("SELECT COUNT(*) AS value FROM jobs WHERE paid_at IS NOT NULL");
  const downloads = scalar<number>("SELECT COUNT(*) AS value FROM downloads WHERE completed_at IS NOT NULL");
  const printOrders = scalar<number>("SELECT COUNT(*) AS value FROM print_orders");
  const revenueCents = scalar<number>("SELECT COALESCE(SUM(amount_paid_cents), 0) AS value FROM jobs WHERE paid_at IS NOT NULL");
  const averageProcessingSeconds = scalar<number>(
    `SELECT COALESCE(AVG((julianday(processing_completed_at) - julianday(processing_started_at)) * 86400), 0) AS value
     FROM jobs
     WHERE processing_started_at IS NOT NULL AND processing_completed_at IS NOT NULL`
  );

  const recentJobs = database
    .prepare(
      `SELECT id, username, email, status, progress, step, photos_used, paid_at, created_at, updated_at, error_message
       FROM jobs
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all();

  const recentAnalytics = database
    .prepare(
      `SELECT id, job_id, event, user, ip, metadata, created_at
       FROM analytics_events
       ORDER BY created_at DESC
       LIMIT 40`
    )
    .all();

  const recentErrors = database
    .prepare(
      `SELECT id, job_id, level, event, user, message, stack, metadata, created_at
       FROM logs
       WHERE level = 'error'
       ORDER BY created_at DESC
       LIMIT 40`
    )
    .all();

  const recentPrintOrders = database
    .prepare(
      `SELECT id, job_id, status, external_order_number, printshrimp_order_id, tracking, tracking_courier, completed, error_message, created_at, updated_at
       FROM print_orders
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all();

  const funnel = database
    .prepare(
      `SELECT event, COUNT(*) AS count
       FROM analytics_events
       WHERE event IN (
         'landing_page_loaded', 'instagram_check_public', 'form_completed', 'submit_clicked',
         'job_created', 'worker_completed', 'checkout_clicked', 'stripe_checkout_completed',
         'download_completed'
       )
       GROUP BY event`
    )
    .all();

  return {
    totalJobs,
    completedJobs,
    failedJobs,
    paidJobs,
    averageProcessingSeconds: Math.round(averageProcessingSeconds),
    revenueCents,
    downloads,
    printOrders,
    conversion: {
      completedRate: totalJobs ? completedJobs / totalJobs : 0,
      paidRate: completedJobs ? paidJobs / completedJobs : 0
    },
    funnel,
    recentJobs,
    recentPrintOrders,
    recentAnalytics,
    recentErrors
  };
}

export function resetDbForTests(): void {
  const database = getDb();
  database.exec("DELETE FROM print_orders; DELETE FROM downloads; DELETE FROM analytics_events; DELETE FROM logs; DELETE FROM rate_limits; DELETE FROM jobs;");
}
