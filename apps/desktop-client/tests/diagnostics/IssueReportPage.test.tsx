import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeClientLog } from "../../src/diagnostics/client-log";
import { IssueReportPage } from "../../src/diagnostics/IssueReportPage";
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

function renderPage(): string {
  captured.nodes.length = 0;
  captured.stateIndex = 0;
  captured.refIndex = 0;
  return renderToStaticMarkup(createElement(IssueReportPage, {
    storage,
    serverUrl: "ws://127.0.0.1:37480/ws",
    playerName: "Alice",
    roomId: null,
    playerId: "player-1",
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
});
