import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  ROOM_LOBBY_CHAT_LABEL,
  ROOM_LOBBY_DECK_LABEL,
  ROOM_LOBBY_HEADER_LABEL,
  ROOM_LOBBY_LABEL,
  ROOM_LOBBY_PLAYERS_LABEL,
  ROOM_LOBBY_READY_LABEL,
  RoomLobby,
  roomRulesetLabel,
  shortPlayerId
} from "../src/components/RoomLobby";
import type { RoomLobbyProps } from "../src/components/RoomLobby";
import {
  DUEL_RULESET_ID,
  FOUNDATION_RULESET_ID,
  RULESET_ID,
  type RoomPlayer,
  type RoomView
} from "@riftbound/protocol";

function roomPlayer(overrides: Partial<RoomPlayer> & { id: string }): RoomPlayer {
  return {
    name: overrides.name ?? `玩家 ${overrides.id}`,
    connected: true,
    ready: false,
    deckSubmitted: false,
    ...overrides
  };
}

const twoPlayers: RoomView = {
  roomId: "room-42",
  status: "waiting",
  rulesetId: FOUNDATION_RULESET_ID,
  version: 3,
  roomVersion: 5,
  roomEventSeq: 7,
  players: [
    roomPlayer({ id: "player-1", name: "观星者", ready: true, deckSubmitted: true }),
    roomPlayer({ id: "player-2", name: "筑界师", connected: false })
  ]
};

function baseProps(overrides: Partial<RoomLobbyProps> = {}): RoomLobbyProps {
  return {
    room: twoPlayers,
    viewerPlayerId: "player-1",
    deckPicker: <div data-probe="deck-picker">卡组选择器样例</div>,
    chat: <div data-probe="chat-slot">聊天样例</div>,
    onSubmitDeck: vi.fn(),
    onToggleReady: vi.fn(),
    onSync: vi.fn(),
    canSubmitDeck: true,
    canToggleReady: true,
    readyLabel: "准备就绪",
    onEnterGame: vi.fn(),
    ...overrides
  };
}

const render = (overrides: Partial<RoomLobbyProps> = {}): string =>
  renderToStaticMarkup(<RoomLobby {...baseProps(overrides)} />);

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("RoomLobby presentation shell", () => {
  it("renders every labeled region and the raw room facts from the projection", () => {
    const html = render();

    for (const label of [
      ROOM_LOBBY_LABEL,
      ROOM_LOBBY_HEADER_LABEL,
      ROOM_LOBBY_DECK_LABEL,
      ROOM_LOBBY_PLAYERS_LABEL,
      ROOM_LOBBY_READY_LABEL,
      ROOM_LOBBY_CHAT_LABEL
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }

    expect(html).toContain("room-42");
    expect(html).toContain(roomRulesetLabel(FOUNDATION_RULESET_ID));
    expect(html).toContain("等待中");
  });

  it("iterates the real players array instead of assuming exactly two seats", () => {
    const single = render({
      room: { ...twoPlayers, players: [roomPlayer({ id: "solo" })] }
    });
    expect(count(single, 'class="room-lobby-player-head"')).toBe(1);

    const three: RoomView = {
      ...twoPlayers,
      players: [
        roomPlayer({ id: "p-a" }),
        roomPlayer({ id: "p-b" }),
        roomPlayer({ id: "p-c" })
      ]
    };
    const many = render({ room: three, viewerPlayerId: null });
    expect(count(many, 'class="room-lobby-player-head"')).toBe(3);
  });

  it("marks only the viewer as you and shows id/connection/ready/deck per player", () => {
    const html = render();

    expect(count(html, "room-lobby-player-you")).toBe(1);
    expect(html).toContain("观星者");
    expect(html).toContain("筑界师");
    expect(html).toContain(shortPlayerId("player-1"));
    expect(html).toContain(shortPlayerId("player-2"));

    expect(html).toContain("已连接");
    expect(html).toContain("未连接");
    expect(html).toContain("已准备");
    expect(html).toContain("未准备");
    expect(html).toContain("卡组已提交");
    expect(html).toContain("卡组未提交");
  });

  it("never leaks opponent deck contents or fake avatars/account info", () => {
    const html = render();

    // No card names, avatar images, or account e-mails are synthesized here.
    expect(html).not.toContain("<img");
    expect(html).not.toContain("@");
    // Only the viewer's own id gets the "you" marker; nothing fabricates a seat.
    expect(html).not.toContain("对手");
  });

  it("renders the deck and chat slots verbatim inside their fixed regions", () => {
    const deckPicker = <div data-probe="deck-picker">唯一卡组选择器</div>;
    const chat = <div data-probe="chat-slot">唯一聊天</div>;
    const html = render({ deckPicker, chat });

    expect(html).toContain(renderToStaticMarkup(deckPicker));
    expect(html).toContain(renderToStaticMarkup(chat));
    expect(count(html, 'data-probe="deck-picker"')).toBe(1);
    expect(count(html, 'data-probe="chat-slot"')).toBe(1);

    // The chat region is always present, so a wide selector cannot remove it.
    const chatRegionAt = html.indexOf(`aria-label="${ROOM_LOBBY_CHAT_LABEL}"`);
    const chatSlotAt = html.indexOf('data-probe="chat-slot"');
    expect(chatRegionAt).toBeGreaterThan(-1);
    expect(chatSlotAt).toBeGreaterThan(chatRegionAt);
  });

  it("does not duplicate the chat title: the supplied slot owns the visible heading", () => {
    // The supplied panel prints its own visible "房间聊天" heading, so the shell
    // must not print a second one on top of it.
    const chat = (
      <section aria-label="房间聊天">
        <h2>房间聊天</h2>
        <div data-probe="chat-slot">唯一聊天</div>
      </section>
    );
    const html = render({ chat });

    expect(count(html, ">房间聊天</h2>")).toBe(1);
    expect(count(html, 'class="room-lobby-col-title"')).toBe(3);

    // The chat region stays named for assistive tech and still wraps the slot.
    const chatRegionAt = html.indexOf(`aria-label="${ROOM_LOBBY_CHAT_LABEL}"`);
    const chatSlotAt = html.indexOf('data-probe="chat-slot"');
    expect(chatRegionAt).toBeGreaterThan(-1);
    expect(chatSlotAt).toBeGreaterThan(chatRegionAt);
  });

  it("keeps the chat region named with no fabricated title when the slot is untitled", () => {
    const html = render({ chat: <div data-probe="chat-slot" /> });

    // Exactly one "房间聊天" survives: the aria-label. No invented visible title.
    expect(count(html, ROOM_LOBBY_CHAT_LABEL)).toBe(1);
    expect(html).toContain(`aria-label="${ROOM_LOBBY_CHAT_LABEL}"`);
    expect(count(html, ">房间聊天</h2>")).toBe(0);
  });

  it("keeps the parent gate: disabled submit/ready mirror the blocked reasons", () => {
    const blocked = render({
      canSubmitDeck: false,
      canToggleReady: false,
      submitBlockedReason: "卡组为空",
      readyBlockedReason: "请先提交卡组"
    });

    expect(blocked).toContain("无法提交卡组：卡组为空");
    expect(blocked).toContain("无法准备：请先提交卡组");
    expect(count(blocked, "disabled")).toBeGreaterThanOrEqual(3);

    const ready = render({ canSubmitDeck: true, canToggleReady: true });
    expect(ready).not.toContain("无法提交卡组");
    expect(ready).not.toContain("无法准备");
  });

  it("only enables entering the match for playing or ended rooms", () => {
    const waiting = render({ room: { ...twoPlayers, status: "waiting" } });
    const playing = render({ room: { ...twoPlayers, status: "playing" } });
    const ended = render({ room: { ...twoPlayers, status: "ended" } });

    // Isolate the enter-game button and confirm waiting is disabled while a
    // started/ended room is enabled.
    const enterButton = (html: string): string => {
      const at = html.indexOf("进入对局");
      const open = html.lastIndexOf("<button", at);
      const close = html.indexOf("</button>", at);
      return html.slice(open, close);
    };

    expect(enterButton(waiting)).toContain("disabled");
    expect(enterButton(playing)).not.toContain("disabled");
    expect(enterButton(ended)).not.toContain("disabled");
    expect(playing).toContain("进入对局");
    expect(playing).not.toContain("对局开始后可进入");
    expect(ended).not.toContain("对局开始后可进入");
  });

  it("forwards the ready label and never fabricates state on re-render", () => {
    const html = render({ readyLabel: "取消准备" });
    expect(html).toContain("取消准备");
    expect(render({ readyLabel: "取消准备" })).toBe(html);
  });

  it("resolves supported ruleset labels and falls back to the raw id", () => {
    expect(roomRulesetLabel(FOUNDATION_RULESET_ID)).toContain("Foundation");
    expect(roomRulesetLabel(RULESET_ID)).toContain("Synthetic");
    expect(roomRulesetLabel(DUEL_RULESET_ID)).toContain("1v1");
    expect(roomRulesetLabel("unknown-ruleset")).toBe("unknown-ruleset");
  });

  it("shortens long player ids for display without dropping short ones", () => {
    expect(shortPlayerId("abc")).toBe("abc");
    const long = "0123456789abcdef";
    expect(shortPlayerId(long)).toBe("01234567…");
    expect(shortPlayerId(long).length).toBeLessThan(long.length);
  });
});
