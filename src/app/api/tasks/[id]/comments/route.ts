import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  canEditTasks,
  forbidden,
  getCurrentUser,
  getProjectMembership,
  notFound,
  unauthorized,
} from "@/lib/auth";
import { createCommentSchema } from "@/schemas/comment";

type Params = { params: Promise<{ id: string }> };

async function getTaskProjectId(id: string) {
  return prisma.task.findUnique({
    where: { id },
    select: { projectId: true },
  });
}

const commentAuthorSelect = {
  id: true,
  name: true,
  email: true,
};

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const task = await getTaskProjectId(id);
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const comments = await prisma.taskComment.findMany({
    where: { taskId: id },
    include: { author: { select: commentAuthorSelect } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const task = await getTaskProjectId(id);
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot post comments");
  }

  const body = await req.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const comment = await prisma.taskComment.create({
    data: {
      taskId: id,
      authorId: user.id,
      body: parsed.data.body,
    },
    include: { author: { select: commentAuthorSelect } },
  });

  return NextResponse.json({ comment }, { status: 201 });
}
