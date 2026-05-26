import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
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

const mockedPrisma = vi.mocked(prisma);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedGetProjectMembership = vi.mocked(getProjectMembership);
const mockedCanEditTasks = vi.mocked(canEditTasks);
const mockTaskFindUnique = mockedPrisma.task.findUnique as unknown as Mock;
const mockTaskUpdate = mockedPrisma.task.update as unknown as Mock;

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/tasks/task_1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "task_1" }) };

describe("PATCH /api/tasks/:id authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "User",
    });
    mockTaskFindUnique.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
    });
    mockTaskUpdate.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      status: "done",
      assignee: null,
    });
    mockedCanEditTasks.mockImplementation(
      (role) => role === "admin" || role === "member"
    );
  });

  it("rejects a non-member before updating the task", async () => {
    mockedGetProjectMembership.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ status: "done" }), params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "you are not a member of this project",
    });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("rejects a viewer before updating the task", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "viewer" });
    mockedCanEditTasks.mockReturnValue(false);

    const res = await PATCH(patchRequest({ status: "done" }), params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "viewers cannot update tasks",
    });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("allows a project member to update the task", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "member" });

    const res = await PATCH(patchRequest({ status: "done" }), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.task.status).toBe("done");
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: "task_1" },
      data: { status: "done" },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
      },
    });
  });
});
