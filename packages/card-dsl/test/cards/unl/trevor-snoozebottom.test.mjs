import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/trevor-snoozebottom.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.doesNotMatch(program.judgeReason, /beginning-start/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
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
    "but token lifecycle binding and default-room program injection are still missing"
);
test.todo(
  "unl-048-219 Trevor Snoozebottom: bind the hold trigger to the unit present at the held battlefield " +
    "(CR 383.4.d.2/.2.a) — hold is emitted by turn/flow.ts now, but the payload carries only battlefield/player (RIFT-31/RIFT-33)"
);
test.todo(
  "unl-048-219 Trevor Snoozebottom: read the Defender designation for [Shield] (CR 814.1.d/814.1.d.1) — " +
    "the Shield KeywordDef and static binder are merged, but the current ObjectSnapshot " +
    "does not provide designation; the unknown value is fail-closed as false, so +1 cannot apply while defending"
);
