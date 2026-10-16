import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/scrutinizing-sergeant.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-767e3dc0c34d8624cb575cc8efa21b261e732ab8e621b197d1672ab785918746";
const SOURCE_TEXT = "When you play me, gain 1 XP for each friendly unit.";

const [ability] = program.abilities;
const [gainXp] = ability.body;

/**
 * 生产链的 query 覆盖把 controller/owner 的 "self"/"opponent" 归一化为能力控制者
 * （chain/engine.ts 的 context()）。参考内核按字面比较过滤器，所以这里给宿主装上
 * 同一归一化规则，让指令走解释器的真实锚点解析路径，而不是放宽断言或手改状态。
 */
function withProductionQuery(kernel, controller = "A") {
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    const objects = raw(normalized);
    if (filter.controller === "opponent") return objects.filter(object => object.controller !== controller);
    return objects;
  };
  return kernel;
}

function sergeantWorld(extra = () => {}) {
  const builder = world()
    .player("A")
    .unit("scrutinizing-sergeant", { controller: "A" })
    .unit("ally", { controller: "A" })
    .unit("enemy", { owner: "B", controller: "B" })
    .player("B");
  extra(builder);
  return withProductionQuery(builder.build());
}

test("unl-157-219 Scrutinizing Sergeant: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-157-219 Scrutinizing Sergeant: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-157-219 Scrutinizing Sergeant: one mandatory card-played trigger scoped to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 383.4.a.1: a Play Effect, put on the chain after the unit is played.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // No printed "may": mandatory.
  assert.equal(ability.optional, false);
});

test("unl-157-219 Scrutinizing Sergeant: 'gain 1 XP for each friendly unit' is one effect.xp over a friendly-unit count", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(gainXp.id, "scrutinizing-sergeant.gain-xp");
  // 728-730.1 / 733: gain XP through the merged effect.xp primitive.
  assert.equal(gainXp.op, "effect.xp");
  // 418.8 + 355.10.d: "for each friendly unit" is a resolve-time count, not a target.
  assert.deepEqual(gainXp.args.amount, {
    kind: "count",
    subject: "friendly-units",
    filter: { type: "unit", controller: "self", zone: "board" }
  });
  // 729.2 / 190.6.d: XP goes to the ability controller; no separate recipient arg.
  assert.equal(gainXp.args.player, undefined);
  assert.equal(gainXp.args.target, undefined);
  assert.equal(gainXp.args.pick, undefined);
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
  assert.equal(gainXp.condition, undefined);
});

test("unl-157-219 Scrutinizing Sergeant golden: the controller gains 1 XP per friendly unit (730.1)", () => {
  const kernel = sergeantWorld();
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // Two friendly units (the Sergeant itself and the ally); the opponent's unit
  // is not "friendly" (355.9.b / 190.6.d).
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(outcome.linkedValues["scrutinizing-sergeant.gain-xp.gained"], 2);
  assert.equal(outcome.linkedValues["scrutinizing-sergeant.gain-xp.gainedTo"], "A");
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-157-219 Scrutinizing Sergeant golden: cards in hand and units in other zones are not counted", () => {
  const kernel = sergeantWorld(builder => {
    builder.hand("held-unit", { controller: "A", types: ["unit"] });
    builder.card("trashed-unit", { controller: "A", types: ["unit"], zone: "trash" });
  });
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.linkedValues["scrutinizing-sergeant.gain-xp.gained"], 2);
  assert.equal(kernel.player("A").xp, 2);
});

test("unl-157-219 Scrutinizing Sergeant golden: only the played unit itself still gains exactly 1 XP", () => {
  const kernel = withProductionQuery(
    world().player("A").unit("scrutinizing-sergeant", { controller: "A" }).build()
  );
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(outcome.linkedValues["scrutinizing-sergeant.gain-xp.gained"], 1);
});

test("unl-157-219 Scrutinizing Sergeant golden: a replaced gain-xp action makes the instruction negated (contract 3.6)", () => {
  const kernel = sergeantWorld();
  kernel.addReplacement(action => (action.type === "gain-xp" ? "replaced" : null));
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.equal(kernel.player("A").xp, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test.todo(
  "unl-157-219 Scrutinizing Sergeant: the CardProgram -> trigger pipeline registration that subscribes this " +
    "Play Effect (383.4.a, 420.4.a) to the card-played timing point, checks the condition before the item is " +
    "put on the chain and locks its choices belongs to the shared chain/events wiring (RIFT-120 follow-up); " +
    "the body above runs through the real interpreter and reference kernel"
);
