import type { RoomDeckSubmission } from "@riftbound/protocol";

export const DECK_FIXTURE = "apps/game-server/tests/duel/fixtures/fury77-real-decks.ts";

const commonMain = ["ogn-001-298", "ogn-010-298", "ogn-013-298", "ogn-210-298",
  "ogn-215-298", "ogn-219-298", "ogn-234-298", "ogs-016-024", "sfd-006-221",
  "sfd-156-221", "ogn-209-298", "ogn-229-298"].map(cardId => ({ cardId, quantity: 3 }));
const commonZones = {
  legend: [{ cardId: "unl-187-219", quantity: 1 }],
  champion: [{ cardId: "ogn-036-298", quantity: 1 }],
  battlefields: ["ogn-275-298", "ogn-278-298", "ogn-280-298"].map(cardId => ({ cardId, quantity: 1 }))
};

export const realDecks = {
  a: {
    mainDeck: [...commonMain, { cardId: "unl-180-219", quantity: 3 }],
    runes: [{ cardId: "ogn-007-298", quantity: 6 }, { cardId: "ogn-214-298", quantity: 6 }],
    ...commonZones
  },
  b: {
    mainDeck: [...commonMain, { cardId: "unl-180-219", quantity: 1 }, { cardId: "ogn-036-298", quantity: 2 }],
    runes: [{ cardId: "ogn-007-298", quantity: 7 }, { cardId: "ogn-214-298", quantity: 5 }],
    ...commonZones
  }
} as const satisfies Readonly<Record<"a" | "b", RoomDeckSubmission>>;
