"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { AirtableExportSummary } from "@/lib/airtable-export";

type ExportMutation = UseMutationResult<
  { summary: AirtableExportSummary },
  Error,
  void,
  unknown
>;

type DialogProps = {
  taskCount: number;
  open: boolean;
  onClose: () => void;
  exportTasks: ExportMutation;
};

type DialogPhase = "loading" | "success" | "partial" | "error";

const BTN_PRIMARY =
  "flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500";
const BTN_SECONDARY =
  "flex-1 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-white hover:bg-bg";

const ICON_RING: Record<"success" | "warning" | "error", string> = {
  success: "bg-emerald-500/15 text-emerald-400",
  warning: "bg-amber-500/15 text-amber-400",
  error: "bg-red-500/15 text-red-400",
};

function DialogIcon({
  tone,
  children,
}: {
  tone: keyof typeof ICON_RING;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex h-12 w-12 items-center justify-center rounded-full ${ICON_RING[tone]}`}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div
      className="h-11 w-11 rounded-full border-2 border-border border-t-accent animate-spin"
      role="status"
      aria-label="Loading"
    />
  );
}

function resolvePhase(
  isPending: boolean,
  isError: boolean,
  summary: AirtableExportSummary | undefined,
): DialogPhase | null {
  if (isPending) return "loading";
  if (isError) return "error";
  if (!summary) return null;
  return summary.failed.length > 0 ? "partial" : "success";
}

export function AirtableExportDialog({
  taskCount,
  open,
  onClose,
  exportTasks,
}: DialogProps) {
  const isLoading = exportTasks.isPending;
  const summary = exportTasks.data?.summary;
  const phase = resolvePhase(isLoading, exportTasks.isError, summary);

  useEffect(() => {
    if (!open || isLoading) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      exportTasks.reset();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, isLoading, exportTasks, onClose]);

  function handleClose() {
    if (isLoading) return;
    exportTasks.reset();
    onClose();
  }

  function openAirtableBase() {
    if (!summary?.airtableBaseUrl) return;
    window.open(summary.airtableBaseUrl, "_blank", "noopener,noreferrer");
  }

  if (!open) return null;

  const synced = summary ? summary.created + summary.updated : 0;
  const taskWord = taskCount === 1 ? "task" : "tasks";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="airtable-export-title"
        aria-busy={isLoading}
      >
        {phase === "loading" && (
          <div className="flex flex-col items-center px-8 py-10 text-center">
            <Spinner />
            <h2
              id="airtable-export-title"
              className="mt-6 text-lg font-semibold text-white"
            >
              Exporting to Airtable
            </h2>
            <p className="mt-2 text-sm text-muted">
              Syncing {taskCount} {taskWord} to your base…
            </p>
            <p className="mt-1 text-xs text-muted">This may take a few seconds.</p>
          </div>
        )}

        {phase === "success" && summary && (
          <div className="px-8 py-8">
            <DialogIcon tone="success">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </DialogIcon>
            <h2 id="airtable-export-title" className="mt-4 text-lg font-semibold text-white">
              Export complete
            </h2>
            <p className="mt-2 text-sm text-muted">
              {synced} of {summary.total}{" "}
              {summary.total === 1 ? "task was" : "tasks were"} synced to Airtable.
            </p>
            <ul className="mt-4 space-y-1 rounded-md border border-border bg-bg/50 px-4 py-3 text-sm">
              <li className="flex justify-between gap-4">
                <span className="text-muted">Created</span>
                <span className="font-medium text-white">{summary.created}</span>
              </li>
              <li className="flex justify-between gap-4">
                <span className="text-muted">Updated</span>
                <span className="font-medium text-white">{summary.updated}</span>
              </li>
            </ul>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={openAirtableBase} className={BTN_PRIMARY}>
                Open in Airtable
              </button>
              <button type="button" onClick={handleClose} className={BTN_SECONDARY}>
                Done
              </button>
            </div>
          </div>
        )}

        {phase === "partial" && summary && (
          <div className="px-8 py-8">
            <DialogIcon tone="warning">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </DialogIcon>
            <h2 id="airtable-export-title" className="mt-4 text-lg font-semibold text-white">
              Export finished with errors
            </h2>
            <p className="mt-2 text-sm text-muted">
              {synced} of {summary.total} tasks synced. {summary.failed.length}{" "}
              {summary.failed.length === 1 ? "task failed" : "tasks failed"}.
            </p>
            <ul className="mt-4 max-h-40 space-y-2 overflow-y-auto rounded-md border border-border bg-bg/50 px-3 py-3 text-sm">
              {summary.failed.map((item) => (
                <li
                  key={item.taskId}
                  className="border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <p className="font-medium text-white">{item.taskTitle}</p>
                  <p className="mt-0.5 text-xs text-red-400">{item.message}</p>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              {summary.airtableBaseUrl && (
                <button type="button" onClick={openAirtableBase} className={BTN_SECONDARY}>
                  Open in Airtable
                </button>
              )}
              <button type="button" onClick={handleClose} className={BTN_PRIMARY}>
                Close
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="px-8 py-8">
            <DialogIcon tone="error">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </DialogIcon>
            <h2 id="airtable-export-title" className="mt-4 text-lg font-semibold text-white">
              Export failed
            </h2>
            <p className="mt-2 text-sm text-red-400" role="alert">
              {exportTasks.error instanceof Error
                ? exportTasks.error.message
                : "Something went wrong while exporting to Airtable."}
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => exportTasks.mutate()}
                className={BTN_PRIMARY}
              >
                Try again
              </button>
              <button type="button" onClick={handleClose} className={BTN_SECONDARY}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type TriggerProps = {
  projectId: string;
  taskCount: number;
  onComplete?: () => void;
};

export function AirtableExportButton({
  projectId,
  taskCount,
  onComplete,
}: TriggerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const exportTasks = useMutation({
    mutationFn: () =>
      apiFetch<{ summary: AirtableExportSummary }>(
        `/api/projects/${projectId}/export/airtable`,
        { method: "POST" },
      ),
    onSuccess: () => {
      onComplete?.();
    },
  });

  function startExport() {
    setDialogOpen(true);
    exportTasks.reset();
    exportTasks.mutate();
  }

  return (
    <>
      <button
        type="button"
        onClick={startExport}
        disabled={exportTasks.isPending}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        <svg
          className="h-4 w-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
        Export to Airtable
      </button>
      <AirtableExportDialog
        taskCount={taskCount}
        open={dialogOpen}
        onClose={closeDialog}
        exportTasks={exportTasks}
      />
    </>
  );
}
