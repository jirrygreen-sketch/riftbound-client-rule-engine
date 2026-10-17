import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/angler-beast.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-9b3883fe3c4d9bfa96f4dcf2d8d03f9c48fe8987802cd8e669ef1c5802bf3fc6";
const SOURCE_TEXT =
  "When you play me, return all units with 2 :rb_might: or less to their owners' hands.";

const [ability] = program.abilities;
const [returnWeak] = ability.body;
const targetSpec = returnWeak.targets[0];

function board() {
  const kernel = world()
    .player("B")
    .unit("angler-beast", { might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("weak-ally", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("weak-enemy", {
      owner: "B",
      controller: "B",
      might: 1,
      location: { type: "battlefield", id: "bf-2" }
    })
    .unit("strong-ally", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  return kernel.clone({ source: kernel.ref("angler-beast"), sourceSnapshot: kernel.getObject("angler-beast") });
}

test("unl-132-219 Angler Beast: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-132-219 Angler Beast: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /143\.2\.a/);
});

test("unl-132-219 Angler Beast: card-played self trigger returning the whole weak-unit set", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);

  assert.equal(returnWeak.id, "angler-beast.return-weak-units");
  assert.equal(returnWeak.op, "effect.zone");
  assert.deepEqual(returnWeak.args.to, { kind: "constant", value: "hand" });
  assert.equal(returnWeak.linkedTo, undefined);
  assert.equal(returnWeak.picks, undefined);

  // "all units with 2 [M] or less": a programmatic set, so selection all with min 0 (355.10.d).
  assert.deepEqual(targetSpec, {
    id: "angler-beast.weak-units",
    filter: { type: "unit", zone: "board", mightLte: 2 },
    min: 0,
    selection: "all"
  });
});

test("unl-132-219 Angler Beast golden: the locked weak units go to their owners' hands", () => {
  const kernel = board();
  kernel.setTargets("angler-beast.weak-units", [kernel.ref("weak-ally"), kernel.ref("weak-enemy")]);
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["angler-beast.return-weak-units", "executed"]
  ]);
  // CR 108/124: leaving the Board for a hand creates a new object identity; each card routes to
  // its OWNER's hand (the enemy token belongs to B).
  assert.equal(kernel.getObject("weak-ally").zone, "hand");
  assert.equal(kernel.getObject("weak-ally").owner, "A");
  assert.equal(kernel.getObject("weak-enemy").zone, "hand");
  assert.equal(kernel.getObject("weak-enemy").owner, "B");
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["weak-enemy"]);
  // The Might-3 unit stays where it is: only the locked weak set moves.
  assert.equal(kernel.getObject("strong-ally").zone, "board");
  assert.equal(kernel.getObject("angler-beast").zone, "board");
  assert.deepEqual(outcome.events.map(event => event.action), ["return-to-hand", "return-to-hand"]);
});

test("unl-132-219 Angler Beast golden: an empty locked set returns nothing and does not throw", () => {
  const kernel = board();
  kernel.setTargets("angler-beast.weak-units", []);
  const outcome = resolveChainBody(ability.body, kernel);
  // 359.3.e: with no legal object left the instruction is ignored, not turned into a no-op success.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("weak-ally").zone, "board");
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "unl-132-219 Angler Beast: enforce the '2 :rb_might: or less' ceiling at Finalize/Resolve (355.9.b / 143.2.a " +
    "effective-Might predicate) once the Might threshold relation is merged — the merged " +
    "filters ignore the descriptive mightLte key"
);
