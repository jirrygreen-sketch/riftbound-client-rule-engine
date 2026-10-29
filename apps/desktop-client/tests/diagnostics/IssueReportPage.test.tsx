import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeClientLog } from "../../src/diagnostics/client-log";
import { IssueReportPage } from "../../src/diagnostics/IssueReportPage";
import { appendMatchLog, readActiveMatchRoom, setActiveMatchRoom } from "../../src/diagnostics/match-log";
import { MemoryStorage } from "./fixtures";

type Node = { readonly type: unknown; readonly props: Record<string, unknown> };
type FetchCall = { readonly url: string; readonly body: Record<string, unknown> };

const captured = vi.hoisted(() => ({
  nodes: [] as Node[], states: [] as unknown[], refs: [] as Array<{ current: unknown }>,
  stateIndex: 0, refIndex: 0
}));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: Record<string, unknown> | null, ...rest: unknown[]) => {
    if (props) captured.nodes.push({ type, props });
    return (actual.jsxDEV as (...args: unknown[]) => unknown)(type, props, ...rest);
  };
  return { ...actual, jsxDEV: capture, jsx: capture };
});

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)): [T, (next: T | ((current: T) => T)) => void] {
      const index = captured.stateIndex++;
      if (!(index in captured.states)) {
        captured.states[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [captured.states[index] as T, next => {
        captured.states[index] = typeof next === "function"
          ? (next as (current: T) => T)(captured.states[index] as T) : next;
      }];
    },
    useRef<T>(initial: T): { current: T } {
      const index = captured.refIndex++;
      if (!(index in captured.refs)) captured.refs[index] = { current: initial };
      return captured.refs[index] as { current: T };
    },
    useMemo<T>(factory: () => T): T { return factory(); },
    useEffect(): void {}
  };
});

const storage = new MemoryStorage();
let fetchCalls: FetchCall[] = [];
let fetchBehavior: (callNumber: number) => Response | Promise<Response> =
  async () => new Response(null, { status: 202 });
let pageProps: { readonly roomId: string | null; readonly hasMatch: boolean;
  readonly playerName?: string; readonly playerId?: string;
  readonly userAgent?: string; readonly serverUrl?: string } =
  { roomId: null, hasMatch: false };

function renderPage(): string {
  captured.nodes.length = 0;
  captured.stateIndex = 0;
  captured.refIndex = 0;
  return renderToStaticMarkup(createElement(IssueReportPage, {
    storage,
    serverUrl: pageProps.serverUrl ?? "ws://127.0.0.1:37480/ws",
    playerName: pageProps.playerName ?? "Alice",
    roomId: pageProps.roomId,
    playerId: pageProps.playerId ?? "player-1",
    hasMatch: pageProps.hasMatch,
    ...(pageProps.userAgent === undefined ? {} : { userAgent: pageProps.userAgent }),
    fetchImpl: (async (input, init) => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(String(init?.body)) as Record<string, unknown>; } catch { /* mocked response */ }
      fetchCalls.push({ url: String(input), body });
      return fetchBehavior(fetchCalls.length);
    }) as typeof fetch
  }));
}

function inputHandler(name: string): (event: { currentTarget: { value: string } }) => void {
  const input = captured.nodes.find(node => node.props.name === name);
  if (typeof input?.props.onChange !== "function") throw new Error(`input not found: ${name}`);
  return input.props.onChange as (event: { currentTarget: { value: string } }) => void;
}

function fill(title = "无法结束回合", description = "点击后无响应"): void {
  inputHandler("issue-title")({ currentTarget: { value: title } });
  inputHandler("issue-description")({ currentTarget: { value: description } });
}

async function submit(): Promise<string> {
  renderPage();
  const form = captured.nodes.find(node => node.type === "form");
  if (typeof form?.props.onSubmit !== "function") throw new Error("form not found");
  await (form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({
    preventDefault() {}
  });
  return renderPage();
}

beforeEach(() => {
  storage.values.clear();
  initializeClientLog(storage);
  captured.nodes.length = 0;
  captured.states.length = 0;
  captured.refs.length = 0;
  captured.stateIndex = 0;
  captured.refIndex = 0;
  fetchCalls = [];
  fetchBehavior = async () => new Response(null, { status: 202 });
  pageProps = { roomId: null, hasMatch: false };
});

describe("issue report page interactions", () => {
  it("renders the required form, attached counts and responsive layout", () => {
    const markup = renderPage();
    expect(markup).toContain("客户端日志 0 条");
    expect(markup).toContain("当前未在对局中，不附带对局日志");
    expect(markup).toContain("maxLength=\"120\"");
    expect(markup).toContain("maxLength=\"4000\"");
    expect(markup).toContain('data-layout="responsive-two-column"');
  });

  it("submits the real form, keeps content after 503, and retries with one reportId", async () => {
    fetchBehavior = callNumber => new Response(null, { status: callNumber === 1 ? 503 : 202 });
    renderPage();
    fill();
    const failed = await submit();
    expect(failed).toContain("问题上报服务暂不可用，请稍后重试。");
    expect(failed).toContain("点击后无响应");
    const retried = await submit();
    expect(retried).toContain("已提交，编号 ");
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]?.url).toBe("http://127.0.0.1:37480/api/issue-reports");
    expect(fetchCalls[1]?.body.reportId).toBe(fetchCalls[0]?.body.reportId);
  });

  it.each([
    [413, "报告超过服务器允许的大小，请缩短描述后重试。"],
    [429, "提交过于频繁，请稍后再试。"],
    [503, "问题上报服务暂不可用，请稍后重试。"]
  ])("shows the final UI text for HTTP %i", async (status, expected) => {
    fetchBehavior = async () => new Response(null, { status });
    renderPage();
    fill();
    expect(await submit()).toContain(expected);
  });

  it("shows the network failure UI while preserving form contents", async () => {
    fetchBehavior = async () => { throw new Error("offline"); };
    renderPage();
    fill("断网问题", "保留的描述");
    const markup = await submit();
    expect(markup).toContain("网络错误，无法连接当前游戏服务器，请检查网络后重试。");
    expect(markup).toContain("保留的描述");
  });

  it("does not attach a stored match log when the current match flag is false", async () => {
    appendMatchLog(storage, { roomId: "old-room", matchId: "old-match", kind: "event",
      eventSeq: 1, payload: { old: true } });
    setActiveMatchRoom(storage, "old-room");
    expect(readActiveMatchRoom(storage)).toBe("old-room");
    pageProps = { roomId: null, hasMatch: false };
    renderPage();
    fill();
    const markup = await submit();
    expect(markup).toContain("当前未在对局中，不附带对局日志");
    const body = fetchCalls[0]!.body as { readonly matchLog: unknown };
    expect(body.matchLog).toBeNull();
  });

  it("attaches the active log only when the current match flag is true", async () => {
    appendMatchLog(storage, { roomId: "live-room", matchId: "live-match", kind: "event",
      eventSeq: 1, payload: { live: true } });
    setActiveMatchRoom(storage, "live-room");
    pageProps = { roomId: "live-room", hasMatch: true };
    renderPage();
    fill();
    const markup = await submit();
    expect(markup).toContain("对局日志 1 条");
    const body = fetchCalls[0]!.body as { readonly matchLog: { readonly roomId: string } | null };
    expect(body.matchLog?.roomId).toBe("live-room");
  });

  it("redacts credentials from every form-backed report field before fetch without double brackets", async () => {
    pageProps = {
      playerName: "Authorization: Bearer FORM_NAME_SECRET",
      roomId: "auth_token=\"FORM_ROOM_SECRET\"", hasMatch: true,
      playerId: "sessionSecret=FORM_ID_SECRET"
    };
    renderPage();
    fill("apiToken: FORM_TITLE_SECRET, done", 'accessToken=FORM_DESCRIPTION_SECRET&safe=1');
    const markup = await submit();
    expect(markup).toContain("已提交，编号 ");
    const bodyText = JSON.stringify(fetchCalls[0]?.body);
    for (const secret of ["FORM_NAME_SECRET", "FORM_ROOM_SECRET", "FORM_ID_SECRET",
      "FORM_TITLE_SECRET", "FORM_DESCRIPTION_SECRET"]) expect(bodyText).not.toContain(secret);
    expect(bodyText).not.toContain("[redacted]]");
    expect(bodyText).toContain("safe=1");
    expect(bodyText).toContain("done");
  });

  it("redacts userAgent and serverUrl from the real form fetch body exactly once", async () => {
    pageProps = {
      playerName: "Authorization: Bearer FORM_NAME_SECRET2",
      roomId: '{"apiKey":"FORM_ROOM_SECRET2"}', hasMatch: true,
      playerId: "sessionSecret=FORM_ID_SECRET2",
      userAgent: 'auth_token="FORM_UA_SECRET"',
      serverUrl: "sessionSecret=FORM_SERVER_SECRET"
    };
    renderPage();
    fill("accessToken=FORM_TITLE_SECRET2&safe=1", "apiToken: FORM_DESCRIPTION_SECRET2, done");
    await submit();
    const bodyText = JSON.stringify(fetchCalls[0]?.body);
    for (const secret of ["FORM_NAME_SECRET2", "FORM_ROOM_SECRET2", "FORM_ID_SECRET2",
      "FORM_TITLE_SECRET2", "FORM_DESCRIPTION_SECRET2", "FORM_UA_SECRET", "FORM_SERVER_SECRET"]) {
      expect(bodyText).not.toContain(secret);
    }
    expect(bodyText).not.toContain("[redacted]]");
    expect(bodyText).toContain("safe=1");
    expect(bodyText).toContain("done");
  });

  it("records and shows the HTTPS endpoint instead of the V2 WebSocket address", async () => {
    pageProps = { roomId: null, hasMatch: false, serverUrl: "wss://rift-beta.example.test/ws" };
    const markup = renderPage();
    expect(markup).toContain("提交到 https://rift-beta.example.test");
    expect(markup).not.toContain("wss://");
    fill();
    await submit();
    expect(fetchCalls[0]?.url).toBe("https://rift-beta.example.test/api/issue-reports");
    const client = fetchCalls[0]?.body.client as { readonly serverUrl?: string } | undefined;
    expect(client?.serverUrl).toBe("https://rift-beta.example.test");
  });

  it("does not produce double brackets when the same report retries", async () => {
    pageProps = { roomId: null, hasMatch: false,
      playerName: "Authorization: Bearer RETRY_SECRET" };
    fetchBehavior = callNumber => new Response(null, { status: callNumber === 1 ? 503 : 202 });
    renderPage();
    fill("Authorization: Bearer RETRY_TITLE", "accessToken=RETRY_DESCRIPTION");
    await submit();
    await submit();
    expect(fetchCalls).toHaveLength(2);
    for (const call of fetchCalls) {
      const bodyText = JSON.stringify(call.body);
      for (const secret of ["RETRY_SECRET", "RETRY_TITLE", "RETRY_DESCRIPTION"]) {
        expect(bodyText).not.toContain(secret);
      }
      expect(bodyText).not.toContain("[redacted]]");
    }
    expect(fetchCalls[1]?.body.reportId).toBe(fetchCalls[0]?.body.reportId);
  });

});
