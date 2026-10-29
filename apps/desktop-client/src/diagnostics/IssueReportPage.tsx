import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, Send } from "lucide-react";
import { getClientLog } from "./client-log";
import { readActiveMatchRoom, readMatchLog } from "./match-log";
import {
  buildIssueReport,
  detectIssueReportPlatform,
  fitIssueReport,
  ISSUE_REPORT_DESCRIPTION_MAX,
  ISSUE_REPORT_TITLE_MAX,
  newIssueReportId,
  submitIssueReport,
  type IssueSubmitOutcome
} from "./report";
import type { DiagnosticStorage } from "./match-log";
import type { IssueReportV1 } from "./types";
import { appVersion } from "./version";
import "./IssueReportPage.css";

export interface IssueReportPageProps {
  readonly storage: DiagnosticStorage | null;
  readonly serverUrl: string;
  readonly playerName?: string;
  readonly roomId?: string | null;
  readonly playerId?: string | null;
  readonly fetchImpl?: typeof fetch;
}

export interface IssueReportDraft {
  readonly title: string;
  readonly description: string;
  readonly reportId: string | null;
}

export function resetReportDraftAfterSuccess(draft: IssueReportDraft): IssueReportDraft {
  return { ...draft, reportId: null };
}

export function currentReportDraft(title: string, description: string, reportId: string | null): IssueReportDraft {
  return { title, description, reportId };
}

const PREVIEW_LIMIT = 5;

export function IssueReportPage({
  storage,
  serverUrl,
  playerName,
  roomId,
  playerId,
  fetchImpl
}: IssueReportPageProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const reportIdRef = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<IssueSubmitOutcome | null>(null);
  const clientLog = getClientLog();
  const activeRoomId = roomId?.trim() || readActiveMatchRoom(storage);
  const matchLog = activeRoomId ? readMatchLog(storage, activeRoomId) : null;
  const platform = useMemo(() => detectIssueReportPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
    typeof navigator === "undefined" ? "" : navigator.platform,
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  ), []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || submitting) return;
    const reportId = reportIdForAttempt(currentReportDraft(title, description, reportIdRef.current));
    reportIdRef.current = reportId.reportId;
    const report: IssueReportV1 = buildIssueReport({
      title: normalizedTitle,
      description,
      appVersion,
      platform,
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      serverUrl,
      locale: typeof navigator === "undefined" ? "zh-CN" : navigator.language,
      ...(playerName === undefined ? {} : { playerName }),
      ...(activeRoomId === null ? {} : { roomId: activeRoomId }),
      ...(playerId === null || playerId === undefined ? {} : { playerId }),
      clientLog,
      matchLog
    }, reportId.reportId, new Date().toISOString());
    setSubmitting(true);
    setOutcome(null);
    try {
      const nextOutcome = await submitIssueReport(fitIssueReport(report), serverUrl, fetchImpl);
      setOutcome(nextOutcome);
      if (nextOutcome.status === "success") {
        reportIdRef.current = null;
      }
    } catch {
      setOutcome({ status: "failure", message: "报告超出 2 MiB 上限，请缩短描述后重试。", retryable: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="diag-report-page" aria-label="问题上报">
      <header className="diag-report-head">
        <div>
          <h2><FileWarning size={20} aria-hidden /> 问题上报</h2>
          <p>报告先进入游戏服务器的内存队列；服务重启后，尚未拉取的报告会丢失。</p>
        </div>
      </header>

      <div className="diag-report-grid" data-layout="responsive-two-column">
        <form className="diag-report-form" onSubmit={event => { void submit(event); }}>
          <label className="diag-report-field">
            <span>标题 <strong aria-hidden>*</strong></span>
            <input
              name="issue-title" required maxLength={ISSUE_REPORT_TITLE_MAX}
              value={title} onChange={event => setTitle(event.currentTarget.value)}
              placeholder="简要说明问题"
            />
            <small>{title.trim().length}/{ISSUE_REPORT_TITLE_MAX}</small>
          </label>
          <label className="diag-report-field">
            <span>描述</span>
            <textarea
              name="issue-description" maxLength={ISSUE_REPORT_DESCRIPTION_MAX}
              rows={8} value={description}
              onChange={event => setDescription(event.currentTarget.value)}
              placeholder="说明复现步骤、预期结果与实际结果"
            />
            <small>{description.length}/{ISSUE_REPORT_DESCRIPTION_MAX}</small>
          </label>
          <div className="diag-report-actions">
            <button className="diag-report-submit" type="submit"
              disabled={submitting || title.trim().length === 0}>
              <Send size={16} aria-hidden /> {submitting ? "正在提交…" : "提交报告"}
            </button>
            <span className="diag-report-target" title={serverUrl}>提交到 {serverUrl}</span>
          </div>
          <IssueReportOutcome outcome={outcome} />
        </form>

        <aside className="diag-report-attachments" aria-label="随报告提交的日志">
          <h3>将附带的内容</h3>
          <p>客户端日志 {clientLog.length} 条</p>
          {matchLog === null ? <p>当前未在对局中，不附带对局日志。</p> : (
            <p>对局日志 {matchLog.entries.length} 条（房间 {matchLog.roomId}）</p>
          )}
          <details>
            <summary>展开预览前几条</summary>
            <h4>客户端日志</h4>
            {clientLog.length === 0 ? <p>暂无客户端日志</p> : (
              <ol>{clientLog.slice(-PREVIEW_LIMIT).reverse().map((entry, index) =>
                <li key={`${entry.at}-${index}`}><strong>{entry.level}</strong> {entry.source}: {entry.message}</li>
              )}</ol>
            )}
            {matchLog === null ? null : <>
              <h4>对局日志</h4>
              {matchLog.entries.length === 0 ? <p>暂无对局日志</p> : (
                <ol>{matchLog.entries.slice(-PREVIEW_LIMIT).reverse().map((entry, index) =>
                  <li key={`${entry.at}-${index}`}><strong>{entry.kind}</strong> {entry.at}</li>
                )}</ol>
              )}
            </>}
          </details>
        </aside>
      </div>
    </main>
  );
}

export function IssueReportOutcome({ outcome }: { readonly outcome: IssueSubmitOutcome | null }) {
  if (outcome?.status === "success") {
    return (
      <p className="diag-report-success" role="status">
        <CheckCircle2 size={16} aria-hidden /> 已提交，编号 {outcome.reportId.slice(0, 8)}
      </p>
    );
  }
  if (outcome?.status === "failure") {
    return (
      <p className="diag-report-error" role="alert">
        <AlertTriangle size={16} aria-hidden /> {outcome.message} 可保留内容后重试。
      </p>
    );
  }
  return null;
}

export function draftAfterTitleChange(draft: IssueReportDraft, title: string): IssueReportDraft {
  return { ...draft, title: title.slice(0, ISSUE_REPORT_TITLE_MAX) };
}

export function draftAfterDescriptionChange(draft: IssueReportDraft, description: string): IssueReportDraft {
  return { ...draft, description: description.slice(0, ISSUE_REPORT_DESCRIPTION_MAX) };
}

export function reportIdForAttempt(draft: IssueReportDraft): { readonly draft: IssueReportDraft; readonly reportId: string } {
  const reportId = draft.reportId ?? newIssueReportId();
  return { draft: { ...draft, reportId }, reportId };
}

export function canSubmitIssueDraft(draft: IssueReportDraft, submitting: boolean): boolean {
  return !submitting && draft.title.trim().length > 0;
}
