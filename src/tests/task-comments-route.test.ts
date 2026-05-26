import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";
import { prisma } from "@/lib/prisma";
import {
  canEditTasks,
  getCurrentUser,
  getProjectMembership,
} from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
    },
    taskComment: {
      findMany: vi.fn(),
      create: vi.fn(),
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
const mockCommentFindMany = mockedPrisma.taskComment.findMany as unknown as Mock;
const mockCommentCreate = mockedPrisma.taskComment.create as unknown as Mock;

const params = { params: Promise.resolve({ id: "task_1" }) };

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/tasks/task_1/comments", {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });
}

describe("/api/tasks/:id/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "user@example.com",
      name: "User",
    });
    mockTaskFindUnique.mockResolvedValue({ projectId: "project_1" });
    mockedGetProjectMembership.mockResolvedValue({ role: "member" });
    mockedCanEditTasks.mockImplementation(
      (role) => role === "admin" || role === "member"
    );
  });

  it("lists comments chronologically for project viewers", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "viewer" });
    mockCommentFindMany.mockResolvedValue([
      { id: "comment_1", body: "first" },
      { id: "comment_2", body: "second" },
    ]);

    const res = await commentsRoute.GET(request("GET"), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.comments).toHaveLength(2);
    expect(mockCommentFindMany).toHaveBeenCalledWith({
      where: { taskId: "task_1" },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("blocks viewers from posting comments", async () => {
    mockedGetProjectMembership.mockResolvedValue({ role: "viewer" });
    mockedCanEditTasks.mockReturnValue(false);

    const res = await commentsRoute.POST(
      request("POST", { body: "viewer comment" }),
      params
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "viewers cannot post comments",
    });
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it("creates comments for project members", async () => {
    mockCommentCreate.mockResolvedValue({
      id: "comment_1",
      taskId: "task_1",
      authorId: "user_1",
      body: "Ship it",
      author: { id: "user_1", name: "User", email: "user@example.com" },
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
    });

    const res = await commentsRoute.POST(
      request("POST", { body: "  Ship it  " }),
      params
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.comment.body).toBe("Ship it");
    expect(mockCommentCreate).toHaveBeenCalledWith({
      data: {
        taskId: "task_1",
        authorId: "user_1",
        body: "Ship it",
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });
  });

  it("does not expose edit or delete handlers", () => {
    expect("PATCH" in commentsRoute).toBe(false);
    expect("DELETE" in commentsRoute).toBe(false);
  });
});
