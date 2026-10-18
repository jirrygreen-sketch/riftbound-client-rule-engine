import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/noxian-demolitionist.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ChainContractBlockedError } from "../../../../engine-core/dist/chain/engine.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-ab6b3fd38bb2a4975bf416bdfc074f82b2ad97c5aa662fe337dcb43a9074612d";
const SOURCE_TEXT =
  "When I conquer, you may kill a gear with Energy cost no more than my Might.";

const [ability] = program.abilities;
const [optional] = ability.body;
const [killGear] = optional.args.body.value;
const OPTIONAL_ID = "noxian-demolitionist.may-kill-gear/optional";

/**
 * 143.2.a："my Might" 读宿主当前值（1），"Energy cost" 读目标的印刷 Energy 值。
 * 参考内核的过滤器按值比较、不绑定 controller 占位符，因此 golden 按 Finalize 的
 * 锁定结果直接提供目标（同 ogn/ambessa-respected-and-feared 的写法）。
 */
function demolitionistWorld(gearEnergy) {
  const base = world()
    .unit("demolitionist", {
      might: 1,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("gear-piece", {
      types: ["gear"],
      energy: gearEnergy,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const kernel = base.clone({
    controller: "A",
    sourceSnapshot: base.getObject("demolitionist")
  });
  kernel.setTargets("noxian-demolitionist.gear", [kernel.ref("gear-piece")]);
  return kernel;
}

test("ven-080-166 Noxian Demolitionist: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-080-166 Noxian Demolitionist: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // README 第 2 节：judgeReason 必须写明缺哪个时点/谓词与依赖任务。
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /Energy cost/);
  assert.match(program.judgeReason, /choice\.optional/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-080-166: the conquer trigger is an optional kill of one gear", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c.1："When I conquer" 是 Conquer Effect；封闭时点 conquer。
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    // 判别式取封闭词汇表 spelling："conquered"（EVENT_PATTERN_TYPES），
    // pipeline-match 的 EVENT_NAMES 把它映射到 conquer 时点。
    event: "conquered",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 403.1 / 契约 3.9："you may" 是触发能力自身的可选执行，被选指令包进 body。
  assert.equal(ability.optional, true);
  assert.equal(ability.body.length, 1);
  assert.equal(optional.id, "noxian-demolitionist.may-kill-gear");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.args.body.kind, "constant");
  assert.equal(optional.args.body.value.length, 1);
});

test("ven-080-166: the printed conquer trigger now registers through the real program binder", () => {
  // RIFT-733: the shipped program used the non-vocabulary spelling
  // event: "conquer", which assertTriggerSpec rejected with
  // invalid-event-type, so the ability never reached triggerRegistrations.
  // The closed vocabulary spells it "conquered" (EVENT_PATTERN_TYPES) and
  // pipeline-match maps that to the conquer timing point.
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const registry = new ProgramRegistry([lifted]);
  const f = fixture();
  const source = { ...f.kernel.getObject("source"), cardId: CANONICAL };

  const registrations = triggerRegistrations(registry, source);
  assert.equal(registrations.length, 1);
  const [registration] = registrations;
  assert.equal(registration.spec.at, "conquer");
  // The translated pattern keeps the self anchor and the vocabulary spelling.
  assert.deepEqual(registration.spec.filter, {
    event: "conquered",
    object: { objectId: "source" }
  });
  assert.equal(registration.optional, true);
  assert.doesNotThrow(() => assertTriggerSpec(registration.spec));
});

test("ven-080-166: the merged conquer emission really matches the bound trigger pattern", () => {
  const { kernel, host } = fixture();
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const source = { ...kernel.getObject("source"), cardId: CANONICAL };
  const [registration] = triggerRegistrations(new ProgramRegistry([lifted]), source);

  // A real scoring emission carries the conquer payload (no object for the
  // scoring player unless the action names one); the self-object anchor is
  // exercised against the object-bearing form the TurnFlow score wave emits.
  const emission = { timingPoint: "conquer", kind: "conquer", player: "A", object: kernel.getObject("source"), details: { battlefieldId: "bf-1" } };
  assert.equal(matchesTriggerEvent(registration.spec.filter, emission, "A"), true);
  // A different object never satisfies the self anchor.
  const foreign = { ...emission, object: kernel.getObject("enemy") };
  assert.equal(matchesTriggerEvent(registration.spec.filter, foreign, "A"), false);
  assert.equal(host.execute({ type: "score", player: "A", amount: 1 }).outcome.status, "done");
});

test("ven-080-166: the chosen body kills one gear and carries the Might gate", () => {
  assert.equal(killGear.id, "noxian-demolitionist.kill-gear");
  assert.equal(killGear.op, "effect.kill");
  // 355.7 / 355.9.a.1："a gear" 是 Board 上的装备目标（原文没有控制者限制）。
  assert.deepEqual(killGear.args.target, {
    kind: "constant",
    value: "noxian-demolitionist.gear"
  });
  assert.deepEqual(killGear.targets, [
    {
      id: "noxian-demolitionist.gear",
      filter: { type: "gear", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(killGear.linkedTo, undefined);
  assert.equal(killGear.picks, undefined);
  // 355.9.b + 143.2.a："with Energy cost no more than my Might" 的动态比较
  //（目标的印刷 Energy 值 ≤ 宿主当前 Might），目标绑定尚未消费该谓词，
  // 因此按 359.3.e 的重验语义写在指令的 condition 上（见 judgeReason）。
  assert.deepEqual(killGear.condition, {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { target: "noxian-demolitionist.gear" },
      property: "energy"
    },
    operator: "lte",
    right: { kind: "object-property", object: "self", property: "might" }
  });
});

test("ven-080-166 golden: accepting the may-body kills a gear whose Energy cost fits the Might gate", () => {
  const kernel = demolitionistWorld(1);
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["noxian-demolitionist.kill-gear", "executed"],
      ["noxian-demolitionist.may-kill-gear", "executed"]
    ]
  );
  assert.equal(kernel.getObject("gear-piece").zone, "trash");
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
  // 链接键带执行路径前缀（解释器的稳定 request id 规则）。
  assert.deepEqual(
    outcome.linkedValues["noxian-demolitionist.may-kill-gear/noxian-demolitionist.kill-gear.killed"],
    [{ id: "gear-piece", zoneEntryId: 1 }]
  );
});

test("ven-080-166 golden: a gear whose Energy cost exceeds my Might is skipped, not mistargeted", () => {
  for (const energy of [2, 5]) {
    const kernel = demolitionistWorld(energy);
    kernel.setAnswers({ [OPTIONAL_ID]: true });
    const outcome = resolveChainBody(ability.body, kernel);

    assert.equal(outcome.status, "partial", `energy=${energy}`);
    assert.deepEqual(
      outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
      [
        ["noxian-demolitionist.kill-gear", "negated", "skipped"],
        ["noxian-demolitionist.may-kill-gear", "negated", "skipped"]
      ],
      `energy=${energy}`
    );
    assert.equal(kernel.getObject("gear-piece").zone, "board", `energy=${energy}`);
    assert.deepEqual(outcome.events, [], `energy=${energy}`);
  }
});

test("ven-080-166 golden: declining the may-body leaves the gear alone", () => {
  const kernel = demolitionistWorld(1);
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["noxian-demolitionist.may-kill-gear", "negated", "skipped"]]
  );
  assert.equal(kernel.getObject("gear-piece").zone, "board");
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.events, []);
});

test("ven-080-166 golden: the merged kill primitive re-checks the locked gear reference", () => {
  const kernel = demolitionistWorld(1);
  const locked = kernel.ref("gear-piece");
  const run = runInstruction(
    kill,
    { target: "noxian-demolitionist.gear" },
    { world: kernel, targets: { "noxian-demolitionist.gear": [locked] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("gear-piece").zone, "trash");
});

test("ven-080-166 golden: an unprinted Energy cost is ignored without treating null as zero", () => {
  const kernel = demolitionistWorld(null);
  kernel.setAnswers({ [OPTIONAL_ID]: true });
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    [killGear.id, "ignored", "mistargeted"],
    [optional.id, "ignored", "mistargeted"]
  ]);
  assert.equal(kernel.getObject("gear-piece").energy, null);
  assert.equal(kernel.getObject("gear-piece").zone, "board");
  assert.deepEqual(outcome.events, []);
});

test("ven-080-166 golden: a stale gear is ignored by the original optional body", () => {
  const kernel = demolitionistWorld(1);
  assert.equal(kernel.perform({ type: "kill", object: kernel.ref("gear-piece") }).status, "done");
  kernel.setAnswers({ [OPTIONAL_ID]: true });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    [killGear.id, "ignored", "mistargeted"],
    [optional.id, "ignored", "mistargeted"]
  ]);
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("gear-piece").zone, "trash");
});

test("ven-080-166: the chain still refuses the nested gear target at Finalize", () => {
  // RIFT-733: with the conquer spelling fixed the trigger now registers, so
  // the next real seam is the nested target inside choice.optional. The chain
  // Finalize rejects it before any target lock and the trigger stays pending.
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "demolitionist", cardId: CANONICAL, types: ["unit"], energy: 2, might: 1 }],
    describePlay: binding.describePlay,
    choose: request => (request.type === "optional" ? true : undefined)
  });
  binding.attachLifecycle(f.engine, () => {});

  f.engine.commit({ type: "play", object: f.kernel.ref("demolitionist"), player: "A" });
  f.engine.advance();
  f.engine.emit({ timingPoint: "conquer", object: f.kernel.getObject("demolitionist"), player: "A" });
  assert.deepEqual(f.engine.items.map(item => item.id + ":" + item.status), ["trigger:1:pending"]);

  assert.throws(() => f.engine.advance(), error =>
    error instanceof ChainContractBlockedError &&
    /Nested\/repeated targets require an interpreter target-selection lifecycle adapter/.test(error.message));
  // The rolled-back advance leaves the trigger pending and locks no target.
  assert.deepEqual(f.engine.items.map(item => item.id + ":" + item.status), ["trigger:1:pending"]);
});

test.todo(
  "ven-080-166 Noxian Demolitionist: enforce Energy cost <= host effective Might in the Finalize legal-target " +
    "set (355.9.b / 143.2.a); a resolution-time condition cannot replace the dynamic target predicate (RIFT-359)"
);

test.todo(
  "ven-080-166 Noxian Demolitionist: lock and revalidate the gear TargetSpec nested inside choice.optional " +
    "through the chain target lifecycle before resolving the accepted may-body — chain/engine.ts " +
    "assertFinalizationSurface still throws ChainContractBlockedError('Nested/repeated targets require an " +
    "interpreter target-selection lifecycle adapter') for this body"
);
