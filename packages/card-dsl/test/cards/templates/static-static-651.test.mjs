// RIFT-651: static+static|| template rows for the five cards in this batch.
//
// These programs remain judge-required for real, documented engine gaps. The
// generic scenario runner deliberately refuses such programs, so each row is a
// promotion-ready TODO rather than a false execution claim. The row still
// carries the card's own boundary setup and expected state; when its missing
// dependency lands, changing the row from TODO to a normal test supplies the
// execution evidence without changing the card IR.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import brazenBuccaneer from "../../../dist/cards/ogn/brazen-buccaneer.js";
import mageseekerWarden from "../../../dist/cards/ogn/mageseeker-warden.js";
import missFortuneBuccaneer from "../../../dist/cards/ogn/miss-fortune-buccaneer.js";
import ragingSoul from "../../../dist/cards/ogn/raging-soul.js";
import wilyNewtfish from "../../../dist/cards/unl/wily-newtfish.js";

const rows = defineTemplateSuite("RIFT-651 static+static||", [
  {
    name: "Brazen Buccaneer declines the optional discard at the boundary",
    canonicalCardId: brazenBuccaneer.canonicalCardId,
    program: brazenBuccaneer,
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        { id: "buccaneer", cardId: brazenBuccaneer.canonicalCardId, owner: "A", types: ["unit"], zone: "hand", energy: 6, might: 5 },
        { id: "fodder", owner: "A", types: ["unit"], zone: "hand" },
      ],
      expect: {
        objects: { buccaneer: { zone: "hand" }, fodder: { zone: "hand" } },
        players: { A: { energy: 20 } },
      },
    },
  },
  {
    name: "Mageseeker Warden is inactive away from a battlefield",
    canonicalCardId: mageseekerWarden.canonicalCardId,
    program: mageseekerWarden,
    scenario: {
      objects: [
        { id: "warden", cardId: mageseekerWarden.canonicalCardId, owner: "A", types: ["unit"], zone: "board", location: { type: "base", player: "A" }, might: 5 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "hand", energy: 2, might: 2 },
      ],
      expect: { objects: { warden: { location: { type: "base", player: "A" } }, enemy: { zone: "hand" } } },
    },
  },
  {
    name: "Miss Fortune has no open battlefield permission to consume",
    canonicalCardId: missFortuneBuccaneer.canonicalCardId,
    program: missFortuneBuccaneer,
    scenario: {
      objects: [
        { id: "buccaneer", cardId: missFortuneBuccaneer.canonicalCardId, owner: "A", types: ["unit"], zone: "hand", energy: 4, might: 4 },
        { id: "occupied", owner: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3 },
      ],
      expect: { objects: { buccaneer: { zone: "hand" }, occupied: { location: { type: "battlefield", id: "bf-1" } } } },
    },
  },
  {
    name: "Raging Soul stays ungranted when no card was discarded",
    canonicalCardId: ragingSoul.canonicalCardId,
    program: ragingSoul,
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "soul", cardId: ragingSoul.canonicalCardId, owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 4 },
      ],
      expect: { objects: { soul: { might: 4, keywords: [] } } },
    },
  },
  {
    name: "Wily Newtfish stays unmodified when no XP was gained",
    canonicalCardId: wilyNewtfish.canonicalCardId,
    program: wilyNewtfish,
    scenario: {
      players: { A: { xp: 0 } },
      objects: [
        { id: "newtfish", cardId: wilyNewtfish.canonicalCardId, owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 4 },
      ],
      expect: { objects: { newtfish: { might: 4, keywords: [] } } },
    },
  },
]);

const programsById = new Map([
  [brazenBuccaneer.canonicalCardId, brazenBuccaneer],
  [mageseekerWarden.canonicalCardId, mageseekerWarden],
  [missFortuneBuccaneer.canonicalCardId, missFortuneBuccaneer],
  [ragingSoul.canonicalCardId, ragingSoul],
  [wilyNewtfish.canonicalCardId, wilyNewtfish],
]);

test("RIFT-651: one independent template row per canonical card", () => {
  assert.deepEqual(rows.map(row => row.canonicalCardId), [
    brazenBuccaneer.canonicalCardId,
    mageseekerWarden.canonicalCardId,
    missFortuneBuccaneer.canonicalCardId,
    ragingSoul.canonicalCardId,
    wilyNewtfish.canonicalCardId,
  ]);
  assert.ok([
    brazenBuccaneer,
    mageseekerWarden,
    missFortuneBuccaneer,
    ragingSoul,
    wilyNewtfish,
  ].every(program => program.status === "judge-required"));
});

for (const row of rows) {
  test(row.name, {
    todo: `blocked by the card's documented judge-required dependency; execute via runCardScenario when it lands`,
  }, () => {
    // Keep the row independently registered without invoking the runner
    // against a judge-required program. Once the card is promoted, this calls
    // the same row.run generated by defineTemplateSuite.
    const program = programsById.get(row.canonicalCardId);
    assert.equal(program?.status, "judge-required");
    if (program?.status === "executable") return row.run();
  });
}
