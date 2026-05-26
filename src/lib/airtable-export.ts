import Airtable from "airtable";
import type { AirtableMockClient } from "@/lib/airtable-mock";
import type { ApiProjectDetail, ApiUser, TaskStatus } from "@/types";
import { STATUS_LABELS } from "@/types";

export type AirtableExportError = {
  taskId: string;
  taskTitle: string;
  message: string;
};

export type AirtableExportSummary = {
  total: number;
  created: number;
  updated: number;
  failed: AirtableExportError[];
  airtableBaseUrl: string;
};

export type AirtableExportRecord = {
  id: string;
  fields: Record<string, unknown>;
};

export type AirtableExportAdapter = {
  baseUrl: string;
  listRecords(): Promise<AirtableExportRecord[]>;
  createRecord(fields: Record<string, unknown>): Promise<AirtableExportRecord>;
  updateRecord(id: string, fields: Record<string, unknown>): Promise<AirtableExportRecord>;
};

export type AirtableExportInput = {
  project: Pick<ApiProjectDetail, "id" | "name">;
  tasks: AirtableExportTask[];
};

export type AirtableExportTask = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  createdById: string;
  position: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  assignee?: ApiUser | null;
  createdBy?: ApiUser | null;
};

const AIRTABLE_FIELD_TASK_ID = "Task ID";
const AIRTABLE_FIELD_PROJECT_ID = "Project ID";
const AIRTABLE_FIELD_PROJECT_NAME = "Project Name";
const AIRTABLE_FIELD_TITLE = "Task Title";
const AIRTABLE_FIELD_DESCRIPTION = "Description";
const AIRTABLE_FIELD_STATUS = "Status";
const AIRTABLE_FIELD_ASSIGNEE = "Assignee";
const AIRTABLE_FIELD_CREATED_BY = "Created By";
const AIRTABLE_FIELD_POSITION = "Position";
const AIRTABLE_FIELD_CREATED_AT = "Created At";
const AIRTABLE_FIELD_UPDATED_AT = "Updated At";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);
const RETRYABLE_ERROR_TYPES = new Set([
  "rate-limit",
  "server-error",
  "network",
  "TOO_MANY_REQUESTS",
  "SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
  "CONNECTION_ERROR",
]);

function getAirtableConfig() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!apiKey || !baseId || !tableName) {
    throw new Error(
      "Airtable export is not configured. Set AIRTABLE_API_KEY, AIRTABLE_BASE_ID, and AIRTABLE_TABLE_NAME.",
    );
  }

  const normalizedBaseId = baseId.includes("/") ? baseId.split("/")[0]! : baseId;
  if (!/^app[\w]+$/.test(normalizedBaseId)) {
    throw new Error(
      "AIRTABLE_BASE_ID must be the base id only (for example appXXXXXXXX), not a full Airtable URL.",
    );
  }

  return {
    apiKey,
    baseId: normalizedBaseId,
    tableName,
    baseUrl: `https://airtable.com/${normalizedBaseId}`,
  };
}

export function createRealAirtableAdapter(): AirtableExportAdapter {
  const config = getAirtableConfig();
  const table = new Airtable({ apiKey: config.apiKey }).base(config.baseId)(
    config.tableName,
  ) as unknown as {
    select(params?: Record<string, unknown>): { all(): Promise<AirtableRecordLike[]> };
    create(fields: Record<string, unknown>): Promise<AirtableRecordLike>;
    update(id: string, fields: Record<string, unknown>): Promise<AirtableRecordLike>;
  };

  return {
    baseUrl: config.baseUrl,
    async listRecords() {
      const records = await table.select({}).all();
      return records.map(normalizeRecord);
    },
    async createRecord(fields) {
      return normalizeRecord(await table.create(fields));
    },
    async updateRecord(id, fields) {
      return normalizeRecord(await table.update(id, fields));
    },
  };
}

export function createMockAirtableAdapter(
  mock: AirtableMockClient,
  baseId = "mock-base",
): AirtableExportAdapter {
  return {
    baseUrl: `https://airtable.com/${baseId}`,
    async listRecords() {
      return (await mock.list()).map(normalizeRecord);
    },
    async createRecord(fields) {
      return normalizeRecord(await mock.create({ fields }));
    },
    async updateRecord(id, fields) {
      return normalizeRecord(await mock.update(id, fields));
    },
  };
}

export function buildTaskAirtableFields(
  project: Pick<ApiProjectDetail, "id" | "name">,
  task: AirtableExportInput["tasks"][number],
) {
  const fields: Record<string, unknown> = {
    [AIRTABLE_FIELD_TASK_ID]: task.id,
    [AIRTABLE_FIELD_PROJECT_ID]: project.id,
    [AIRTABLE_FIELD_PROJECT_NAME]: project.name,
    [AIRTABLE_FIELD_TITLE]: task.title,
    [AIRTABLE_FIELD_DESCRIPTION]: task.description ?? "",
    [AIRTABLE_FIELD_STATUS]: toAirtableStatus(task.status),
    [AIRTABLE_FIELD_POSITION]: task.position,
  };

  if (shouldExportTimestamps()) {
    fields[AIRTABLE_FIELD_CREATED_AT] = toAirtableTimestamp(task.createdAt);
    fields[AIRTABLE_FIELD_UPDATED_AT] = toAirtableTimestamp(task.updatedAt);
  }

  const assigneeName = task.assignee?.name?.trim();
  if (assigneeName) {
    fields[AIRTABLE_FIELD_ASSIGNEE] = assigneeName;
  }

  const createdByName = task.createdBy?.name?.trim();
  if (createdByName) {
    fields[AIRTABLE_FIELD_CREATED_BY] = createdByName;
  }

  return fields;
}

export async function exportTasksToAirtable(
  input: AirtableExportInput,
  adapter: AirtableExportAdapter,
  options: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<AirtableExportSummary> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 250;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const existingRecords = await retryTransient(
    () => adapter.listRecords(),
    "load existing Airtable records",
    attempts,
    delayMs,
    sleep,
  );

  const existingByTaskId = new Map<string, AirtableExportRecord>();
  for (const record of existingRecords) {
    const taskId = getField(record.fields, AIRTABLE_FIELD_TASK_ID);
    if (typeof taskId === "string" && !existingByTaskId.has(taskId)) {
      existingByTaskId.set(taskId, record);
    }
  }

  const summary: AirtableExportSummary = {
    total: input.tasks.length,
    created: 0,
    updated: 0,
    failed: [],
    airtableBaseUrl: adapter.baseUrl,
  };

  for (const task of input.tasks) {
    const fields = buildTaskAirtableFields(input.project, task);
    const existing = existingByTaskId.get(task.id);
    const action = existing ? "update" : "create";

    try {
      await retryTransient(
        () =>
          existing
            ? adapter.updateRecord(existing.id, fields)
            : adapter.createRecord(fields),
        `${action} Airtable record for task ${task.id}`,
        attempts,
        delayMs,
        sleep,
      );
      if (existing) {
        summary.updated += 1;
      } else {
        summary.created += 1;
      }
    } catch (error) {
      summary.failed.push({
        taskId: task.id,
        taskTitle: task.title,
        message: formatAirtableError(error),
      });
    }
  }

  return summary;
}

async function retryTransient<T>(
  fn: () => Promise<T>,
  label: string,
  attempts: number,
  delayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableAirtableError(error) || attempt === attempts) {
        throw error;
      }
      await sleep(delayMs * attempt);
    }
  }
  throw new Error(`Failed to ${label}: ${formatAirtableError(lastError)}`);
}

function isRetryableAirtableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode = Number((error as { statusCode?: unknown }).statusCode);
  const type = String((error as { error?: unknown }).error ?? "");
  return RETRYABLE_STATUS_CODES.has(statusCode) || RETRYABLE_ERROR_TYPES.has(type);
}

function formatAirtableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object") return "unknown Airtable error";

  const parts = [
    String((error as { message?: unknown }).message ?? ""),
    String((error as { error?: unknown }).error ?? ""),
    String((error as { statusCode?: unknown }).statusCode ?? ""),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : "unknown Airtable error";
}

function getField(fields: Record<string, unknown>, key: string) {
  return fields[key];
}

function normalizeRecord(record: AirtableRecordLike): AirtableExportRecord {
  return {
    id: record.id,
    fields: record.fields ?? {},
  };
}

function shouldExportTimestamps(): boolean {
  return process.env.AIRTABLE_EXPORT_TIMESTAMPS === "true";
}

/** Maps app status to Airtable Single select labels (e.g. todo → To do). */
export function toAirtableStatus(status: TaskStatus): string {
  if (process.env.AIRTABLE_STATUS_FORMAT === "raw") {
    return status;
  }
  return STATUS_LABELS[status];
}

/** Formats timestamps for Airtable Date (`YYYY-MM-DD`) or Date and time / text (ISO). */
export function toAirtableTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const fmt = process.env.AIRTABLE_TIMESTAMP_FORMAT;
  if (fmt === "datetime" || fmt === "text") {
    return date.toISOString();
  }
  return date.toISOString().slice(0, 10);
}

type AirtableRecordLike = {
  id: string;
  fields: Record<string, unknown>;
};
