import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/trevor-snoozebottom.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { EVENT_PATTERN_TYPES, validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { timingsAfter, turnFixture } from "../../../../engine-core/test/rules/triggers/harness.mjs";

const CANONICAL_ID =
  "card.hash-2becbc4280283ab4687ffaf051fc67d926dcc7f221810d14f31c9181a9b5cd0e";
const SOURCE_TEXT =
  "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
  "When I hold, play a ready 3 :rb_might: Sprite unit token with [Temporary] here. " +
  "(Kill it at the start of its controller's next Beginning Phase, before scoring.)";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [shield, onHold] = program.abilities;
const [readHere, playSprite] = onHold.body;

test("unl-048-219 Trevor Snoozebottom: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-048-219 Trevor Snoozebottom: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.2/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.match(program.judgeReason, /383\.4\.d\.2/);
  // The refreshed reason names the measured surfaces: the Temporary expansion's
  // beginning-start trigger is outside the closed event vocabulary, and the
  // default condition/layer dispatch still bypasses the expr-ext evaluator.
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /expr-ext/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-048-219 Trevor Snoozebottom: [Shield] is a declaration whose 814.1.b.3 default lives in the keyword file", () => {
  assert.equal(program.abilities.length, 2);
  // 814.1.b.3：印刷省略 Shield Value，卡内不写数值。
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield" });
  assert.equal(shield.value, undefined);
  const shieldDef = keywordDefinitionsById.get("Shield");
  assert.ok(shieldDef, "the merged Shield KeywordDef is registered (CR 814)");
  const [expansion] = shieldDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 1 });
  assert.equal(expansion.effect.kind, "continuous.might");
});

test("unl-048-219 Trevor Snoozebottom: 'When I hold' subscribes to the hold timing point for the source", () => {
  assert.equal(onHold.kind, "triggered");
  assert.deepEqual(onHold.trigger, { at: "hold", filter: { event: "held", filter: { source: "self" } } });
  assert.equal(onHold.optional, false);
  assert.equal(onHold.body.length, 2);
});

test("unl-048-219 Trevor Snoozebottom: the hold body plays the CR 187.2 Sprite token here", () => {
  assert.equal(readHere.id, "trevor-snoozebottom.read-here");
  assert.equal(readHere.op, "condition.value");
  assert.deepEqual(readHere.args.value, { kind: "object-property", object: "source", property: "location" });
  assert.deepEqual(readHere.args.key, { kind: "constant", value: "here" });
  assert.equal(playSprite.id, "trevor-snoozebottom.play-sprite");
  assert.equal(playSprite.op, "effect.token");
  // 187.2：3 [M] Sprite unit token（域外、Fae 标签、带 [Temporary]）。
  assert.deepEqual(playSprite.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(playSprite.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a：被“打出”的 token 先在链上创建，再交给 play 动作。
  assert.deepEqual(playSprite.args.mode, { kind: "constant", value: "play" });
  // “here” = 结算时来源所在的位置，由前一条 condition.value 链接。
  assert.deepEqual(playSprite.args.location, {
    kind: "linked-value",
    instructionId: "trevor-snoozebottom.read-here",
    key: "here"
  });
  assert.equal(playSprite.linkedTo, "trevor-snoozebottom.read-here");
  assert.deepEqual(playSprite.args.linkKey, { kind: "constant", value: "sprite" });
  // 184.1 的 “ready” 入场状态改写与 token 上的 [Temporary] 都不写进本指令（见 judgeReason）。
  assert.deepEqual(Object.keys(playSprite.args).sort(), ["amount", "linkKey", "location", "mode", "token"]);
  assert.equal(playSprite.targets, undefined);
  assert.equal(playSprite.picks, undefined);
});

test("unl-048-219 Trevor Snoozebottom golden: the same play-mode shape really creates and plays a defined token", () => {
  // 证明指令形状就是已合入的 440.2.c / 185.2.a 交接路径（只在卡面上把定义换成 merged 的 mech，
  // 并把符号化的 here 具体化为来源当前位置）：缺的只是 187.2 的 Sprite 定义本身与其入场状态，
  // 不为 Sprite 发明语义。
  const kernel = world().unit("trevor", { zone: "board", location: BATTLEFIELD }).build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "mech" },
      amount: playSprite.args.amount,
      mode: playSprite.args.mode,
      linkKey: playSprite.args.linkKey,
      location: { kind: "constant", value: BATTLEFIELD },
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const [created] = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.name, "Mech");
  assert.equal(created.might, 3);
  assert.deepEqual(created.location, BATTLEFIELD);
  assert.equal(created.controller, "A");
  assert.equal(created.energy, null);
  assert.equal(created.power, null);
  assert.deepEqual(run.events.map((event) => `${event.action}@${event.timingPoint}`), [
    "create-token@chain-item-pending",
    "play@card-played"
  ]);
});

test("unl-048-219 Trevor Snoozebottom golden: condition.value reads the held unit's current location", () => {
  const kernel = world().unit("trevor", { zone: "board", location: BATTLEFIELD }).build();
  const scoped = kernel.clone({ source: kernel.ref("trevor"), sourceSnapshot: kernel.getObject("trevor") });
  const outcome = resolveChainBody([readHere], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["trevor-snoozebottom.read-here.here"], BATTLEFIELD);
});

test("unl-048-219 Trevor Snoozebottom golden: the hold subscription binds and validates against the real pipeline", () => {
  // 383.4.d.2.a: the Hold Ability is put on the Chain as a Pending Item in the
  // Beginning-Phase Scoring Step. The merged filter adapter binds the source and
  // the closed TriggerSpec accepts it, so the subscription itself is no longer
  // part of the gap. The missing "Unit present at the held battlefield" payload
  // is pinned by its own test below instead of being approximated here.
  const filter = translateTriggerFilter(onHold.trigger.filter, "trevor", "hold");
  assert.deepEqual(filter, { event: "held", object: { objectId: "trevor" } });
  assert.equal(validateTriggerSpec({ at: "hold", filter }).ok, true);
  const f = turnFixture({
    fields: [{ id: "bf1", controller: "A" }, { id: "bf2", controller: null }],
    score: { A: 0, B: 0 },
    setup: (w) => w.unit("trevor", { location: { type: "battlefield", id: "bf1" }, might: 3 })
  });
  f.trigger("trevor:hold", "hold", [readHere], { sourceId: "trevor", filter });
  f.flow.start();
  assert.equal(f.flow.chain.pipeline.events.filter((event) => event.timingPoint === "hold").length, 1);
  assert.equal(f.kernel.player("A").score, 1);
});

test("unl-048-219 Trevor Snoozebottom gap: the hold payload carries no unit, so the presence-scoped subscription cannot fire", () => {
  // 383.4.d.2 / 383.4.d.2.a: only the Unit that was present when the Hold
  // happened may put its Hold Ability on the Chain. turn/flow.ts emits the
  // hold/held wave with a player and details.battlefieldId and no object, so an
  // objectId-bound subscription can never match: the point, the hold event and
  // an empty Chain are all observed here. This is the measured half of the
  // judgeReason's hold-payload gap.
  const filter = translateTriggerFilter(onHold.trigger.filter, "trevor", "hold");
  const f = turnFixture({
    fields: [{ id: "bf1", controller: "A" }, { id: "bf2", controller: null }],
    score: { A: 0, B: 0 },
    setup: (w) => w.unit("trevor", { location: { type: "battlefield", id: "bf1" }, might: 3 })
  });
  f.trigger("trevor:hold", "hold", [readHere], { sourceId: "trevor", filter });
  f.flow.start();
  const [hold] = f.flow.chain.pipeline.events.filter((event) => event.timingPoint === "hold");
  assert.equal(hold.player, "A");
  assert.deepEqual(hold.details, { battlefieldId: "bf1" });
  assert.equal(hold.object, undefined);
  assert.deepEqual(f.flow.chain.items, []);
  assert.equal(f.kernel.getObject("trevor").location.id, "bf1");
});

test("unl-048-219 Trevor Snoozebottom gap: the [Temporary] expansion triggers on an event outside the closed vocabulary", () => {
  // 816.1.b: the token's Temporary ability is a beginning-start trigger. The
  // timing point exists, but EventPattern's closed vocabulary omits it, so the
  // expansion can never be registered (invalid-event-type). Pinned as evidence
  // for the token-lifecycle half of judgeReason rather than approximated.
  const [expansion] = keywordDefinitionsById.get("Temporary").expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "triggered");
  assert.equal(expansion.trigger.at, "beginning-start");
  assert.equal(EVENT_PATTERN_TYPES.includes("beginning-start"), false);
  const validated = validateTriggerSpec({ at: expansion.trigger.at, filter: expansion.trigger.filter });
  assert.equal(validated.ok, false);
  assert.deepEqual(validated.issues.map((issue) => issue.code), ["invalid-event-type"]);
});

test("unl-048-219 Trevor Snoozebottom gap: effect.token rejects the ready entry override and has no Sprite definition", () => {
  // 143.4 / 184.1 / 185.2.d: entering ready is an entry-state rewrite the
  // create/play actions do not accept; 187.2's Sprite is likewise absent from
  // the frozen definition table. Both are asserted against the merged primitive.
  const kernel = world().unit("trevor", { zone: "board", location: BATTLEFIELD }).build();
  assert.throws(
    () => runInstruction(token, { ...playSprite.args, ready: { kind: "constant", value: true } }, { world: kernel }),
    /Invalid effect\.token argument: ready/
  );
  const run = runInstruction(token, {
    token: playSprite.args.token,
    amount: playSprite.args.amount,
    mode: playSprite.args.mode,
    linkKey: playSprite.args.linkKey,
    location: { kind: "constant", value: BATTLEFIELD }
  }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.sprite.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(run.events.length, 0);
});
 
test.todo(
  "unl-048-219 Trevor Snoozebottom: add the CR 187.2 3 [M] Sprite unit token (domainless, Fae tag, " +
    "[Temporary]) to the effect.token definition table"
);
test.todo(
  "unl-048-219 Trevor Snoozebottom: enter the token ready instead of the default exhausted entry " +
    "(CR 143.4 / 184.1 / 185.2.d) — the create/play actions document that entry overrides are unsupported, " +
    "and a follow-up effect.ready would fire a spurious 'becomes ready' event"
);
test.todo(
  "unl-048-219 Trevor Snoozebottom: expand the token's [Temporary] (CR 816.1.b: kill it at the start of its " +
    "controller's Beginning Phase before scoring; 816.2.a redundant instances) — the KeywordDef is merged " +
    "but its beginning-start trigger is outside the closed EventPattern vocabulary and token lifecycle " +
    "binding plus default-room program injection are still missing"
);
test.todo(
  "unl-048-219 Trevor Snoozebottom: bind the hold trigger to the unit present at the held battlefield " +
    "(CR 383.4.d.2/.2.a) — hold is emitted by turn/flow.ts and this card's held subscription now registers " +
    "through programs/filters.ts, but the payload carries only battlefield/player"
);
test.todo(
  "unl-048-219 Trevor Snoozebottom: read the Defender designation for [Shield] (CR 814.1.d/814.1.d.1) — " +
    "the Shield KeywordDef, the static binder and the combatRole/expr-ext designation fact are merged, " +
    "but the default condition and layer dispatch do not call the extension, so +1 cannot apply while defending"
);
