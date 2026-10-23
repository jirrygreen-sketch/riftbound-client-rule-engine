import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/baron-nashor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import replacementEnter from "../../../../engine-core/dist/effects/instructions/replacement.enter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f38d5cb54f004209cfc8fd9489817ccc83394ce2f7125972d8538d18c193cc6d";
const SOURCE_TEXT =
  "As you play me, add the Baron Pit battlefield token to the board if it's not there already. " +
  'If you do, I enter there. (It has "Units can move here from anywhere.")\n' +
  "I can't be chosen by enemy spells and abilities.\n" +
  "Other friendly units have +2 :rb_might:.";

const [play, enterThere, untargetable, otherUnits] = program.abilities;
const [addBaronPit] = play.body;
const [enterBaronPit] = enterThere.with;
const constant = value => ({ kind: "constant", value });

function battlefieldSnapshot(overrides = {}) {
  return {
    ref: { id: "some-other-battlefield", zoneEntryId: 1 }, cardId: null, name: "Some Other Battlefield",
    types: ["battlefield"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: null, might: null, energy: null, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: true,
    ...overrides
  };
}

function boardFixture(options = {}) {
  const f = fixture({ cards: [
    { id: "baron-nashor", cardId: CANONICAL_ID, types: ["unit"], energy: 1, power: [], zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("baron-nashor"), to: "board", location: { type: "battlefield", id: options.location ?? "bf-1" } });
  return f;
}

test("unl-147-219 Baron Nashor: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-147-219 Baron Nashor: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.9/);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /757/);
  assert.match(program.judgeReason, /continuous\.might/);
  // Refresh: the location selector is merged and is no longer the blocker; the
  // remaining gaps are named concretely instead.
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.match(program.judgeReason, /Invalid replacement\.enter argument: location/);
  assert.match(program.judgeReason, /exclude 锚点/);
  assert.match(program.judgeReason, /位置选择器已合入/);
  assert.doesNotMatch(program.judgeReason, /RIFT-357（进行中）/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-147-219 Baron Nashor: the frozen token table still has no Baron Pit battlefield definition (187.9)", () => {
  // Evidence for gap (1): the card asks for a token the primitive cannot mint;
  // the failure is reported by the merged primitive, never approximated.
  const kernel = world().player("A", { energy: 0 }).build();
  const run = runInstruction(token, {
    token: { kind: "constant", value: "baron-pit" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "create" },
    location: { kind: "constant", value: { type: "battlefield", id: "baron-pit" } }
  }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(kernel.objects.filter(object => object.isToken), []);
});

test("unl-147-219 Baron Nashor: the 'not there already' tokenName predicate is silently ignored by the merged matcher (187.9)", () => {
  // Evidence for gap (1): the author-side key is not part of the merged filter
  // vocabulary, so it cannot distinguish a Baron Pit from any other battlefield
  // and must not be treated as a working existence check.
  const filter = addBaronPit.condition.left.filter;
  assert.deepEqual(filter, { zone: "board", type: "battlefield", tokenName: "Baron Pit" });
  assert.equal(matchesObjectFilter(filter, battlefieldSnapshot()), true,
    "an unrelated battlefield must not satisfy a real Baron Pit existence check");
  // The key is not consumed by the matcher at all: removing it changes nothing.
  const withoutKey = { zone: "board", type: "battlefield" };
  assert.equal(matchesObjectFilter(filter, battlefieldSnapshot()), matchesObjectFilter(withoutKey, battlefieldSnapshot()));
});

test("unl-147-219 Baron Nashor: the entry replacement's location/ifCreated are rejected by the merged primitive (369.3)", () => {
  // Evidence for gap (2): replacement.enter only accepts
  // state/exhausts/zone/duration/appliesTo/filter; the declared location and
  // ifCreated arguments fail the merged schema instead of being ignored.
  assert.throws(
    () => replacementEnter.argsSchema.parse({
      state: constant("ready"),
      location: enterBaronPit.args.location,
      ifCreated: enterBaronPit.args.ifCreated
    }),
    /Invalid replacement\.enter argument: location/
  );
  // The supported subset is accepted, so the card keeps a describable shape.
  assert.doesNotThrow(() => replacementEnter.argsSchema.parse({ state: constant("ready") }));
});

test("unl-147-219 Baron Nashor: the declared target restriction cannot distinguish enemy choosers yet (757.1/758.1)", () => {
  // Evidence for gap (3): the queried restriction is the same for both players
  // and carries no action list, so the "enemy spells and abilities" scope is
  // not represented and the card must not claim untargetability.
  const f = boardFixture();
  const source = f.kernel.getObject("baron-nashor");
  createEngineStaticBinder(f.engine).bindStatic(untargetable, source);
  const forController = restrictions(f.engine.layers.registry, "target", source.ref, source, "A");
  const forOpponent = restrictions(f.engine.layers.registry, "target", source.ref, source, "B");
  assert.equal(forController.length, 1);
  assert.deepEqual(forOpponent, forController);
  assert.deepEqual(forController[0].actions, []);
  // The authored scope fields stay in the declaration but are not converted
  // into rule-query inputs.
  assert.equal(untargetable.effect.chooser, "opponent");
  assert.equal(untargetable.effect.forbidden, true);
});

test("unl-147-219 Baron Nashor: the other-friendly-units aura binds with its source exclusion (479.4/355.10.d)", () => {
  const f = boardFixture();
  const handle = createEngineStaticBinder(f.engine).bindStatic(otherUnits, f.kernel.getObject("baron-nashor"));
  const [registration] = f.engine.layers.registry.list();
  assert.deepEqual(registration.effect.effect.filter.exclude, "source");
  handle.unbind();
});

test("unl-147-219 Baron Nashor: 'as you play me' adds the Baron Pit token once", () => {
  // 355.1 / 355.1.a：“As you play me, …” 是打出本牌时作出的动作，按契约 3.1 的 play 能力书写。
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(addBaronPit.id, "baron-nashor.add-baron-pit");
  assert.equal(addBaronPit.op, "effect.token");
  // 187.9 的 Baron Pit 战场 token 定义缺席（见 judgeReason）。
  assert.deepEqual(addBaronPit.args.token, { kind: "constant", value: "baron-pit" });
  assert.deepEqual(addBaronPit.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(addBaronPit.args.mode, { kind: "constant", value: "create" });
  assert.deepEqual(addBaronPit.args.linkKey, { kind: "constant", value: "baronPit" });
  assert.equal(addBaronPit.linkedTo, undefined);
});

test("unl-147-219 Baron Nashor: 'if it's not there already' is an explicit existence gate", () => {
  // “add … if it's not there already”：已存在 Baron Pit 战场 token 时不再创建。
  const condition = addBaronPit.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.deepEqual(condition.right, { kind: "constant", value: 0 });
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left.filter, {
    zone: "board",
    type: "battlefield",
    // tokenName 是描述性占位键：已合入的过滤器词汇没有“按 token 名称查战场”的维度。
    tokenName: "Baron Pit"
  });
});

test("unl-147-219 Baron Nashor: 'if you do, I enter there' is an entry replacement (CR 369.3)", () => {
  // 369.3 以本卡为“替代单位进场方式”的官方例子；契约 3.5 把替代建模为 replacement 能力。
  assert.equal(enterThere.kind, "replacement");
  assert.deepEqual(enterThere.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(enterThere.with.length, 1);
  assert.equal(enterBaronPit.id, "baron-nashor.enter-baron-pit");
  // replacement.enter 已支持 state 形态；location/ifCreated 仍被 argsSchema 拒绝（369.3）。
  assert.equal(enterBaronPit.op, "replacement.enter");
  assert.deepEqual(enterBaronPit.args.location, {
    kind: "constant",
    value: { type: "battlefield", id: "baron-pit" }
  });
  assert.deepEqual(enterBaronPit.args.ifCreated, {
    kind: "constant",
    value: "baron-pit-created-this-play"
  });
  assert.equal(enterBaronPit.linkedTo, undefined);
});

test("unl-147-219 Baron Nashor: 'I can't be chosen by enemy spells and abilities' is a continuous restriction", () => {
  // 757 / 757.1 / 758：Untargetable 是被动能力，不是一个被选择的目标或一次性的状态改变。
  assert.equal(untargetable.kind, "static");
  assert.equal(untargetable.effect.kind, "continuous.restrict");
  assert.equal(untargetable.effect.operation, "target");
  assert.equal(untargetable.effect.forbidden, true);
  assert.equal(untargetable.effect.appliesTo, "self");
  assert.equal(untargetable.effect.chooser, "opponent");
  assert.equal(untargetable.condition, undefined);
});

test("unl-147-219 Baron Nashor: the team bonus is an arithmetic-layer +2 Might for other friendly units", () => {
  // 479.4 算术层；“other friendly units” 是程序化选出的集合（355.10.d），不取目标。
  assert.equal(otherUnits.kind, "static");
  assert.equal(otherUnits.effect.kind, "continuous.might");
  assert.equal(otherUnits.effect.mode, "add");
  assert.equal(otherUnits.effect.layer, "arithmetic");
  assert.deepEqual(otherUnits.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(otherUnits.effect.filter, {
    zone: "board",
    type: "unit",
    controller: "controller",
    exclude: "source"
  });
  assert.equal(otherUnits.condition, undefined);
});

test.todo("baron-nashor: create one Baron Pit battlefield Location during As you play and bind its receipt to the entry destination (CR 187.9/355.1/369.3; needs a Battlefield-token definition, a create-Location action and a cross-phase creation receipt)");

test.todo("baron-nashor: enforce target prohibition for enemy spells/abilities while preserving friendly targeting (CR 757.1/758.1; needs a chooser-relative action scope on the restriction)");

test.todo("baron-nashor: bind the live other-friendly-unit Might aura while excluding its own source (CR 479.4/355.10.d; staticFilter rejects the exclude anchor)");
