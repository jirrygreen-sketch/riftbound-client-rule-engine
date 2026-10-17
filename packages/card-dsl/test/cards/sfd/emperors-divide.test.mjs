import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/emperors-divide.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-ecb9b44b724f5cf8fc83e9f49da0b24bed461053303201914a0ce0ef8db8ed45";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Move any number of friendly units at a battlefield to their base.";

const [hidden, action, play] = program.abilities;
const [move] = play.body;
const targetSpec = move.targets[0];

/**
 * The reference kernel compares filter values literally, while the production
 * chain query (chain/engine.ts) normalizes controller/owner "self"/"opponent"
 * and the layer matcher (layers/filter.ts) understands a location-type string.
 * Reproduce those two paths so the card's own query shape is what executes.
 */
function productionQuery(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          if (typeof normalized.location === "string") delete kernelFilter.location;
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller))
            .filter((object) => normalized.location === undefined || typeof normalized.location !== "string" ||
              (object.location !== null && object.location.type === normalized.location));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-043-221 Emperor's Divide: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-043-221 Emperor's Divide: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-043-221 Emperor's Divide: judgeReason names cost.hidden and the 811.1.d.2 restriction", () => {
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /811\.1\.d\.2/);
  assert.match(program.judgeReason, /811\.1\.b/);
  assert.match(program.judgeReason, /355\.10\.b/);
});

test("sfd-043-221 Emperor's Divide: [Hidden] and [Action] keywords plus the printed cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  // Catalog printed cost: 2 energy, no printed Power (null is never 0).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
});

test("sfd-043-221 Emperor's Divide: any-number friendly units at a battlefield move to their base", () => {
  assert.equal(play.body.length, 1);
  assert.equal(move.id, "emperors-divide.move-units");
  assert.equal(move.op, "effect.move");
  assert.equal(move.linkedTo, undefined);
  assert.deepEqual(move.args.objects, {
    kind: "constant",
    value: { target: "emperors-divide.units" }
  });
  // 107.1.c: each unit's Base is its controller's Base.
  assert.deepEqual(move.args.to, { kind: "constant", value: "controller-base" });
  // "any number" ceiling = the number of units locked at Finalize.
  assert.deepEqual(move.args.amount, {
    kind: "count",
    subject: "units",
    filter: { object: { target: "emperors-divide.units" } }
  });

  // 355.12: every chosen unit is a target chosen independently of the Move;
  // 355.13: "any number" includes zero, so min 0 with selection "up-to".
  assert.equal(targetSpec.id, "emperors-divide.units");
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    controller: "self",
    location: "battlefield"
  });
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.max, null);
  assert.equal(targetSpec.selection, "up-to");
});

test("sfd-043-221 Emperor's Divide golden: the chosen units leave the battlefield for their base", () => {
  const kernel = world()
    .unit("one", { owner: "A", controller: "A", exhausted: true, damage: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("two", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("home", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("emperors-divide.units", [kernel.ref("one"), kernel.ref("two")]);

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["emperors-divide.move-units", "executed"]]
  );
  assert.equal(outcome.results[0].result.linkedValues.moved.count, 2);
  assert.deepEqual(kernel.getObject("one").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("two").location, { type: "base", player: "A" });
  // A unit already in Base is not chosen (355.4.a); the enemy unit is untouched.
  assert.deepEqual(kernel.getObject("home").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  // An effect Move is not the Standard Move and not a Recall (457-460):
  // statuses and marked damage stay as they are.
  assert.equal(kernel.getObject("one").exhausted, true);
  assert.equal(kernel.getObject("one").damage, 2);
});

test("sfd-043-221 Emperor's Divide golden: only the still-legal member of a mistargeted group moves (359.3.e.8)", () => {
  const kernel = world()
    .unit("staying", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("leaving", { owner: "A", controller: "A" })
    .build();
  const stale = kernel.ref("leaving");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets("emperors-divide.units", [kernel.ref("staying"), stale]);

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  // One member of the group left the board, so the resolution is partial
  // (359.3.e.8) while the remaining legal unit still moves.
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.moved.objects.map((ref) => ref.id), ["staying"]);
  assert.deepEqual(kernel.getObject("staying").location, { type: "base", player: "A" });
});

test("sfd-043-221 Emperor's Divide golden: choosing zero units is a legal play that moves nothing (355.13)", () => {
  const kernel = world()
    .unit("one", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("emperors-divide.units", []);

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.getObject("one").location, { type: "battlefield", id: "bf-1" });
});

test.todo(
  "sfd-043-221 Emperor's Divide: [Hidden] needs the cost.hidden consumer — the Hide Discretionary Action, the " +
    "facedown zone and the free facedown play (CR 811.1.b / 811.1.c); no merged primitive consumes cost.hidden " +
    "even though the keyword expansion in effects/keywords/Hidden.ts is merged."
);

test.todo(
  "sfd-043-221 Emperor's Divide: 811.1.d.2 restricts a facedown-played spell's targets to the battlefield it was " +
    "hidden at; no TargetSpec field carries that origin binding, so it is not expressible with the current filter."
);
