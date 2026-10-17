import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/esteemed-hierophant.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { actionMatchesEventPattern } from "../../../../engine-core/dist/replacement/pattern.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f580f1b022b337a29509e9df000540117dd9fd09ef728fb8fc82f34c6bfe8807";
const SOURCE_TEXT =
  "While you control 7 or more runes, prevent all damage that enemy spells and abilities would deal to me.";

const [ability] = program.abilities;
const [prevent] = ability.with;

/**
 * The prevention planner/source classification and source-relative condition
 * binding remain blocked; the absolute-player count itself executes below.
 */
const predicate = {
  id: "esteemed-hierophant.rune-condition",
  op: "condition.predicate",
  args: { condition: { kind: "constant", value: ability.condition } }
};

/**
 * The reference kernel compares filter fields literally, so the symbolic
 * "self" controller selector is bound to the acting player for the execution
 * check (the same convention as ven/protective-sands and ven/renekton).
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map((item) => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "self" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

const predicateFor = (playerId) => ({
  ...predicate,
  args: { condition: { kind: "constant", value: substituteController(ability.condition, playerId) } }
});

/** 133.5.a.1 / 431.1: a channeled rune sits in the controller's Rune Zone. */
function runeZoneWorld(runesTotal, channeled = runesTotal) {
  const ids = Array.from({ length: runesTotal }, (_, index) => `r${index + 1}`);
  const kernel = world().unit("hierophant", { controller: "A", might: 5 }).rune(ids).build();
  if (channeled > 0) {
    assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: channeled }).status, "done");
  }
  return kernel.clone({ controller: "A", sourceSnapshot: kernel.getObject("hierophant") });
}

test("ven-025-166 Esteemed Hierophant: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-025-166 Esteemed Hierophant: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /replacement\.prevent/);
  assert.match(program.judgeReason, /438\.7/);
  assert.match(program.judgeReason, /BlockedReplacementError/);
  assert.match(program.judgeReason, /bindReplacement/);
  assert.match(program.judgeReason, /spell and ability damage|spells and abilities/);
});

test("ven-025-166 Esteemed Hierophant: one prevention replacement scoped to enemy spells and abilities", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "replacement");
  // 438.7: Prevent is a Delayed Replacement Effect, so the card declares the
  // intercepted damage event rather than a resolving instruction.
  assert.equal(ability.replaces.event, "damage");
  assert.equal(ability.replaces.filter.target, "self");
  // 438.1.b / 418.6.b: the source classification has no discriminator in the
  // frozen damage GameAction; the intended scope is recorded declaratively.
  assert.deepEqual(ability.replaces.filter.sourceKind, ["spell", "ability"]);
  assert.equal(ability.replaces.filter.controller, "opponent");

  assert.equal(prevent.id, "esteemed-hierophant.prevent-all-damage");
  assert.equal(prevent.op, "replacement.prevent");
  assert.deepEqual(prevent.args.amount, { kind: "constant", value: "all" });
});

test("ven-025-166 Esteemed Hierophant: the rune clause is the ability's condition", () => {
  // 438.3.c keeps the Prevent Value "All"; 363.2.a / 383.2.b make the constant
  // condition part of the continuous effect's scope.
  const condition = ability.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 7 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes-you-control");
  assert.deepEqual(condition.left.filter, {
    type: "rune",
    zone: "rune-zone",
    controller: "self"
  });
});

test("ven-025-166 golden: the 7-or-more-runes condition really evaluates", () => {
  const seven = runeZoneWorld(7);
  const accepted = runAbilityBody([predicateFor("A")], seven);
  assert.equal(accepted.status, "executed");
  assert.equal(accepted.linkedValues["esteemed-hierophant.rune-condition.value"], true);

  const six = runeZoneWorld(7, 6);
  const rejected = runAbilityBody([predicateFor("A")], six);
  assert.equal(rejected.status, "executed");
  assert.equal(rejected.linkedValues["esteemed-hierophant.rune-condition.value"], false);
});

test("ven-025-166 golden: an opponent's runes do not satisfy the controller condition", () => {
  const kernel = runeZoneWorld(0);
  assert.equal(kernel.perform({ type: "channel-rune", player: "B", amount: 7 }).status, "done");
  const outcome = runAbilityBody([predicateFor("A")], kernel);
  assert.equal(outcome.linkedValues["esteemed-hierophant.rune-condition.value"], false);
});

test.todo(
  "ven-025-166 Esteemed Hierophant: 'prevent all damage' (438.1/438.2/438.3.c/438.7) needs a " +
    "replacement.prevent body planner that rewrites a matched damage event to zero; replacement lifecycle " +
    "registration is already available"
);

test.todo(
  "ven-025-166 Esteemed Hierophant: 'enemy spells and abilities' needs a damage-source " +
    "classification — the frozen damage GameAction carries only { source, target, amount, combat }"
);


test.todo(
  "ven-025-166 Esteemed Hierophant: replacement rune-count condition needs a source-relative " +
    "relative-player binding on the replacement path — chain/engine.ts only normalizes query " +
    "controller/owner, not condition count filters (133.5.a.1/431.1)"
);

/**
 * 复核（2026-10-17）执行证据：三条缺口用真实绑定/求值路径复现。
 */

/** 生产替换绑定所需的 host/context 适配（与 engine-core 的 bindDeps 同形）。 */
function bindDeps(kernel) {
  return {
    host: {
      object: (ref) => kernel.objects.find((object) => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId) ?? null,
      objects: () => kernel.objects,
      context: (source, controller) => kernel.clone({ sourceSnapshot: source, controller })
    },
    pipeline: { clock: { turn: 1 }, registerReplacement: () => {}, unregisterReplacement: () => {} }
  };
}

test("ven-025-166 evidence: replacement.prevent is not a supported planner opcode (438.2/438.3.c)", () => {
  // 438.2 的 prevented 事件改写目前没有 planner 支持；绑定期失败关闭而不是近似执行。
  assert.throws(
    () => bindReplacement(
      { replaces: ability.replaces, with: ability.with, condition: ability.condition },
      runeZoneWorld(7).ref("hierophant"),
      bindDeps(runeZoneWorld(7))
    ),
    /Unsupported replacement opcode: replacement\.prevent/
  );
});

test("ven-025-166 evidence: the rune-count condition needs an absolute player binding on the replacement path", () => {
  const probe = (condition) => {
    const kernel = runeZoneWorld(7);
    const registered = [];
    // 用只含 target:self 的图案，让匹配结果只取决于条件求值（本卡原图案另受来源分类键影响，见下一条）。
    const bound = bindReplacement(
      { replaces: { event: "damage", filter: { target: "self" } }, with: [{ id: "probe-ready", op: "effect.ready", args: { objects: { kind: "constant", value: { kind: "source" } } } }], condition },
      kernel.ref("hierophant"),
      {
        host: bindDeps(kernel).host,
        pipeline: { clock: { turn: 1 }, registerReplacement: (registration) => registered.push(registration), unregisterReplacement: () => {} }
      }
    );
    const damage = { type: "damage", source: kernel.ref("hierophant"), target: kernel.ref("hierophant"), amount: 2, combat: false };
    return registered[0].matches(damage, damage);
  };

  const absolute = JSON.parse(JSON.stringify(ability.condition));
  absolute.left.filter.controller = "A";
  assert.equal(probe(absolute), true, "an absolute player id evaluates the 7-rune gate");
  assert.equal(probe(ability.condition), false, "the symbolic controller:self has no relative-player normalization here");
});

test("ven-025-166 evidence: the authored source-classification declaration never matches a damage action", () => {
  const kernel = runeZoneWorld(7);
  const hostRef = kernel.ref("hierophant");
  const damage = { type: "damage", source: hostRef, target: hostRef, amount: 2, combat: false };
  const snapshotFor = (ref) => kernel.objects.find((object) => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId) ?? null;
  const authored = actionMatchesEventPattern({ pattern: ability.replaces, action: damage, target: { object: hostRef }, hostRef, controller: "A", snapshotFor });
  // 去掉来源分类键后同一动作能匹配：唯一失败点是 controller:opponent 被当成“被伤害对象”的
  // 控制器比较（对象是宿主自身，控制器是 A），而不是伤害来源的属性（438.1.b）。
  const stripped = actionMatchesEventPattern({ pattern: { event: "damage", filter: { target: "self" } }, action: damage, target: { object: hostRef }, hostRef, controller: "A", snapshotFor });
  assert.equal(authored, false);
  assert.equal(stripped, true);
});
