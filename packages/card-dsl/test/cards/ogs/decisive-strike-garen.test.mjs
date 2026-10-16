import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/decisive-strike-garen.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID = "card.hash-8ede68abdc12ce7e49e3fb3df89263c308b4405bac8deb070fc67b27cf1b3a30";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\nGive friendly units +2 :rb_might: this turn.";

const [speed, play] = program.abilities;
const [mighty] = play.body;

test("ogs-024-024 Decisive Strike, Garen: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing primitive and the dependent task.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /702/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-024-024 Decisive Strike, Garen: [Action] keyword plus the printed 5 energy + 1 Order power cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 1 }
  });
});

test("ogs-024-024 Decisive Strike, Garen: the +2 Might body is the unmerged continuous effect", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mighty.id, "decisive-strike-garen.grant-plus-2-might");
  assert.equal(mighty.op, "continuous.might");
  assert.deepEqual(mighty.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mighty.args.duration, { kind: "constant", value: "end-of-turn" });
  // "friendly units" is a programmatic set (355.10.d): no unit is ever chosen,
  // so there is no TargetSpec and no way to fire "becomes a target".
  assert.equal(mighty.targets, undefined);
  assert.equal(mighty.picks, undefined);
});

test("ogs-024-024 Decisive Strike, Garen: the recorded set is the controller's units, with no location filter", () => {
  assert.deepEqual(mighty.args.objects, {
    kind: "constant",
    value: { kind: "query", filter: { type: "unit", controller: "self" } }
  });
  // "controller: self" is the engine PlayerSelector for the ability controller
  // (events/trigger-spec.ts), and the merged chain normalizes it to the item's
  // controller before matching (chain/engine.ts context.query). The set is not
  // restricted by location, which is why the grant covers units in Bases too.
  const filter = mighty.args.objects.value.filter;
  assert.equal(filter.location, undefined);
  assert.equal(filter.zone, undefined);
  assert.equal(filter.controller, "self");
});

test("ogs-024-024 Decisive Strike, Garen: the +2 is not approximated with Buff counters", () => {
  // CR 702: a Buff counter is a distinct object that contributes +1 Might; it is
  // not a Might value change. Approximating the grant with effect.buff would
  // change the units' Buff state, so the op stays the layers effect.
  assert.notEqual(mighty.op, "effect.buff");
  assert.equal(mighty.args.mode, undefined);
});

test.todo(
  "Decisive Strike, Garen: applying +2 Might to every friendly unit in the arithmetic layer and expiring it at " +
    "the end of the turn needs the continuous.might instruction primitive (RIFT-91)"
);

test.todo(
  "Decisive Strike, Garen full chain play: pay 5 energy + 1 Order power, enforce the [Action] Showdown " +
    "permission, and apply the continuous effect to every qualifying unit " +
    "(依赖 RIFT-89 continuous.timing 接线与 RIFT-91 指令入口)"
);
