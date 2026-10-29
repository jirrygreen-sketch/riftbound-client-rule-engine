import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "../../src/settings/display-settings";
import { MATCH_ISSUE_REPORT_LABEL, MatchControls } from "../../src/settings/MatchControls";
import { HomePage } from "../../src/navigation/HomePage";
import { APP_PAGE_TITLES } from "../../src/navigation/AppShell";

describe("issue report entry points", () => {
  it("renders a home menu card that routes to the issue report page", () => {
    let navigated = "";
    const markup = renderToStaticMarkup(createElement(HomePage, {
      onNavigate: page => { navigated = page; },
      onExit: () => undefined,
      playerName: "Alice",
      connected: true,
      inMatch: false,
      roomId: null,
      deckCount: 0
    }));
    expect(markup).toContain('data-entry="issue-report"');
    expect(markup).toContain("问题上报");
    expect(APP_PAGE_TITLES["issue-report"]).toBe("问题上报");
    const Card = HomePage({ onNavigate: page => { navigated = page; }, onExit: () => undefined,
      playerName: "Alice", connected: true, inMatch: false, roomId: null, deckCount: 0 });
    expect(Card).toBeTruthy();
    expect(markup).toContain('data-entry="settings"');
    void navigated;
  });

  it("renders the issue report action inside the in-match gear menu", () => {
    const markup = renderToStaticMarkup(createElement(MatchControls, {
      settings: DEFAULT_DISPLAY_SETTINGS,
      onChange: () => undefined,
      onGoHome: () => undefined,
      onGoRoom: () => undefined,
      onIssueReport: () => undefined
    }));
    expect(markup).toContain(MATCH_ISSUE_REPORT_LABEL);
    expect(markup).toMatch(/class="stg-button stg-issue-report-action"[^>]*>问题上报<\/button>/u);
  });
});
