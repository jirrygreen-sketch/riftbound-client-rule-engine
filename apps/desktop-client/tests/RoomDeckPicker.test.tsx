import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  RoomDeckPicker,
  abandonPendingSubmission,
  beginDeckSubmission,
  emptySubmissionTracking,
  observeDeckSubmission,
  roomDeckPickerGate,
  type DeckPickerGate,
  type DeckPickerGateInput,
  type RoomDeckPickerProps
} from "../src/components/RoomDeckPicker";
import type { NamedDeck } from "../src/decks/library";
import { emptyDeckByZone } from "../src/hooks/useCardCatalog";
import { App } from "../src/App";

function makeInput(overrides: Partial<DeckPickerGateInput> = {}): DeckPickerGateInput {
  return {
    connected: true,
    reconnecting: false,
    roomStatus: "waiting",
    requestPending: false,
    switching: false,
    selfReady: false,
    selfDeckSubmitted: false,
    currentFingerprint: "fp-a",
    currentDeckEmpty: false,
    confirmedFingerprint: null,
    pendingFingerprint: null,
    ...overrides
  };
}

const namedDecks: readonly NamedDeck[] = [
  {
    id: "deck-1",
    name: "阿狸 rush",
    updatedAt: "2026-10-12T00:00:00.000Z",
    deck: {
      ...emptyDeckByZone(),
      mainDeck: { "flame-warden-standard": 3 },
      runes: { "basic-rune-standard": 12 }
    }
  }
];

describe("room deck gate", () => {
  it("keeps selection free before a room exists, even while disconnected", () => {
    const gate = roomDeckPickerGate(makeInput({
      roomStatus: null,
      connected: false,
      reconnecting: true
    }));
    expect(gate.canSelectDeck).toBe(true);
    expect(gate.selectBlockedReason).toBeNull();
    expect(gate.canSubmitDeck).toBe(false);
    expect(gate.submitBlockedReason).toBe("连接服务器并进入房间后即可提交卡组。");
    expect(gate.canToggleReady).toBe(false);
    expect(gate.readyBlockedReason).toBe("连接服务器并进入房间等待区后即可准备。");
  });

  it("requires a confirmed submission before ready, and never trusts selection alone", () => {
    const draft = roomDeckPickerGate(makeInput());
    expect(draft.canSubmitDeck).toBe(true);
    expect(draft.canToggleReady).toBe(false);
    expect(draft.readyBlockedReason).toBe("请先提交当前卡组。");
    expect(draft.readyLabel).toBe("准备开局");
    expect(draft.deckState).toEqual({ kind: "draft", label: "草稿 · 尚未提交" });
    expect(draft.needsResubmit).toBe(false);

    // Room says a deck is submitted, but we have no matching receipt yet.
    const unproven = roomDeckPickerGate(makeInput({ selfDeckSubmitted: true }));
    expect(unproven.canToggleReady).toBe(false);
    expect(unproven.readyBlockedReason).toBe("请先提交当前卡组。");
    expect(unproven.needsResubmit).toBe(true);
    expect(unproven.deckState.kind).toBe("stale");

    const confirmed = roomDeckPickerGate(makeInput({
      selfDeckSubmitted: true,
      confirmedFingerprint: "fp-a"
    }));
    expect(confirmed.canToggleReady).toBe(true);
    expect(confirmed.readyBlockedReason).toBeNull();
    expect(confirmed.needsResubmit).toBe(false);
    expect(confirmed.deckState).toEqual({ kind: "submitted", label: "卡组已提交" });
  });

  it("blocks ready again after the deck changed and while a submit is in flight", () => {
    const edited = roomDeckPickerGate(makeInput({
      selfDeckSubmitted: true,
      confirmedFingerprint: "fp-old",
      currentFingerprint: "fp-new"
    }));
    expect(edited.canToggleReady).toBe(false);
    expect(edited.readyBlockedReason).toBe("卡组已变更，请重新提交。");
    expect(edited.needsResubmit).toBe(true);
    expect(edited.deckState.kind).toBe("stale");

    const inFlight = roomDeckPickerGate(makeInput({
      pendingFingerprint: "fp-a"
    }));
    expect(inFlight.canToggleReady).toBe(false);
    expect(inFlight.readyBlockedReason).toBe("正在提交当前卡组，请稍候。");
    expect(inFlight.deckState).toEqual({ kind: "pending", label: "正在提交卡组…" });
  });

  it("offers cancelling ready once the server reports the seat is ready", () => {
    const ready = roomDeckPickerGate(makeInput({
      selfReady: true,
      selfDeckSubmitted: true,
      confirmedFingerprint: "fp-a"
    }));
    expect(ready.canToggleReady).toBe(true);
    expect(ready.readyLabel).toBe("取消准备");
  });

  it("disables selection while pending, switching, reconnecting in a room, or after the match", () => {
    expect(roomDeckPickerGate(makeInput({ requestPending: true }))).toMatchObject({
      canSelectDeck: false,
      selectBlockedReason: "正在等待服务器确认，请稍候。",
      canSubmitDeck: false
    });
    expect(roomDeckPickerGate(makeInput({ switching: true }))).toMatchObject({
      canSelectDeck: false,
      selectBlockedReason: "正在等待房间确认取消准备，请稍候。",
      canToggleReady: false
    });
    expect(roomDeckPickerGate(makeInput({ reconnecting: true }))).toMatchObject({
      canSelectDeck: false,
      selectBlockedReason: "连接中断，正在恢复，暂时无法切换卡组。"
    });
    expect(roomDeckPickerGate(makeInput({ connected: false, reconnecting: false }))).toMatchObject({
      canSelectDeck: false,
      selectBlockedReason: "连接中断，正在恢复，暂时无法切换卡组。"
    });
    expect(roomDeckPickerGate(makeInput({ roomStatus: "playing" }))).toMatchObject({
      canSelectDeck: false,
      selectBlockedReason: "对局进行中，无法切换卡组。",
      canSubmitDeck: false,
      submitBlockedReason: "对局已开始，无法再提交卡组。"
    });
    expect(roomDeckPickerGate(makeInput({ roomStatus: "ended" }))).toMatchObject({
      canSelectDeck: false,
      selectBlockedReason: "对局已结束，无法切换卡组。"
    });
  });

  it("refuses to submit an empty deck", () => {
    const gate = roomDeckPickerGate(makeInput({ currentDeckEmpty: true }));
    expect(gate.canSubmitDeck).toBe(false);
    expect(gate.submitBlockedReason).toBe("当前卡组为空，请先添加卡牌。");
  });
});

describe("deck submission receipts", () => {
  it("promotes a pending submit to confirmed only on a newer room revision", () => {
    const pending = beginDeckSubmission(emptySubmissionTracking, {
      fingerprint: "fp-a",
      roomVersion: 5,
      errorRevision: 0
    });
    expect(pending).toEqual({
      confirmedFingerprint: null,
      pendingFingerprint: "fp-a",
      baselineRoomVersion: 5,
      baselineErrorRevision: 0
    });

    // A cleared request flag alone must never confirm anything.
    const cleared = observeDeckSubmission(pending, {
      roomVersion: 5,
      errorRevision: 0,
      requestPending: false
    });
    expect(cleared).toBe(pending);

    const confirmed = observeDeckSubmission(pending, {
      roomVersion: 6,
      errorRevision: 0,
      requestPending: false
    });
    expect(confirmed.confirmedFingerprint).toBe("fp-a");
    expect(confirmed.pendingFingerprint).toBeNull();

    // Once there is nothing pending the tracker is a no-op.
    expect(observeDeckSubmission(confirmed, {
      roomVersion: 9,
      errorRevision: 4,
      requestPending: false
    })).toBe(confirmed);
  });

  it("drops a pending submit on error but keeps the last confirmed deck", () => {
    const confirmed = {
      confirmedFingerprint: "fp-old",
      pendingFingerprint: "fp-new",
      baselineRoomVersion: 2,
      baselineErrorRevision: 1
    };
    const afterError = observeDeckSubmission(confirmed, {
      roomVersion: 3,
      errorRevision: 2,
      requestPending: false
    });
    expect(afterError).toEqual({
      confirmedFingerprint: "fp-old",
      pendingFingerprint: null,
      baselineRoomVersion: 2,
      baselineErrorRevision: 1
    });
  });

  it("abandons an in-flight submit when the connection is no longer live", () => {
    const pending = beginDeckSubmission(
      { ...emptySubmissionTracking, confirmedFingerprint: "fp-old" },
      { fingerprint: "fp-new", roomVersion: 4, errorRevision: 0 }
    );
    const abandoned = abandonPendingSubmission(pending);
    expect(abandoned).toEqual({
      confirmedFingerprint: "fp-old",
      pendingFingerprint: null,
      baselineRoomVersion: 4,
      baselineErrorRevision: 0
    });
    // Nothing pending: identity is preserved so React can skip the update.
    expect(abandonPendingSubmission(abandoned)).toBe(abandoned);
    // A revision observed afterwards can no longer vouch for the dropped submit.
    expect(observeDeckSubmission(abandoned, {
      roomVersion: 9,
      errorRevision: 0,
      requestPending: false
    })).toBe(abandoned);
  });
});

describe("app shell entries", () => {
  it("starts on a home page with separate product menu entries", () => {
    const markup = renderToStaticMarkup(<App />);
    for (const label of ["卡组管理", "房间连接", "对局回放", "个人信息管理", "退出", "设置"])
      expect(markup).toContain(label);
    // The home page does not mount the deck editor or joined-room content.
    expect(markup).not.toContain("选择卡组");
  });
});

describe("RoomDeckPicker server-side rendering", () => {
  it("renders the current deck card, selector, and edit entry point", () => {
    const gate = roomDeckPickerGate(makeInput());
    const markup = renderToStaticMarkup(
      <RoomDeckPicker
        {...makeProps({ gate })}
      />
    );

    expect(markup).toContain("当前卡组");
    expect(markup).toContain("选择卡组");
    expect(markup).toContain("当前草稿（未命名）");
    expect(markup).toContain("阿狸 rush");
    expect(markup).toContain("去编辑卡组");
    expect(markup).toContain("保存为命名卡组");
    expect(markup).toContain("草稿 · 尚未提交");
    expect(markup).not.toMatch(/<select[^>]*disabled/);
    // The "update selected" action needs an existing selection.
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?更新所选卡组/);
  });

  it("renders the resubmit warning and blocks selection when the room forbids it", () => {
    const gate = roomDeckPickerGate(makeInput({
      selfDeckSubmitted: true,
      confirmedFingerprint: "fp-old",
      currentFingerprint: "fp-new"
    }));
    const markup = renderToStaticMarkup(
      <RoomDeckPicker {...makeProps({ gate })} />
    );
    expect(markup).toContain("卡组已变更，请重新提交");
    expect(markup).toContain("创建或加入房间都会使用这副卡组");
  });

  it("renders a disabled selector when the room is playing", () => {
    const gate = roomDeckPickerGate(makeInput({ roomStatus: "playing" }));
    const markup = renderToStaticMarkup(
      <RoomDeckPicker {...makeProps({ gate })} />
    );
    expect(markup).toMatch(/<select[^>]*disabled/);
    expect(markup).toContain("对局进行中，无法切换卡组。");
  });
});

function makeProps(overrides: Partial<RoomDeckPickerProps> = {}): RoomDeckPickerProps {
  const gate: DeckPickerGate = overrides.gate ?? roomDeckPickerGate(makeInput());
  return {
    namedDecks,
    selectedDeckId: null,
    currentDeckName: "当前草稿",
    currentDeckTotal: 15,
    currentZones: [
      { zone: "mainDeck", label: "主卡组", count: 3 },
      { zone: "runes", label: "符文", count: 12 }
    ],
    draftName: "当前草稿",
    onDraftNameChange: () => undefined,
    onSelectDeck: () => undefined,
    onSaveAsNamed: () => undefined,
    onUpdateSelected: () => undefined,
    onDeleteSelected: () => undefined,
    onEditDeck: () => undefined,
    notice: null,
    ...overrides,
    deckState: overrides.deckState ?? gate.deckState,
    gate
  };
}
