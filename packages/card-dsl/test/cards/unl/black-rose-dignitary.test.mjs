import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/black-rose-dignitary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-8797765d08c9c34c140c5971815c031caaf8974b4575d37dea511ac5a37f6016";
const SOURCE_TEXT =
  "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
  "[Deathknell][>] Channel 1 rune exhausted. (When I die, get the effect.)";

const [assaultKeyword, deathknellKeyword, diesTrigger] = program.abilities;
const [channelRune] = diesTrigger.body;

test("unl-152-219 Black Rose Dignitary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-152-219 Black Rose Dignitary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /807\.1\.c/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(82|91|120|257)/);
});

test("unl-152-219 Black Rose Dignitary: both keywords are declared, not re-implemented", () => {
  // 契约 3.7 / README 第 5 节；807.1.b.3：省略数值的 Assault 视为 1，由 KeywordDef 提供默认值。
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(assaultKeyword, { kind: "keyword", keyword: "assault" });
  assert.equal(assaultKeyword.value, undefined);
  assert.deepEqual(deathknellKeyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknellKeyword.value, undefined);
});

test("unl-152-219 Black Rose Dignitary: the declared keywords match their registered KeywordDefs", () => {
  const registeredAssault = keywordDefinitionsById.get("Assault");
  assert.ok(registeredAssault, "effects/keywords/Assault.ts must be in the generated registry");
  assert.equal(assaultKeyword.keyword, registeredAssault.keyword.toLowerCase());
  // 807.2：多个 Assault 实例数值相加并合并为一个；807.1.b.3 的默认值由展开提供。
  assert.equal(registeredAssault.stacking, "sum");
  const [expansion] = assault.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 1 });
  assert.equal(expansion.effect.layer, "arithmetic");
  assert.equal(expansion.effect.appliesTo, "self");

  const registeredDeathknell = keywordDefinitionsById.get("Deathknell");
  assert.ok(registeredDeathknell, "effects/keywords/Deathknell.ts must be in the generated registry");
  assert.equal(deathknellKeyword.keyword, registeredDeathknell.keyword.toLowerCase());
  // 808.2 / 808.2.a：同一永久物上的每个 Deathknell 实例各自独立触发。
  assert.equal(registeredDeathknell.stacking, "separate");
});

test("unl-152-219 Black Rose Dignitary: the printed [Effect] rides an object-killed trigger (CR 808.1.c)", () => {
  assert.equal(diesTrigger.kind, "triggered");
  assert.equal(diesTrigger.trigger.at, "object-killed");
  assert.deepEqual(diesTrigger.trigger.filter, { self: true });
  assert.equal(diesTrigger.trigger.condition, undefined);
  assert.equal(diesTrigger.optional, false);
});

test("unl-152-219 Black Rose Dignitary: the effect channels exactly 1 rune exhausted (CR 431.1 / 431.2)", () => {
  assert.equal(diesTrigger.body.length, 1);
  assert.equal(channelRune.id, "black-rose-dignitary.channel-rune");
  assert.equal(channelRune.op, "effect.channel");
  assert.deepEqual(channelRune.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelRune.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelRune.targets, undefined);
  assert.equal(channelRune.picks, undefined);
  assert.equal(channelRune.linkedTo, undefined);
  assert.equal(channelRune.condition, undefined);
});

test("unl-152-219 Black Rose Dignitary golden: the body really channels one rune and marks it exhausted", () => {
  // 走已合入的链式适配器（原语 schema 解析 Expr 参数、解释器负责先求值；lonely-poro 同一惯例）。
  const kernel = world().player("A").rune(["top-rune", "second-rune"]).build();
  const outcome = resolveChainBody(diesTrigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["black-rose-dignitary.channel-rune", "executed"]]
  );
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.deepEqual(
    kernel.objectsInZone("A", "rune-zone").map(ref => ref.id),
    ["top-rune"]
  );
  assert.deepEqual(outcome.events.map(event => event.action), ["channel-rune"]);
});

test("unl-152-219 Black Rose Dignitary golden: an empty Rune Deck channels as much as possible (CR 431.3)", () => {
  const kernel = world().build();
  const run = runInstruction(channel, { amount: { kind: "constant", value: 1 }, exhausted: true }, {
    world: kernel
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
});

test.todo(
  "unl-152-219 Black Rose Dignitary: expand [Assault] into a conditional +1 Might in the arithmetic " +
    "layer for as long as I hold the Attacker designation (CR 807.1.c / 807.1.d / 807.1.d.1) — the " +
    "KeywordDef currently reads designation while ObjectSnapshot exposes combatRole; the production " +
    "binder fail-closes the missing property instead of evaluating the attacker condition"
);
test.todo(
  "unl-152-219 Black Rose Dignitary: expand [Deathknell] (subscribe object-killed, removal from the " +
    "chain when the death is replaced per 808.1.d.1, last-known information recorded pre-chain per " +
    "808.1.d.3) — the KeywordDef still references the unregistered trigger.leave op and its death " +
    "replacement/LKI semantics are not executable"
);
