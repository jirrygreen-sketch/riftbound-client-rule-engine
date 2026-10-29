import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeClientLog } from "../../src/diagnostics/client-log";
import {
  canSubmitIssueDraft,
  draftAfterDescriptionChange,
  draftAfterTitleChange,
  IssueReportPage,
  IssueReportOutcome,
  reportIdForAttempt,
  resetReportDraftAfterSuccess,
  type IssueReportDraft
} from "../../src/diagnostics/IssueReportPage";
import { buildIssueReport, submitIssueReport } from "../../src/diagnostics/report";
import { MemoryStorage } from "./fixtures";

const storage = new MemoryStorage();
const initialDraft: IssueReportDraft = { title: "", description: "", reportId: null };

function render(fetchImpl: typeof fetch): string {
  return renderToStaticMarkup(createElement(IssueReportPage, {
    storage,
    serverUrl: "ws://127.0.0.1:37480/ws",
    playerName: "Alice",
    roomId: null,
    playerId: "player-1",
    fetchImpl
  }));
}

beforeEach(() => {
  storage.values.clear();
  initializeClientLog(storage);
});

describe("issue report page", () => {
  it("renders fields, local log counts, no-match state, and bounded layout hook", () => {
    const markup = render((async () => new Response(null, { status: 202 })) as typeof fetch);
    expect(markup).toContain('aria-label="问题上报"');
    expect(markup).toContain("客户端日志 0 条");
    expect(markup).toContain("当前未在对局中，不附带对局日志");
    expect(markup).toContain('name="issue-title"');
    expect(markup).toContain("maxLength=\"120\"");
    expect(markup).toContain("maxLength=\"4000\"");
    expect(markup).toContain("class=\"diag-report-page\"");
    expect(markup).toContain('class="diag-report-grid"');
    expect(markup).toContain('data-layout="responsive-two-column"');
  });

  it("renders each failure reason and the successful report prefix", () => {
    const messages = [
      "报告超过服务器允许的大小，请缩短描述后重试。",
      "提交过于频繁，请稍后再试。",
      "问题上报服务暂不可用，请稍后重试。",
      "网络错误，无法连接当前游戏服务器，请检查网络后重试。"
    ];
    for (const message of messages) {
      const markup = renderToStaticMarkup(createElement(IssueReportOutcome, {
        outcome: { status: "failure", message, retryable: true }
      }));
      expect(markup).toContain('role="alert"');
      expect(markup).toContain(message);
    }
    const success = renderToStaticMarkup(createElement(IssueReportOutcome, {
      outcome: { status: "success", reportId: "12345678-1234-4123-8123-123456789abc" }
    }));
    expect(success).toContain("已提交，编号 12345678");
  });

  it("keeps the title/description and report ID used by the next retry", () => {
    const titled = draftAfterTitleChange(initialDraft, "无法结束回合");
    const described = draftAfterDescriptionChange(titled, "点击后无响应");
    const first = reportIdForAttempt(described);
    const retry = reportIdForAttempt(first.draft);
    expect(first.draft.title).toBe("无法结束回合");
    expect(first.draft.description).toBe("点击后无响应");
    expect(first.reportId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(retry.reportId).toBe(first.reportId);
    expect(canSubmitIssueDraft(retry.draft, false)).toBe(true);
    expect(canSubmitIssueDraft(retry.draft, true)).toBe(false);
    expect(canSubmitIssueDraft(initialDraft, false)).toBe(false);
    expect(resetReportDraftAfterSuccess(retry.draft).reportId).toBeNull();
    expect(reportIdForAttempt(resetReportDraftAfterSuccess(retry.draft)).reportId).not.toBe(first.reportId);
  });

  it("renders the stable report payload submitted to the HTTP endpoint", async () => {
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(null, { status: requests.length === 1 ? 503 : 202 });
    }) as typeof fetch;
    const reportId = "12345678-1234-4123-8123-123456789abc";
    const report = buildIssueReport({
      title: "无法结束回合", description: "点击后无响应", appVersion: "0.1.0",
      platform: "web", userAgent: "UA", serverUrl: "ws://127.0.0.1:37480/ws",
      locale: "zh-CN", playerName: "Alice", playerId: "player-1",
      clientLog: [], matchLog: null
    }, reportId);
    const first = await submitIssueReport(report, "ws://127.0.0.1:37480/ws", fetchImpl);
    const retry = await submitIssueReport(report, "ws://127.0.0.1:37480/ws", fetchImpl);
    expect(first).toMatchObject({ status: "failure" });
    expect(first.status === "failure" ? first.message : "").toContain("暂不可用");
    expect(retry).toEqual({ status: "success", reportId });
    expect(requests[0]?.url).toBe("http://127.0.0.1:37480/api/issue-reports");
    const payloads = requests.map(request => JSON.parse(String(request.init?.body)) as {
      readonly reportId: string; readonly title: string;
    });
    expect(payloads[0]?.reportId).toBe(reportId);
    expect(payloads[1]?.reportId).toBe(reportId);
    expect(payloads[0]?.title).toBe("无法结束回合");
    expect(requests[0]?.init?.headers).toEqual({ "content-type": "application/json" });
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });
});
