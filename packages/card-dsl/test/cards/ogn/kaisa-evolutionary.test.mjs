import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/kaisa-evolutionary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { createProgramBinding, createEngineStaticBinder, translateTriggerFilter } from "../../../../engine-core/dist/programs/index.js";
import { assertTriggerSpec, validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";

const [ganking, triggered] = program.abilities;
const c = value => ({ kind: "constant", value });

const trashSpell = (id, extra = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: `card:${id}`,
  name: id,
  types: ["spell"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "trash",
  location: null,
  might: null,
  energy: 2,
  power: ["Mind"],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...extra
});

test("Kai'Sa, Evolutionary program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Kai'Sa, Evolutionary identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-697cf91efe23c8a9d145276f047432baac8d3218d9975045d3e27ad7573275ec"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.1\.b\.2/);
  assert.match(program.judgeReason, /points/);
  assert.match(program.judgeReason, /energyLessThan/);
  assert.match(program.judgeReason, /played 次数/);
  assert.match(program.judgeReason, /permission\.routes/);
  // 2026-10-17 re-sweep: the reason now names the event-name vocabulary that
  // blocks registration before the target filter is even reached.
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /conquered/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES|validateTriggerSpec/);
  assert.match(program.judgeReason, /候选法术印刷 Energy/);
  assert.match(program.judgeReason, /嵌套 Finalize/);
  assert.equal(
    program.sourceText,
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "When I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it. (You must still pay its Power cost.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: [Ganking] keyword plus the conquer trigger", () => {
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(triggered.kind, "triggered");
  // 383.4.c.1："When I conquer" 是征服触发（471.1 / 473.2.a）。
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, {
    event: "conquer",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);
});

test("structure: choice.optional wraps the play + recycle, per contract 3.9", () => {
  assert.equal(triggered.body.length, 1);
  const [choice] = triggered.body;
  assert.equal(choice.id, "kaisa.opt-in");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.linkedTo, undefined);

  const body = choice.args.body.value;
  assert.deepEqual(
    body.map(instruction => instruction.id),
    ["kaisa.play-spell", "kaisa.recycle-it"]
  );

  const playInstruction = body[0];
  assert.equal(playInstruction.op, "effect.play");
  // 355.10.a / 355.10.a.1：Trash 是公开区域 → 选目标（不是 pick）。
  assert.equal(playInstruction.picks, undefined);
  assert.deepEqual(playInstruction.args.target, c("kaisa.trash-spell"));
  assert.equal(playInstruction.targets.length, 1);
  const [target] = playInstruction.targets;
  assert.equal(target.id, "kaisa.trash-spell");
  assert.equal(target.selection, "one");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.filter.zone, "trash");
  assert.equal(target.filter.type, "spell");
  assert.equal(target.filter.owner, "controller");
  // 动态条件（Energy cost < your points）保留占位形状，等待谓词落地。
  assert.equal(target.filter.energyLessThan, "controller-points");
  // 356.1.b.2：只忽略 Energy（base Energy cost = 0）；Power 由费用管线按被选牌的
  // 印刷费用收取，静态 IR 给不出该结论，因此这里是形状而非可执行计划。
  assert.deepEqual(playInstruction.args.cost, c({ finalized: true, energy: 0 }));

  // "Then recycle it" 链接到刚打出的那张牌。
  const recycle = body[1];
  assert.equal(recycle.op, "effect.recycle");
  assert.equal(recycle.linkedTo, "kaisa.play-spell");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "kaisa.play-spell",
    key: "playedObjects"
  });
});

test("golden: effect.play executes the trash spell with a zero-Energy finalized plan", () => {
  // 局部执行证据：已合入的 effect.play 在给定 finalized 零 Energy 计划与目标时能真实把
  // trash 里的法术牌打出（420.3 / 356.1.b.2 的“忽略 Energy 费用”部分形状）。整张卡仍
  // 因动态 points 过滤、finalized 计划与「Then recycle it」的对象引用绑定保持 judge-required。
  const kernel = world().build();
  kernel.addObject(trashSpell("trash-spell"), "trash");
  const instruction = triggered.body[0].args.body.value[0];

  const run = runInstruction(
    play,
    {
      // 原语口径：target / pick / linkKey 是字面 id（chain 适配器的 LITERAL_FIELDS 会拆
      // 掉 constant 包络）；runInstruction 直接调原语，所以这里给字面 id。
      target: "kaisa.trash-spell",
      cost: c({ finalized: true, energy: 0, power: ["Mind"] })
    },
    {
      world: kernel,
      targets: { "kaisa.trash-spell": [kernel.ref("trash-spell")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.played, 1);
  assert.equal(kernel.getObject("trash-spell").zone, "board");
});

test("golden: declining the optional play skips the body entirely", () => {
  const kernel = world().build();
  kernel.addObject(trashSpell("trash-spell"), "trash");
  kernel.setAnswers({ "kaisa.opt-in/optional": false });
  const outcome = runAbilityBody(triggered.body, kernel);

  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("trash-spell").zone, "trash");
});

test.todo(
  "Kai'Sa: target filtering must compare a candidate spell's printed Energy with the current controller " +
    "points (355.10.a); the authored energyLessThan placeholder is not a known filter field, and the " +
    "trigger cannot register first because EVENT_PATTERN_TYPES has no 'conquer' spelling"
);
test.todo(
  "Kai'Sa: bind the actually selected spell to an ignore-base-energy cost plan and nested Finalize, preserving " +
    "its printed Power (356.1.b.2); the authored placeholder plan carries no Power"
);
test.todo(
  "Kai'Sa: link the played spell's current reference after its resolution so Then recycle it runs at the correct " +
    "time; effect.play links only the played COUNT"
);
test.todo(
  "Kai'Sa Ganking: adapt Ganking string permission to movement rule-query permission.routes and perform a Standard Move (810.1.b)"
);

test("Kai'Sa supported cost planning: ignore only Energy and retain the selected spell's printed Power", () => {
  const initial = world().card("spell", { types: ["spell"], zone: "trash", energy: 2, power: ["Mind"] }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("spell") });
  const plan = buildCostPlan(kernel, {
    id: "kaisa-selected-spell-cost",
    cost: { kind: "printed" },
    baseModifications: [{ kind: "ignore-base", ignore: "energy" }]
  });
  assert.equal(plan.finalized, true);
  assert.equal(plan.printed.energy, 2);
  assert.deepEqual(plan.printed.power, ["Mind"]);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ allowedDomains: ["Mind"], amount: 1 }]);
  assert.deepEqual(plan.source, kernel.ref("spell"));
});

test("Kai'Sa: the authored energyLessThan target filter is not a known field, so the card cannot register", () => {
  // 355.10.a: the comparison needs the candidate spell's printed Energy against the controller's
  // current points. The placeholder key is not in the merged filter vocabulary, and the merged
  // translator rejects the whole program rather than silently letting every trash spell pass.
  const source = {
    ref: { id: "kaisa", zoneEntryId: 1 },
    cardId: program.canonicalCardId,
    name: "Kai'Sa, Evolutionary",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 4,
    energy: 5,
    power: ["Fury"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  assert.throws(
    () => binding.registerProgramTriggers({ pipeline: { registerTrigger: () => {} } }, source),
    /Unsupported filter field energyLessThan/
  );
});

test("Kai'Sa: the conquer subscription is rejected by the closed event-name vocabulary", () => {
  // 2026-10-17 re-sweep measurement: registration never reaches the
  // energyLessThan / nested-Finalize gaps. translateTriggerFilter keeps the
  // declared EventPattern's event name, and events/trigger-spec.ts only accepts
  // the closed EVENT_PATTERN_TYPES spelling "conquered" (471.1 / 473.2.a).
  const source = {
    ref: { id: "kaisa", zoneEntryId: 1 },
    cardId: program.canonicalCardId,
    name: "Kai'Sa, Evolutionary",
    types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A",
    zone: "board", location: { type: "battlefield", id: "battlefield-1" },
    might: 4, energy: 5, power: ["Fury"], exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  assert.deepEqual(triggered.trigger.filter, { event: "conquer", filter: { role: "self" } });
  assert.deepEqual(translateTriggerFilter(triggered.trigger.filter, source.ref.id, triggered.trigger.at), {
    event: "conquer",
    object: { objectId: source.ref.id }
  });
  const validation = validateTriggerSpec({
    at: triggered.trigger.at,
    filter: translateTriggerFilter(triggered.trigger.filter, source.ref.id, triggered.trigger.at)
  });
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues.map(issue => [issue.path, issue.code]), [
    ["trigger.filter.event", "invalid-event-type"]
  ]);
  // registerProgramTriggers translates the ability body before the spec reaches
  // the pipeline, so the energyLessThan target key is reported first; the event
  // name still cannot pass, as the standalone validation above shows.
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  assert.throws(
    () => binding.registerProgramTriggers({ pipeline: { registerTrigger: () => {} } }, source),
    /Unsupported filter field energyLessThan/
  );
  assert.throws(
    () => assertTriggerSpec({ at: triggered.trigger.at, filter: translateTriggerFilter(triggered.trigger.filter, source.ref.id, triggered.trigger.at) }),
    { name: "TriggerSpecValidationError", message: /^trigger\.filter\.event:/ }
  );
});

test("Kai'Sa: the authored cost placeholder declares no Power, so it cannot stand in for the Finalize plan", () => {
  // 356.1.b.2 keeps the Power cost. The authored constant only pins energy to zero and carries no
  // printed Power, so it is a shape, not the per-selection finalized plan the primitive demands;
  // this test pins that absence for reviewers instead of treating the shape as executable.
  const playInstruction = triggered.body[0].args.body.value[0];
  assert.deepEqual(playInstruction.args.cost, c({ finalized: true, energy: 0 }));
  assert.equal("power" in playInstruction.args.cost.value, false);
});

test("Kai'Sa TODO: the card's instruction must carry the plan derived from the selected spell", {
  todo: "356.1.b.2: produce the ignore-base-energy plan from the actually selected spell and feed it to the nested Finalize"
}, () => {
  // The correct rule result: the plan the card plays with keeps the selected spell's printed Power
  // and zeroes only its Energy. The merged planner can build that plan when a caller supplies the
  // selection, so what is missing is the producer that binds it into the card's own instruction;
  // the authored constant (energy 0, no Power) is never asserted as a payable plan.
  const kernel = world().build();
  kernel.addObject(trashSpell("trash-spell"), "trash");
  const plan = buildCostPlan(kernel.clone({ sourceSnapshot: kernel.getObject("trash-spell") }), {
    id: "kaisa-selected-spell",
    cost: { kind: "printed" },
    baseModifications: [{ kind: "ignore-base", ignore: "energy" }]
  });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ allowedDomains: ["Mind"], amount: 1 }]);
  // The card's own instruction must resolve to that same plan; today it is the static placeholder.
  const authored = triggered.body[0].args.body.value[0].args.cost.value;
  assert.deepEqual(authored, { energy: plan.total.energy, power: plan.total.power });
});

test("Kai'Sa: effect.play links only the played count, never the played object for Then recycle it", () => {
  // "Then recycle it" needs the played card's current reference. effect.play publishes the number
  // of successful plays (ctx.link("played", n)); the authored playedObjects key has no producer.
  const kernel = world().build();
  kernel.addObject(trashSpell("trash-spell"), "trash");
  const instruction = triggered.body[0].args.body.value[0];
  const run = runInstruction(
    play,
    { target: "kaisa.trash-spell", cost: c({ finalized: true, energy: 0, power: ["Mind"] }) },
    { world: kernel, targets: { "kaisa.trash-spell": [kernel.ref("trash-spell")] } }
  );
  assert.equal(run.linked.played, 1);
  assert.equal(Object.hasOwn(run.linked, "playedObjects"), false);
  assert.equal(run.result.linkedValues.played, 1);
  assert.equal(Object.hasOwn(run.result.linkedValues, "playedObjects"), false);
});

test("Kai'Sa: the Ganking static rule registers but never reaches the movement rule query", () => {
  // 810.1.b: same string-permission/permission.routes mismatch as ogn/kayn-unleashed. The card's
  // own static ability binds through the merged program binding, yet the merged rule query
  // reports no Ganking permission at all.
  const kernel = world()
    .unit("kaisa", { cardId: program.canonicalCardId, types: ["unit"], might: 4 })
    .build();
  const source = kernel.getObject("kaisa");
  const layers = new LayerEngine(kernel.objects);
  layers.setObjects(kernel.objects);
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const binder = createEngineStaticBinder({
    layers,
    pipeline: {
      host: { objects: () => kernel.objects, context: () => kernel.clone({ sourceSnapshot: source }) },
      registerReplacement: () => {}
    }
  });
  const [ganking] = binding.inspect(source).abilities.filter((ability) => ability.kind === "static");
  assert.equal(ganking.effect.permission, "battlefield-to-battlefield");
  binder.bindStatic(ganking, source);
  assert.equal(layers.registry.list().length, 1);
  const view = movement(layers.registry, source.ref, source, "A");
  assert.equal(view.canGank, false);
  assert.deepEqual(view.permissions, []);
});
