import { beforeEach, describe, expect, it, vi } from "vitest";
import { AirtableMockClient } from "@/lib/airtable-mock";
import {
  buildTaskAirtableFields,
  createMockAirtableAdapter,
  exportTasksToAirtable,
  toAirtableStatus,
  toAirtableTimestamp,
  type AirtableExportAdapter,
} from "@/lib/airtable-export";

const project = { id: "proj_1", name: "Launch" };
const tasks = [
  {
    id: "task_1",
    projectId: "proj_1",
    title: "Draft release email",
    description: "Email copy",
    status: "todo" as const,
    assigneeId: "user_1",
    createdById: "user_2",
    position: 0,
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    assignee: { id: "user_1", name: "Meera", email: "meera@taskboard.dev" },
    createdBy: { id: "user_2", name: "Arjun", email: "arjun@taskboard.dev" },
  },
  {
    id: "task_2",
    projectId: "proj_1",
    title: "QA signup flow",
    description: null,
    status: "in_progress" as const,
    assigneeId: null,
    createdById: "user_2",
    position: 1,
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    assignee: null,
    createdBy: { id: "user_2", name: "Arjun", email: "arjun@taskboard.dev" },
  },
];

describe("buildTaskAirtableFields", () => {
  it("omits assignee when unassigned", () => {
    const fields = buildTaskAirtableFields(project, tasks[1]);
    expect(fields).not.toHaveProperty("Assignee");
    expect(fields).toHaveProperty("Created By", "Arjun");
  });

  it("includes assignee name when present", () => {
    const fields = buildTaskAirtableFields(project, tasks[0]);
    expect(fields.Assignee).toBe("Meera");
  });

  it("maps status to Airtable-friendly labels", () => {
    expect(toAirtableStatus("todo")).toBe("To do");
    expect(toAirtableStatus("in_progress")).toBe("In progress");
    const fields = buildTaskAirtableFields(project, tasks[1]);
    expect(fields.Status).toBe("In progress");
  });

  it("skips timestamps unless AIRTABLE_EXPORT_TIMESTAMPS=true", () => {
    const fields = buildTaskAirtableFields(project, tasks[0]);
    expect(fields).not.toHaveProperty("Created At");
    expect(fields).not.toHaveProperty("Updated At");
  });

  it("formats timestamps as YYYY-MM-DD when export is enabled", () => {
    process.env.AIRTABLE_EXPORT_TIMESTAMPS = "true";
    expect(toAirtableTimestamp("2026-05-26T14:30:00.000Z")).toBe("2026-05-26");
    const fields = buildTaskAirtableFields(project, tasks[0]);
    expect(fields["Created At"]).toBe("2026-05-26");
    expect(fields["Updated At"]).toBe("2026-05-26");
    delete process.env.AIRTABLE_EXPORT_TIMESTAMPS;
  });
});

describe("exportTasksToAirtable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates records on first run and updates them on repeat runs", async () => {
    const mock = new AirtableMockClient();
    const adapter = createMockAirtableAdapter(mock);

    const first = await exportTasksToAirtable(
      { project, tasks },
      adapter,
      { sleep: async () => {} },
    );
    const second = await exportTasksToAirtable(
      { project, tasks },
      adapter,
      { sleep: async () => {} },
    );

    expect(first.created).toBe(2);
    expect(first.updated).toBe(0);
    expect(first.failed).toHaveLength(0);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    expect(second.failed).toHaveLength(0);
    expect(mock.__getRecordCount()).toBe(2);
  });

  it("retries transient Airtable failures", async () => {
    const mock = new AirtableMockClient();
    mock.__setFailurePlan(["server-error"]);
    const adapter = createMockAirtableAdapter(mock);

    const summary = await exportTasksToAirtable(
      { project, tasks: tasks.slice(0, 1) },
      adapter,
      { sleep: async () => {} },
    );

    expect(summary.created).toBe(1);
    expect(summary.failed).toHaveLength(0);
    expect(mock.__getRecordCount()).toBe(1);
  });

  it("keeps going when a single record fails permanently", async () => {
    let calls = 0;
    const adapter: AirtableExportAdapter = {
      baseUrl: "https://airtable.com/mock",
      async listRecords() {
        return [];
      },
      async createRecord(fields) {
        calls += 1;
        if (calls === 2) {
          throw { error: "UNPROCESSABLE_ENTITY", message: "bad data", statusCode: 422 };
        }
        return { id: `rec_${calls}`, fields };
      },
      async updateRecord(id, fields) {
        return { id, fields };
      },
    };

    const summary = await exportTasksToAirtable(
      { project, tasks },
      adapter,
      { sleep: async () => {} },
    );

    expect(summary.created).toBe(1);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].taskId).toBe("task_2");
  });
});
