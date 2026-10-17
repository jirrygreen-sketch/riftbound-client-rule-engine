import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/master-of-shadows.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { describeActivate } from "../../../../engine-core/dist/programs/activate.js";

const CANONICAL_ID =
  "card.hash-7e2a7385750d6027b29a1da6a1f5a3301f7cea6ae37c0db13059d67f606b0f5b";
const SOURCE_TEXT =
  "When you banish a card you own, empower me. (I become Empowered if I'm not already.)\n" +
  "[Action][>] Disempower me, :rb_exhaust:: Discard 1, then draw 1.";

const [triggered, activated] = program.abilities;

test("ven-143-166 Master of Shadows: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /card-banished/);
  assert.match(program.judgeReason, /disempower/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-143-166: 'When you banish a card you own' trigger shape", () => {
  assert.equal(triggered.kind, "triggered");
  // 428.1 / 428.2：Banish 的观察时点是封闭时点表的 card-banished。
  assert.equal(triggered.trigger.at, "card-banished");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-banished",
    filter: {
      // “you banish”：执行该次放逐的玩家是能力控制者。
      player: "self",
      // “a card you own”：被放逐牌的拥有者是能力控制者。
      owner: "self"
    }
  });
  // 没有 “you may”：强制触发（383.1）。
  assert.equal(triggered.optional, false);
});

test("ven-143-166 binding: the merged adapter translates 'you banish a card you own' into both anchors", () => {
  // The merged registration path translates filter fields into TriggerSpec：“you banish”（player）与
  // “a card you own”（object.owner）两个锚点都进入翻译结果，说明适配器本身已就位；
  // Registration still needs the event discriminant and actual banish actor;
  // player and owner translation itself is already merged.
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const kernel = world()
    .unit("master-of-shadows", { types: ["legend"], zone: "board", cardId: CANONICAL_ID })
    .build();
  const [registration] = triggerRegistrations(registry, kernel.getObject("master-of-shadows"));
  assert.deepEqual(registration.spec.filter, {
    event: "card-banished",
    object: { owner: "self" },
    player: "self"
  });
  assert.equal(registration.spec.at, "card-banished");
  assert.equal(registration.boundToIncarnation, true);
});

test("ven-143-166: 'empower me' is the merged effect.empower against the source", () => {
  assert.equal(triggered.body.length, 1);
  const [empowerSelf] = triggered.body;
  assert.equal(empowerSelf.id, "master-of-shadows.empower-self");
  assert.equal(empowerSelf.op, "effect.empower");
  // 442.1 / 827.1.b.1：Empower 的来源自身为对象且不是目标。
  assert.deepEqual(empowerSelf.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(empowerSelf.targets, undefined);
});

test("ven-143-166 golden: 'empower me' empowers the legend source through the interpreter", () => {
  const kernel = world()
    .unit("master-of-shadows", { types: ["legend"], zone: "board", cardId: CANONICAL_ID })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("master-of-shadows") });

  const outcome = runAbilityBody(triggered.body, context);

  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("master-of-shadows").empowered, 1);
  assert.deepEqual(context.events.map(event => event.action), ["empower"]);
  assert.deepEqual(outcome.linkedValues["master-of-shadows.empower-self.empowered"], {
    mode: "empower",
    count: 1,
    objects: [context.ref("master-of-shadows")]
  });
});

test("ven-143-166: [Action][>] ability pays Disempower + Exhaust and has two instructions", () => {
  assert.equal(activated.kind, "activated");
  // 806.1.d：[Action][>] 的许可按契约 3.1 记在 activated.timing。
  assert.equal(activated.timing, "action");
  assert.equal("restriction" in activated, false);
  // 204.1.b / 443.2 / 415.5：“:” 前的 Disempower 与 Exhaust 都是费用。
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [
      { kind: "disempower", object: "self" },
      { kind: "exhaust", object: "self" }
    ]
  });
  assert.deepEqual(activated.body.map(instruction => instruction.id), [
    "master-of-shadows.discard-one",
    "master-of-shadows.draw-one"
  ]);
  const [discard, draw] = activated.body;
  assert.deepEqual(discard.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(discard.picks, undefined);
  // 423.4 的最后一句：“then draw” 不依赖弃牌是否完全成功——抽牌不写 linkedTo。
  assert.equal(draw.linkedTo, undefined);
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
});

test("ven-143-166 binding: the merged activated-ability adapter translates the ability body", () => {
  // The activated-ability adapter resolves the program, translates the body
  // (targets included), and builds the ChainDraft; the pending payment gap remains
  // recorded in the card's judgeReason.
  const kernel = world()
    .unit("master-of-shadows", { types: ["legend"], zone: "board", cardId: CANONICAL_ID })
    .build();
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const draft = describeActivate(registry, kernel.getObject("master-of-shadows"), "A");

  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "action");
  assert.deepEqual(draft.body.map(instruction => instruction.id), [
    "master-of-shadows.discard-one",
    "master-of-shadows.draw-one"
  ]);
  assert.equal(draft.cost.cost.kind, "activated");
  assert.deepEqual(
    translateInstructionTargets(activated.body).map(instruction => instruction.op),
    ["effect.discard", "effect.draw"]
  );
});

test.todo(
  "ven-143-166: the activated ability still needs a Disempower payment kind in the finalized cost plan " +
    "(CR 443.2.a); the body adapter itself is already executable"
);

test("ven-143-166 golden: 'Discard 1, then draw 1' discards and draws", () => {
  const kernel = world()
    .unit("master-of-shadows", { types: ["legend"], zone: "board" })
    .hand("hand-card")
    .deck("drawn-card")
    .build();

  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["master-of-shadows.discard-one", "executed"],
    ["master-of-shadows.draw-one", "executed"]
  ]);
  assert.deepEqual(kernel.events.map(event => event.action), ["discard", "draw"]);
  assert.equal(kernel.objectsInZone("A", "trash").length, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(outcome.linkedValues["master-of-shadows.discard-one.discarded"], {
    count: 1,
    player: "A",
    // effect.discard 记录的是弃牌前的引用（供最后已知信息使用），zoneEntryId 因此是
    // 弃置之前的那一次入区序号。
    objects: [{ id: "hand-card", zoneEntryId: 1 }]
  });
});


test("ven-143-166 golden: an impossible discard still lets the unlinked draw resolve (423.4)", () => {
  const kernel = world()
    .unit("master-of-shadows", { types: ["legend"], zone: "board" })
    .deck("drawn-card")
    .build();
  const outcome = resolveChainBody(activated.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["master-of-shadows.discard-one", "negated"],
    ["master-of-shadows.draw-one", "executed"]
  ]);
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.deepEqual(kernel.events.map(event => event.action), ["draw"]);
  assert.equal(kernel.player("A").handSize, 1);
});

test.todo(
  "ven-143-166: the banish event pattern needs the card-banished discriminant and who-banished / " +
    "actual banish actor provenance (contract change request); ownership is already on object.owner"
);

test.todo("Master of Shadows: repeated banish triggers must keep Empowered binary (CR 442.1.b/.c)");
