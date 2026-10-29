import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "../../src/settings/display-settings";
import { MATCH_ISSUE_REPORT_LABEL, MatchControls } from "../../src/settings/MatchControls";
import { HomePage } from "../../src/navigation/HomePage";
import { APP_PAGE_TITLES } from "../../src/navigation/AppShell";

type CapturedElement = ReactElement<Record<string, unknown>>;
const captured = vi.hoisted(() => ({ elements: [] as CapturedElement[] }));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
    captured.elements.push(actual.jsxDEV(type, props, ...rest as never[]) as CapturedElement);
    return actual.jsxDEV(type, props, ...rest as never[]);
  };
  return { ...actual, jsxDEV: capture, jsx: capture };
});

function click(entryId: string): void {
  const button = captured.elements.findLast(element =>
    element.type === "button" && element.props["data-entry"] === entryId);
  if (!button || typeof button.props.onClick !== "function") throw new Error(`button not found: ${entryId}`);
  (button.props.onClick as () => void)();
}

function clickByClass(className: string): void {
  const button = captured.elements.findLast(element => element.type === "button" &&
    typeof element.props.className === "string" && element.props.className.includes(className));
  if (!button || typeof button.props.onClick !== "function") throw new Error(`button not found: ${className}`);
  (button.props.onClick as () => void)();
}

describe("issue report entry points", () => {
  it("routes the home menu card through its real click handler", () => {
    const navigate = vi.fn();
    captured.elements.length = 0;
    const markup = renderToStaticMarkup(createElement(HomePage, {
      onNavigate: navigate, onExit: () => undefined, playerName: "Alice",
      connected: true, inMatch: false, roomId: null, deckCount: 0
    }));
    expect(markup).toContain('data-entry="issue-report"');
    click("issue-report");
    expect(navigate).toHaveBeenCalledWith("issue-report");
    expect(APP_PAGE_TITLES["issue-report"]).toBe("问题上报");
  });

  it("routes the in-match gear-menu action through its real click handler", () => {
    const issueReport = vi.fn();
    captured.elements.length = 0;
    const markup = renderToStaticMarkup(createElement(MatchControls, {
      settings: DEFAULT_DISPLAY_SETTINGS, onChange: () => undefined,
      onGoHome: () => undefined, onGoRoom: () => undefined,
      onIssueReport: issueReport
    }));
    expect(markup).toContain(MATCH_ISSUE_REPORT_LABEL);
    clickByClass("stg-issue-report-action");
    expect(issueReport).toHaveBeenCalledTimes(1);
  });

});
