import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/projects/[id]/export/airtable/route";
import { prisma } from "@/lib/prisma";
import {
  canEditTasks,
  getCurrentUser,
  getProjectMembership,
} from "@/lib/auth";
import { createRealAirtableAdapter, exportTasksToAirtable } from "@/lib/airtable-export";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  unauthorized: (message = "unauthorized") =>
    Response.json({ error: message }, { status: 401 }),
  forbidden: (message = "forbidden") =>
    Response.json({ error: message }, { status: 403 }),
  notFound: (message = "not found") =>
    Response.json({ error: message }, { status: 404 }),
  badRequest: (message = "bad request", details?: unknown) =>
    Response.json({ error: message, details }, { status: 400 }),
  getProjectMembership: vi.fn(),
  canEditTasks: vi.fn((role: string | null | undefined) =>
    role === "admin" || role === "member"
  ),
}));

vi.mock("@/lib/airtable-export", () => ({
  createRealAirtableAdapter: vi.fn(),
  exportTasksToAirtable: vi.fn(),
}));

const mockedPrisma = vi.mocked(prisma);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedGetProjectMembership = vi.mocked(getProjectMembership);
const mockedCanEditTasks = vi.mocked(canEditTasks);
const mockedCreateAdapter = vi.mocked(createRealAirtableAdapter);
const mockedExport = vi.mocked(exportTasksToAirtable);
const mockProjectFindUnique = mockedPrisma.project.findUnique as unknown as Mock;
const mockTaskFindMany = mockedPrisma.task.findMany as unknown as Mock;

const params = { params: Promise.resolve({ id: "proj_1" }) };

function request() {
  return new NextRequest("http://localhost/api/projects/proj_1/export/airtable", {
    method: "POST",
  });
}

describe("POST /api/projects/:id/export/airtable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "User",
    });
    mockedGetProjectMembership.mockResolvedValue({ role: "member" });
    mockedCanEditTasks.mockImplementation(
      (role) => role === "admin" || role === "member"
    );
    mockProjectFindUnique.mockResolvedValue({
      id: "proj_1",
      name: "Launch",
    });
    mockTaskFindMany.mockResolvedValue([
      {
        id: "task_1",
        title: "Draft release",
        description: "Copy",
        status: "todo",
        assigneeId: null,
        createdById: "user_1",
        position: 0,
        createdAt: new Date("2026-05-26T00:00:00.000Z"),
        updatedAt: new Date("2026-05-26T00:00:00.000Z"),
        assignee: null,
        createdBy: { id: "user_1", name: "User", email: "user@example.com" },
      },
    ]);
    mockedCreateAdapter.mockReturnValue({
      baseUrl: "https://airtable.com/app123",
      listRecords: vi.fn(),
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
    });
    mockedExport.mockResolvedValue({
      total: 1,
      created: 1,
      updated: 0,
      failed: [],
      airtableBaseUrl: "https://airtable.com/app123",
    });
  });

  it("forbids viewers from exporting", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "viewer" });

    const res = await POST(request(), params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "only project members can export tasks",
    });
    expect(mockedExport).not.toHaveBeenCalled();
  });

  it("exports tasks for project members", async () => {
    const res = await POST(request(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.created).toBe(1);
    expect(mockedCreateAdapter).toHaveBeenCalled();
    expect(mockedExport).toHaveBeenCalledWith(
      {
        project: { id: "proj_1", name: "Launch" },
        tasks: expect.any(Array),
      },
      expect.objectContaining({ baseUrl: "https://airtable.com/app123" }),
      expect.objectContaining({ attempts: 3, delayMs: 200 }),
    );
  });
});
