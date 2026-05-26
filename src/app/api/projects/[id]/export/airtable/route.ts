import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canEditTasks,
  forbidden,
  getCurrentUser,
  getProjectMembership,
  notFound,
  unauthorized,
} from "@/lib/auth";
import {
  createRealAirtableAdapter,
  exportTasksToAirtable,
} from "@/lib/airtable-export";

type Params = { params: Promise<{ id: string }> };

function isAirtableNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode = Number((error as { statusCode?: unknown }).statusCode);
  const code = String((error as { error?: unknown }).error ?? "");
  return statusCode === 404 || code === "NOT_FOUND";
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const membership = await getProjectMembership(user.id, id);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("only project members can export tasks");
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!project) return notFound("project not found");

  const tasks = await prisma.task.findMany({
    where: { projectId: id },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });

  let adapter;
  try {
    adapter = createRealAirtableAdapter();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Airtable export is not configured",
      },
      { status: 500 },
    );
  }

  try {
    const summary = await exportTasksToAirtable(
      { project, tasks },
      adapter,
      { attempts: 3, delayMs: 200 },
    );
    return NextResponse.json({ summary }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Airtable export failed";
    const isConfigError = isAirtableNotFoundError(error);

    return NextResponse.json(
      {
        error: isConfigError
          ? "Airtable base or table not found. Check AIRTABLE_BASE_ID and AIRTABLE_TABLE_NAME in .env."
          : message,
      },
      { status: isConfigError ? 502 : 500 },
    );
  }
}
