import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  CHAT_EMPTY_STATE_TEXT,
  CHAT_MESSAGE_MAX_LENGTH,
  RoomChatPanel,
  buildChatDisplayItems,
  chatSendBlockedReason,
  nextDraftAfterSend,
  normalizeChatText,
  sortAndDedupeChatMessages,
  type RoomChatDisplayMessage,
  type RoomChatPanelProps
} from "../../src/chat/RoomChatPanel";

/*
 * SSR render cannot click, so interaction paths are covered through the real
 * pure helpers the component uses, plus a forced `useState` initial draft (the
 * same technique as ConnectionPanel.test.tsx) to render the enabled/disabled
 * send button. No fake socket or manual network state is created anywhere.
 */
const draftState = vi.hoisted(() => ({ forced: null as string | null }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) =>
      actual.useState(
        typeof initial === "string" && initial === "" && draftState.forced !== null
          ? draftState.forced
          : initial
      )) as typeof actual.useState
  };
});

function message(overrides: Partial<RoomChatDisplayMessage> = {}): RoomChatDisplayMessage {
  return {
    seq: 1,
    playerId: "p1",
    playerName: "阿狸",
    text: "你好",
    ...overrides
  };
}

function renderPanel(overrides: Partial<RoomChatPanelProps> = {}): string {
  const props: RoomChatPanelProps = {
    messages: [],
    viewerPlayerId: null,
    connected: true,
    pending: false,
    onSend: () => true,
    error: null,
    ...overrides
  };
  return renderToStaticMarkup(<RoomChatPanel {...props} />);
}

describe("normalizeChatText", () => {
  it("trims surrounding whitespace and accepts 1..500 characters", () => {
    expect(normalizeChatText("  你好，世界  ")).toBe("你好，世界");
    expect(normalizeChatText("a")).toBe("a");
    expect(normalizeChatText("x".repeat(CHAT_MESSAGE_MAX_LENGTH))).toBe("x".repeat(500));
  });

  it("rejects whitespace-only input and input over the length limit", () => {
    expect(normalizeChatText("")).toBeNull();
    expect(normalizeChatText("   ")).toBeNull();
    expect(normalizeChatText("\n\t ")).toBeNull();
    expect(normalizeChatText("x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1))).toBeNull();
    // Whitespace is trimmed before the length check, so padding does not fail it.
    expect(normalizeChatText(`  ${"x".repeat(500)}  `)).toBe("x".repeat(500));
  });
});

describe("nextDraftAfterSend", () => {
  it("clears the draft only when the send was queued, otherwise keeps it", () => {
    expect(nextDraftAfterSend("  你好  ", true)).toBe("");
    expect(nextDraftAfterSend("  你好  ", false)).toBe("  你好  ");
  });

  it("never produces a message line from a queued send", () => {
    // The panel only ever renders `messages`; a queued send must not appear.
    expect(buildChatDisplayItems([], "p1")).toEqual([]);
  });
});

describe("chatSendBlockedReason", () => {
  it("blocks on disconnect before anything else", () => {
    expect(chatSendBlockedReason({ connected: false, pending: true, text: "" }))
      .toBe("连接已断开，暂时无法发送消息。");
  });

  it("blocks while a previous message is pending", () => {
    expect(chatSendBlockedReason({ connected: true, pending: true, text: "hi" }))
      .toBe("正在等待服务器确认上一条消息。");
  });

  it("blocks empty/whitespace drafts and over-long text", () => {
    expect(chatSendBlockedReason({ connected: true, pending: false, text: "   " }))
      .toBe("请输入消息内容。");
    expect(chatSendBlockedReason({
      connected: true,
      pending: false,
      text: "x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1)
    })).toBe(`消息过长，最多 ${CHAT_MESSAGE_MAX_LENGTH} 个字符。`);
  });

  it("allows a valid draft when connected and idle", () => {
    expect(chatSendBlockedReason({ connected: true, pending: false, text: "  hi  " })).toBeNull();
  });
});

describe("chat message ordering", () => {
  it("sorts by seq ascending and keeps the first message for a duplicated seq", () => {
    const sorted = sortAndDedupeChatMessages([
      message({ seq: 3, text: "第三" }),
      message({ seq: 1, text: "第一" }),
      message({ seq: 3, text: "重复的第三" }),
      message({ seq: 2, text: "第二" })
    ]);
    expect(sorted.map(entry => entry.seq)).toEqual([1, 2, 3]);
    expect(sorted.map(entry => entry.text)).toEqual(["第一", "第二", "第三"]);
  });

  it("does not mutate the input array", () => {
    const input = [message({ seq: 2 }), message({ seq: 1 })];
    sortAndDedupeChatMessages(input);
    expect(input.map(entry => entry.seq)).toEqual([2, 1]);
  });

  it("flags only the viewer's own lines, and nobody when the viewer is null", () => {
    const messages = [
      message({ seq: 1, playerId: "p1" }),
      message({ seq: 2, playerId: "p2" })
    ];
    expect(buildChatDisplayItems(messages, "p2").map(item => item.isSelf)).toEqual([false, true]);
    expect(buildChatDisplayItems(messages, null).map(item => item.isSelf)).toEqual([false, false]);
  });
});

describe("RoomChatPanel SSR rendering", () => {
  it("shows the empty state when server history is empty", () => {
    const markup = renderPanel({ messages: [] });
    expect(markup).toContain(CHAT_EMPTY_STATE_TEXT);
    expect(markup).not.toContain("room-chat-item");
  });

  it("renders authenticated history by seq with player names and a self tag", () => {
    const markup = renderPanel({
      viewerPlayerId: "p1",
      messages: [
        message({ seq: 2, playerId: "p2", playerName: "对手", text: "走你" }),
        message({ seq: 1, playerId: "p1", playerName: "阿狸", text: "开局吧" })
      ]
    });
    expect(markup.indexOf("开局吧")).toBeLessThan(markup.indexOf("走你"));
    expect(markup).toContain("对手");
    expect(markup).toContain(">我<");
    expect(markup).toContain("#1");
    expect(markup).toContain("#2");
  });

  it("never marks a line as self when the viewer id is null", () => {
    const markup = renderPanel({
      viewerPlayerId: null,
      messages: [message({ playerId: "p1" })]
    });
    expect(markup).not.toContain(">我<");
    expect(markup).not.toContain("room-chat-item-self");
  });

  it("renders message text and player names as escaped plain text", () => {
    const markup = renderPanel({
      messages: [
        message({
          playerId: "p2",
          playerName: '<img src=x onerror="alert(1)">',
          text: "<script>alert('x')</script> & <b>bold</b>"
        })
      ]
    });
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<b>bold</b>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&amp;");
  });

  it("does not fake an echo: an unacknowledged draft never becomes a log line", () => {
    // The only place a not-yet-acknowledged draft may appear is the input value;
    // the message list renders authenticated history only.
    draftState.forced = "尚未确认的本地消息";
    try {
      const markup = renderPanel({
        viewerPlayerId: "p1",
        messages: [message({ seq: 1, playerId: "p1", text: "已在服务端的消息" })]
      });
      expect(markup).toContain("已在服务端的消息");
      expect(markup).toContain('value="尚未确认的本地消息"');
      expect(markup).not.toContain('class="room-chat-text">尚未确认的本地消息');
      // Exactly one rendered line: the authenticated one, not the draft.
      expect(markup.match(/class="room-chat-item/g)?.length).toBe(1);
    } finally {
      draftState.forced = null;
    }
  });

  it("disables the send button while disconnected", () => {
    const markup = renderPanel({ connected: false, messages: [message()] });
    expect(markup).toMatch(/<button[^>]*disabled/);
    expect(markup).toContain("连接已断开");
  });

  it("disables the send button while a previous send is pending", () => {
    const markup = renderPanel({ pending: true, messages: [message()] });
    expect(markup).toMatch(/<button[^>]*disabled/);
    expect(markup).toContain("发送中…");
  });

  it("disables the send button for an empty draft", () => {
    draftState.forced = null;
    const markup = renderPanel({ messages: [message()] });
    expect(markup).toMatch(/<input[^>]*value=""/);
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("enables the send button for a valid draft while connected and idle", () => {
    draftState.forced = "  待发送  ";
    try {
      const markup = renderPanel({ messages: [message()] });
      expect(markup).toMatch(/<input[^>]*value="  待发送  "/);
      expect(markup).not.toMatch(/<button[^>]*disabled/);
    } finally {
      draftState.forced = null;
    }
  });

  it("surfaces a server error next to the compose box", () => {
    const markup = renderPanel({ error: "发送失败：连接中断" });
    expect(markup).toContain("发送失败：连接中断");
    expect(markup).toContain('role="alert"');
  });

  it("exposes the chat as a labelled log region separate from the game log", () => {
    const markup = renderPanel({ title: "对局聊天" });
    expect(markup).toContain("对局聊天");
    expect(markup).toContain('role="log"');
    expect(markup).not.toContain("事件日志");
  });
});
