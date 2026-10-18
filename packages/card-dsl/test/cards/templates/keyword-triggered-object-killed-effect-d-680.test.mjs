// RIFT-680 template: keyword+triggered | object-killed | effect.draw
//
// Four judge-required cards share the same IR shape: an explicit triggered
// ability on the object-killed timing point whose body is a single Draw 1
// (effect.draw). This suite runs that shared shape through the generic card
// execution harness (engine-core/dist/effects/testing/scenario).
//
// Execution evidence location: this file is the layer-3 "real execution"
// golden for all four cards. The per-card test files keep the validation,
// identity and structure checks and point here.
//
// Every row slices the published program to its explicit triggered ability
// and flips status metadata ONLY. This metadata change is the documented
// harness input contract (README 4.1 / RIFT-663): a judge-required program
// cannot be submitted to the harness. A passing scenario is NOT evidence for
// promoting the card; Deathknell expansion (trigger.leave), trigger lifecycle
// delivery, the controller placeholder, and the sameLocationAs anchors named
// in each judgeReason remain unimplemented. Rows assert the current behavior
// only as gap evidence, never as printed semantics.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import watchfulSentry from "../../../dist/cards/ogn/watchful-sentry.js";
import stormRaptor from "../../../dist/cards/rad/storm-raptor.js";
import lonelyPoro from "../../../dist/cards/sfd/lonely-poro.js";
import loyalPoro from "../../../dist/cards/unl/loyal-poro.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const BF1 = { type: "battlefield", id: "bf-1" };
const KILL_SOURCE = { type: "trigger", timingPoint: "object-killed", player: "A" };
const PASSES = [{ type: "pass", player: "A" }, { type: "pass", player: "B" }];

const unit = (id, cardId, owner, extra = {}) => ({
  id,
  cardId,
  owner,
  types: ["unit"],
  zone: "board",
  location: BF1,
  might: 2,
  energy: 2,
  power: [],
  ...extra
});

function triggeredOnly(program, index = 1) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason);
  assert.equal(program.abilities[index]?.kind, "triggered");
  assert.equal(program.abilities[index].trigger.at, "object-killed");
  const { judgeReason, ...identity } = program;
  return { ...identity, status: "executable", abilities: [program.abilities[index]] };
}

const rows = [
  {
    name: "Watchful Sentry: Deathknell Draw 1 body draws through the trigger pipeline",
    canonicalCardId: watchfulSentry.canonicalCardId,
    program: triggeredOnly(watchfulSentry),
    scenario: {
      objects: [
        unit("src", watchfulSentry.canonicalCardId, "A", { might: 2 }),
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
        { id: "next", owner: "A", types: ["unit"], zone: "deck" }
      ],
      operations: [{ ...KILL_SOURCE, object: "src" }, ...PASSES],
      expect: {
        objects: {
          src: { zone: "board", location: BF1 },
          top: { zone: "hand" },
          next: { zone: "deck" }
        },
        players: { A: { handSize: 1, deckSize: 1 } },
        events: { sequence: [{ timingPoint: "object-killed", object: { ref: "src" } }, { timingPoint: "card-drawn" }, { timingPoint: "chain-item-resolve" }] }
      }
    }
  },
  {
    name: "Lonely Poro gap evidence: un-normalized controller placeholder collapses the alone count to 0, so the trigger fires even beside a friend",
    canonicalCardId: lonelyPoro.canonicalCardId,
    program: triggeredOnly(lonelyPoro),
    scenario: {
      objects: [
        unit("src", lonelyPoro.canonicalCardId, "A"),
        unit("friend", watchfulSentry.canonicalCardId, "A"),
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
        { id: "next", owner: "A", types: ["unit"], zone: "deck" }
      ],
      operations: [{ ...KILL_SOURCE, object: "src" }, ...PASSES],
      expect: {
        objects: { src: { zone: "board", location: BF1 }, friend: { zone: "board", location: BF1 } },
        players: { A: { handSize: 1, deckSize: 1 } }
      }
    }
  },
  {
    name: "Loyal Poro boundary: the same placeholder makes 'didn't die alone' false even beside a friend, so no draw happens",
    canonicalCardId: loyalPoro.canonicalCardId,
    program: triggeredOnly(loyalPoro),
    scenario: {
      objects: [
        unit("src", loyalPoro.canonicalCardId, "A", { might: 3 }),
        unit("friend", watchfulSentry.canonicalCardId, "A", { might: 2 }),
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
        { id: "next", owner: "A", types: ["unit"], zone: "deck" }
      ],
      operations: [{ ...KILL_SOURCE, object: "src" }],
      expect: {
        objects: { src: { zone: "board", location: BF1 }, friend: { zone: "board", location: BF1 } },
        players: { A: { handSize: 0, deckSize: 2 } },
        events: { exact: [{ timingPoint: "object-killed", object: { ref: "src" } }, { timingPoint: "cleanup-start" }, { timingPoint: "cleanup-end" }] }
      }
    }
  },
  {
    name: "Storm Raptor gap evidence: the sameLocationAs anchor is rejected at trigger binding, so a killed stunned enemy draws nothing",
    canonicalCardId: stormRaptor.canonicalCardId,
    program: triggeredOnly(stormRaptor),
    scenario: {
      objects: [
        unit("src", stormRaptor.canonicalCardId, "A", { might: 6 }),
        unit("enemy", watchfulSentry.canonicalCardId, "B", { might: 3, stunned: true }),
        { id: "top", owner: "A", types: ["unit"], zone: "deck" }
      ],
      // The binder throws during registration setup, so no chain item ever
      // forms and there is no priority to pass - the kill alone must end quietly.
      operations: [{ ...KILL_SOURCE, object: "enemy" }],
      expect: {
        objects: { src: { zone: "board", location: BF1 }, enemy: { zone: "board", location: BF1 } },
        players: { A: { handSize: 0, deckSize: 1 } }
      }
    }
  },
  {
    name: "Watchful Sentry boundary: an empty deck draws as much as possible - nothing (CR 414.4)",
    canonicalCardId: watchfulSentry.canonicalCardId,
    program: triggeredOnly(watchfulSentry),
    scenario: {
      objects: [unit("src", watchfulSentry.canonicalCardId, "A", { might: 2 })],
      operations: [{ ...KILL_SOURCE, object: "src" }, ...PASSES],
      expect: {
        objects: { src: { zone: "board", location: BF1 } },
        players: { A: { handSize: 0, deckSize: 0 } },
        events: { sequence: [{ timingPoint: "object-killed", object: { ref: "src" } }, { timingPoint: "chain-item-pending" }, { timingPoint: "chain-item-finalize" }, { timingPoint: "chain-item-resolve" }] }
      }
    }
  }
];

for (const entry of defineTemplateSuite("RIFT-680 keyword+triggered | object-killed | effect.draw", rows)) {
  test(entry.name, () => {
    const result = entry.run();
    if (entry.name.includes("empty deck")) {
      assert.equal(result.events.some(event => event.timingPoint === "card-drawn"), false, "an empty deck draws nothing");
    }
  });
}

// The published programs themselves stay judge-required; the harness only ever
// saw the sliced, metadata-flipped views above.
const published = [
  ["Watchful Sentry", watchfulSentry],
  ["Storm Raptor", stormRaptor],
  ["Lonely Poro", lonelyPoro],
  ["Loyal Poro", loyalPoro]
];
test("RIFT-680 published programs: all four stay judge-required with a named gap", () => {
  for (const [name, program] of published) {
    assert.equal(program.status, "judge-required", name);
    assert.ok(program.judgeReason, `${name} must keep its judgeReason`);

    const [keyword, triggered] = program.abilities;
    assert.equal(keyword.kind, "keyword");
    assert.equal(triggered.kind, "triggered");
    assert.equal(triggered.trigger.at, "object-killed");
    assert.equal(triggered.body.length, 1);
    assert.equal(triggered.body[0].op, "effect.draw");
  }
});

test("RIFT-680 Storm Raptor: the production trigger binder still rejects the 'here' anchor", () => {
  const kernel = world().player("A").player("B")
    .unit("raptor", { controller: "A", owner: "A", zone: "board", might: 6, location: BF1 })
    .build();
  const snapshot = { ...kernel.getObject("raptor"), cardId: stormRaptor.canonicalCardId };
  assert.throws(
    () => triggerRegistrations(new Map([[stormRaptor.canonicalCardId, stormRaptor]]), snapshot),
    /Unsupported filter field sameLocationAs/
  );
});

test("RIFT-680 Deathknell expansion body still references the unregistered trigger.leave op (808.1.d)", () => {
  assert.equal(instructionDefinitionsById.has("trigger.leave"), false);
  const definition = keywordDefinitionsById.get("Deathknell");
  const [expansion] = definition.expand({ host: { canonicalCardId: loyalPoro.canonicalCardId } });
  const kernel = world().unit("poro", { owner: "A", controller: "A" }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("poro"), controller: "A" });
  assert.throws(
    () => resolveChainBody(expansion.body, scoped),
    /Unregistered instruction opcode: trigger\.leave/
  );
});
