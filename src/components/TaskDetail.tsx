"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getStoredUser } from "@/lib/api-client";
import type { ApiComment, ApiProjectMember, ApiTask, TaskStatus } from "@/types";
import { STATUS_LABELS, STATUS_ORDER } from "@/types";

type Props = {
  task: ApiTask;
  projectId: string;
  members: ApiProjectMember[];
  onClose: () => void;
};

export function TaskDetail({ task, projectId, members, onClose }: Props) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState<string>(task.assigneeId ?? "");
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const currentUser = getStoredUser();
  const currentMember = members.find((m) => m.user.id === currentUser?.id);
  const canPostComments = currentMember?.role === "admin" || currentMember?.role === "member";

  const commentsQuery = useQuery({
    queryKey: ["task-comments", task.id],
    queryFn: () =>
      apiFetch<{ comments: ApiComment[] }>(`/api/tasks/${task.id}/comments`),
  });

  const updateTask = useMutation({
    mutationFn: (input: Partial<ApiTask>) =>
      apiFetch<{ task: ApiTask }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "save failed"),
  });

  const deleteTask = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/api/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "delete failed"),
  });

  const createComment = useMutation({
    mutationFn: (body: string) =>
      apiFetch<{ comment: ApiComment }>(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setCommentBody("");
      queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "comment failed"),
  });

  function onSave() {
    setError(null);
    updateTask.mutate({
      title,
      description,
      status,
      assigneeId: assigneeId || null,
    });
  }

  function onCommentSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = commentBody.trim();
    if (!body) return;
    setError(null);
    createComment.mutate(body);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[min(90vh,760px)] overflow-hidden bg-surface border border-border rounded-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">edit task</h2>
          <button onClick={onClose} className="text-muted hover:text-white">
            x
          </button>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="p-6 overflow-y-auto min-h-0 flex flex-col">
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-muted">title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs text-muted">description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={8}
                  className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-muted">status</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs text-muted">assignee</span>
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  >
                    <option value="">unassigned</option>
                    {members.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {error && (
                <p className="text-sm text-red-400" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 mt-auto pt-6">
              <button
                onClick={() => deleteTask.mutate()}
                disabled={deleteTask.isPending}
                className="text-sm text-red-400 hover:text-red-300"
              >
                delete task
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="text-sm px-4 py-2 rounded-md border border-border hover:border-muted"
                >
                  cancel
                </button>
                <button
                  onClick={onSave}
                  disabled={updateTask.isPending}
                  className="text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {updateTask.isPending ? "saving..." : "save"}
                </button>
              </div>
            </div>
          </div>

          <section className="border-t md:border-t-0 md:border-l border-border p-6 min-h-0 flex flex-col">
            <h3 className="text-sm font-medium mb-3 shrink-0">comments</h3>

            {commentsQuery.isLoading && (
              <p className="text-xs text-muted">loading comments...</p>
            )}
            {commentsQuery.error && (
              <p className="text-xs text-red-400">
                {commentsQuery.error instanceof Error
                  ? commentsQuery.error.message
                  : "failed to load comments"}
              </p>
            )}
            {commentsQuery.data?.comments.length === 0 && (
              <p className="text-xs text-muted italic">no comments yet</p>
            )}

            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-2 overscroll-contain">
              {commentsQuery.data?.comments.map((comment) => (
                <article key={comment.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted mb-2">
                    <span>{comment.author.name}</span>
                    <time dateTime={comment.createdAt}>
                      {new Date(comment.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
                </article>
              ))}
            </div>

            {canPostComments ? (
              <form onSubmit={onCommentSubmit} className="mt-4 space-y-2 shrink-0">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={4}
                  placeholder="add a comment"
                  className="block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={createComment.isPending || !commentBody.trim()}
                  className="text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {createComment.isPending ? "posting..." : "post comment"}
                </button>
              </form>
            ) : (
              <p className="text-xs text-muted mt-4 shrink-0">
                viewers can read comments only
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
