import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession, type RoomDeckSubmission } from "@riftbound/protocol";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import rumbleHotheaded from "../../../../packages/card-dsl/dist/cards/sfd/rumble-hotheaded.js";
import type { ProgramBinding } from "../../../../packages/engine-core/dist/programs/index.js";
import type { EngineRuntime, EngineRuntimeOptions } from "../../src/engine-runtime/index.js";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime } from "../../src/engine-runtime/index.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";

const RUMBLE = rumbleHotheaded.canonicalCardId;
const BREAKNECK = "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab";
const PIT_CREW = "card.hash-c14f8fe7647e76e1a5b3db9a1eef0a30ba2a0cdc929fe013536ce268b02c81d8";
const GET_EXCITED = "card.hash-79956e42a3d826b547522f15e3706e341605f6f98ef9d9aad5caf3d03248a826";
const BUBBLE_BOT = "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389";
const MECHANIZED_MENACE = "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7";
const FORECASTER = "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40";
const GEM_JAMMER = "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9";
const FERROUS_FORERUNNER = "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3";
const PLUNDERING_PORO = "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82";
const DANGEROUS_DUO = "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91";
const FRIGID_TOUCH = "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9";
const STUPEFY = "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf";
const VOID_SEEKER = "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10";
const HEXTECH_RAY = "card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d";
const MINE_FIELD = "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4";
const RAVENBLOOM = "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82";
const TREASURE_HOARD = "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564";
const MIND_RUNE = "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b";
const FURY_RUNE = "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902";
const ROOM_ID = "printed-catalog-regression:132";

const catalogDocument = JSON.parse(readFileSync(
  new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url),
  "utf8",
)) as { readonly cards: readonly { readonly id: string; readonly canonicalCardId: string }[] };

const originalRumble = cardProgramsById.get(RUMBLE);

/**
 * RIFT-977's reviewed Rumble body is not on this integration checkpoint yet.
 * Install its exact printed-base cost-modification shape while admitting the
 * otherwise judge-required card as the ticket permits. The server remains the
 * only source of the printed catalog supplied to ProgramBinding.
 */
const admittedRumble = (() => {
  const program = structuredClone(rumbleHotheaded) as any;
  const optional = program.abilities
    .find((ability: any) => ability.kind === "triggered" && ability.trigger?.at === "conquer")
    ?.body.find((instruction: any) => instruction.op === "choice.optional");
  const nested = optional?.args?.body?.value;
  const pay = nested?.find((instruction: any) => instruction.id === "rumble.recycle-cost");
  const play = nested?.find((instruction: any) => instruction.id === "rumble.play-mech");
  if (!pay || !play) throw new Error("Rumble regression fixture no longer has its reviewed leading cost");
  const printedBase = {
    ...play,
    linkedTo: pay.id,
    args: {
      ...play.args,
      cost: {
        kind: "constant",
        value: {
          kind: "cost.modify",
          id: "rumble.mech-cost",
          base: "printed",
          cost: {
            kind: "explicit",
            energy: {
              kind: "object-property",
              object: { target: "rumble.mech-in-trash" },
              property: "energy",
            },
          },
          modifier: {
            kind: "reduce",
            resource: "energy",
            amount: {
              kind: "object-property",
              object: { linked: "rumble.recycle-cost" },
              property: "might",
            },
          },
        },
      },
    },
  };
  optional.args.body = { kind: "constant", value: [pay, printedBase] };
  return { ...program, status: "executable", judgeReason: undefined } as CardProgram;
})();

function printing(canonicalCardId: string): string {
  const row = catalogDocument.cards.find(card => card.canonicalCardId === canonicalCardId);
  if (row === undefined) throw new Error(`Missing catalog printing for ${canonicalCardId}`);
  return row.id;
}

function entry(canonicalCardId: string, quantity: number) {
  return { cardId: printing(canonicalCardId), quantity };
}

function deck(): RoomDeckSubmission {
  const mainDeck = [
    entry(RUMBLE, 2), entry(BREAKNECK, 3), entry(GET_EXCITED, 3), entry(PIT_CREW, 3),
    entry(BUBBLE_BOT, 3), entry(FORECASTER, 3), entry(GEM_JAMMER, 3), entry(FERROUS_FORERUNNER, 2),
    entry(PLUNDERING_PORO, 3), entry(DANGEROUS_DUO, 3), entry(FRIGID_TOUCH, 3), entry(STUPEFY, 3),
    entry(VOID_SEEKER, 3), entry(HEXTECH_RAY, 2),
  ];
  if (mainDeck.reduce((sum, value) => sum + value.quantity, 0) !== 39) {
    throw new Error("printed-catalog fixture main deck must contain 39 cards");
  }
  return {
    mainDeck,
    runes: [entry(MIND_RUNE, 6), entry(FURY_RUNE, 6)],
    legend: [entry(MECHANIZED_MENACE, 1)], champion: [entry(RUMBLE, 1)],
    battlefields: [entry(MINE_FIELD, 1), entry(RAVENBLOOM, 1), entry(TREASURE_HOARD, 1)],
  };
}

interface Booted {
  readonly room: GameRoom;
  readonly runtime: EngineRuntime;
  readonly binding: ProgramBinding;
  readonly runtimeOptions: EngineRuntimeOptions;
  readonly sessions: readonly [ClientSession, ClientSession];
  readonly connections: readonly [ReturnType<GameRoom["join"]>, ReturnType<GameRoom["join"]>];
}

async function bootRoom(): Promise<Booted> {
  const catalog = await loadCardCatalogRuntime();
  return bootRoomFromCatalog(catalog);
}

async function bootRoomFromCatalog(catalog: Awaited<ReturnType<typeof loadCardCatalogRuntime>>): Promise<Booted> {
  const room = new GameRoom(ROOM_ID, DUEL_RULESET_ID, catalog, () => 0);
  const first = room.join("Alice", () => undefined, "printed-catalog-a");
  const second = room.join("Bob", () => undefined, "printed-catalog-b");
  const sessions = [first, second].map(connection => ({
    roomId: room.roomId, playerId: connection.playerId, resumeToken: connection.resumeToken,
  })) as [ClientSession, ClientSession];
  for (const [index, connection] of [first, second].entries()) {
    room.submitDeck(sessions[index]!, connection.connectionId, room.currentRoomVersion, deck(),
      `printed-catalog-deck-${index}`, () => undefined);
    room.setReady(sessions[index]!, connection.connectionId, room.currentRoomVersion, true,
      `printed-catalog-ready-${index}`, () => undefined);
  }
  let setup: V2Projection | undefined;
  room.sendProjection(first.playerId, message => {
    setup = (message as { projection?: V2Projection }).projection;
  });
  if (!setup || setup.pendingChoice.status !== "pending") throw new Error("Mulligan window required");
  const order = setup.pendingChoice.ownerPlayerId === first.playerId ? [
    [first, sessions[0]], [second, sessions[1]],
  ] as const : [
    [second, sessions[1]], [first, sessions[0]],
  ] as const;
  for (const [index, [connection, session]] of order.entries()) {
    room.submitEngineV2(session, connection.connectionId, {
      type: "mulligan", commandId: `printed-catalog-mulligan-${index}`, stateVersion: 0,
      selectedObjectIds: [],
    }, () => undefined);
  }
  const privateRuntime = (room as unknown as {
    readonly engineRuntime: EngineRuntime & { readonly binding: ProgramBinding; readonly runtimeOptions: EngineRuntimeOptions };
  }).engineRuntime;
  return {
    room, runtime: privateRuntime, binding: privateRuntime.binding, runtimeOptions: privateRuntime.runtimeOptions,
    sessions, connections: [first, second],
  };
}

afterEach(() => {
  if (originalRumble === undefined) cardProgramsById.delete(RUMBLE);
  else cardProgramsById.set(RUMBLE, originalRumble);
});

describe("RIFT-993 server ProgramBinding printed catalog", () => {
  it("feeds the loaded room catalog into the default MatchRuntime binding", async () => {
    cardProgramsById.set(RUMBLE, admittedRumble);
    const booted = await bootRoom();
    expect(booted.binding.printedCatalog(BREAKNECK)).toEqual({
      id: "sfd-071-221", cardType: "Unit", domains: ["Mind"], energy: 8, power: 2,
    });
    expect(booted.binding.printedCatalog("card.hash-missing-printed-catalog")).toBeUndefined();
    expect(booted.runtimeOptions.printedCatalog).toContainEqual(expect.objectContaining({
      canonicalCardId: BREAKNECK, id: "sfd-071-221", energy: 8, power: 2, domains: ["Mind"],
    }));
    expect(booted.runtime.projectFor("A").phase).toBe("main");
    expect(booted.runtimeOptions.printedCatalog?.find(card => card.canonicalCardId === MIND_RUNE))
      .toMatchObject({ energy: null, power: null });
  }, 420_000);

  it("leaves a conflicting canonical cost fail-closed in the default server assembly", async () => {
    cardProgramsById.set(RUMBLE, admittedRumble);
    const catalog = await loadCardCatalogRuntime();
    const breakneck = catalog.publicCatalog.cards.find(card =>
      card.canonicalCardId === BREAKNECK && card.id === "sfd-071-221");
    expect(breakneck).toBeDefined();
    const conflicting = {
      ...catalog,
      publicCatalog: {
        ...catalog.publicCatalog,
        cards: [
          ...catalog.publicCatalog.cards,
          { ...breakneck!, id: "sfd-071-conflict", cardNumber: "SFD-071c/221", variant: "alternate" as const, power: 3 },
        ],
      },
    };
    const booted = await bootRoomFromCatalog(conflicting);
    expect(booted.binding.printedCatalog(BREAKNECK)).toBeUndefined();
  }, 420_000);

  it("binds the server-projected printed catalog in default MatchRuntime without a room-sized deck", async () => {
    cardProgramsById.set(RUMBLE, admittedRumble);
    const booted = await bootRoom();
    const card = booted.runtimeOptions.decks[0].mainDeck.find(entry => entry.cardId === BREAKNECK);
    if (card === undefined) throw new Error("Breakneck must remain in the server runtime deck");
    const runtime = createEngineRuntime({
      ...booted.runtimeOptions,
      decks: [
        { ...booted.runtimeOptions.decks[0], mainDeck: [card, ...booted.runtimeOptions.decks[0].mainDeck.slice(0, 5)] },
        { ...booted.runtimeOptions.decks[1], mainDeck: booted.runtimeOptions.decks[1].mainDeck.slice(0, 6) },
      ],
      seed: "printed-catalog-binding",
      firstPlayer: "A",
      battlefieldChoice: [0, 0],
      mulligans: [[], []],
    }).start();
    const binding = (runtime as unknown as { readonly binding: ProgramBinding }).binding;
    expect(binding.printedCatalog(BREAKNECK)).toEqual({
      id: "sfd-071-221", cardType: "Unit", domains: ["Mind"], energy: 8, power: 2,
    });
  }, 420_000);

});
