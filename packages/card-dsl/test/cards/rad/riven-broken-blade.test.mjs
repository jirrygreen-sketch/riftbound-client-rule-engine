import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/riven-broken-blade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { fixture as chainFixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-92a8f107905f2dafc89ae0242541a797fd2b39c572e28a280cde2e6ef343444f";
const SOURCE_TEXT =
  "When I become exhausted, choose one that hasn't been chosen this turn —\n" +
  "[Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)" +
  "Spend my buff to [Stun] an enemy unit. (It doesn't deal combat damage this turn.)" +
  "Spend my buff to ready me.";

const SELF = "riven-broken-blade.self";
const ENEMY = "riven-broken-blade.enemy-unit";

const [triggered] = program.abilities;
const [choose] = triggered.body;
const modes = choose.args.modes.value;
const buffMode = modes.find((mode) => mode.id === "riven-broken-blade.buff-mode");
const stunMode = modes.find((mode) => mode.id === "riven-broken-blade.stun-mode");
const readyMode = modes.find((mode) => mode.id === "riven-broken-blade.ready-mode");

/** Strip instruction-level TargetSpecs: Finalize locks those in production. */
function lockedBody(body) {
  return body.map(({ targets, picks, ...rest }) => rest);
}

function runMode(modeId, { buffs = 0 } = {}) {
  const clone = JSON.parse(JSON.stringify(triggered.body));
  clone[0].args.modes.value = clone[0].args.modes.value.map((mode) => ({ ...mode, body: lockedBody(mode.body) }));
  const kernel = world()
    .unit("riven", { might: 4, buffs, exhausted: true })
    .unit("enemy", { owner: "B", controller: "B", might: 3 })
    .build();
  const scoped = kernel.clone({
    source: kernel.ref("riven"),
    sourceSnapshot: kernel.getObject("riven")
  });
  scoped.setTargets(SELF, [scoped.ref("riven")]);
  scoped.setTargets(ENEMY, [scoped.ref("enemy")]);
  scoped.setAnswers({ "riven-broken-blade.choose/mode%3A0": modeId });
  return { outcome: runAbilityBody(clone, scoped), scoped };
}

test("rad-043-167 Riven, Broken Blade: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-043-167 Riven, Broken Blade: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /choice\.exclusive-once-per-turn/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /success-gated/);
  // The reason must name the merged code that rejects each half, not task ids.
  assert.match(program.judgeReason, /linkedTo/);
  assert.match(program.judgeReason, /choice-plan/);
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-043-167 Riven, Broken Blade: the object-exhausted trigger owns a single three-mode choice", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-exhausted");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-exhausted",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  assert.equal(choose.id, "riven-broken-blade.choose");
  assert.equal(choose.op, "choice.mode");
  assert.deepEqual(choose.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(choose.args.different, { kind: "constant", value: true });
  assert.equal(choose.args.modes.kind, "constant");
  assert.deepEqual(modes.map((mode) => mode.id), [
    "riven-broken-blade.buff-mode",
    "riven-broken-blade.stun-mode",
    "riven-broken-blade.ready-mode"
  ]);
  // 契约 3.9："可以……" 用 choice.optional 包住 body；本卡是"choose one"（choice.mode）。
  assert.equal(choose.linkedTo, undefined);
});

test("rad-043-167 Riven, Broken Blade: normal trigger binding translates and validates the nested self anchor", () => {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const registry = new ProgramRegistry([lifted]);
  const source = world()
    .unit("riven", { cardId: CANONICAL })
    .build()
    .getObject("riven");
  const [registration] = triggerRegistrations(registry, source);

  assert.deepEqual(registration.spec.filter, {
    event: "object-exhausted",
    object: { objectId: "riven" }
  });
  assert.equal(validateTriggerSpec(registration.spec).ok, true);
});

test("rad-043-167 Riven, Broken Blade: the Buff mode targets this unit and places one Buff (CR 702.2.a)", () => {
  assert.equal(buffMode.body.length, 1);
  const [buff] = buffMode.body;
  assert.equal(buff.id, "riven-broken-blade.buff-me");
  assert.equal(buff.op, "effect.buff");
  assert.deepEqual(buff.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buff.args.target, { kind: "constant", value: SELF });
  assert.deepEqual(buff.targets, [
    { id: SELF, filter: { type: "unit", object: "self" }, min: 1, max: 1, selection: "one" }
  ]);
  assert.equal(buff.linkedTo, undefined);
});

test("rad-043-167 Riven, Broken Blade: the Stun mode spends the Buff then stuns an enemy unit", () => {
  assert.equal(stunMode.body.length, 2);
  const [spend, stun] = stunMode.body;
  assert.equal(spend.id, "riven-broken-blade.spend-buff-for-stun");
  assert.equal(spend.op, "effect.buff");
  assert.deepEqual(spend.args.mode, { kind: "constant", value: "spend" });
  assert.deepEqual(spend.args.target, { kind: "constant", value: SELF });

  assert.equal(stun.id, "riven-broken-blade.stun-enemy");
  assert.equal(stun.op, "effect.stun");
  assert.equal(stun.linkedTo, "riven-broken-blade.spend-buff-for-stun");
  assert.deepEqual(stun.args.target, { kind: "constant", value: ENEMY });
  assert.deepEqual(stun.targets, [
    { id: ENEMY, filter: { type: "unit", controller: "opponent", zone: "board" }, min: 1, max: 1, selection: "one" }
  ]);
});

test("rad-043-167 Riven, Broken Blade: the ready mode spends the Buff then readies the source", () => {
  assert.equal(readyMode.body.length, 2);
  const [spend, ready] = readyMode.body;
  assert.equal(spend.id, "riven-broken-blade.spend-buff-for-ready");
  assert.equal(spend.op, "effect.buff");
  assert.deepEqual(spend.args.mode, { kind: "constant", value: "spend" });
  assert.equal(ready.id, "riven-broken-blade.ready-me");
  assert.equal(ready.op, "effect.ready");
  assert.equal(ready.linkedTo, "riven-broken-blade.spend-buff-for-ready");
  assert.deepEqual(ready.args.objects, { kind: "constant", value: { kind: "source" } });
});

test("rad-043-167 Riven, Broken Blade golden: the Buff mode really places one buff counter", () => {
  const { outcome, scoped } = runMode("riven-broken-blade.buff-mode", { buffs: 0 });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["riven-broken-blade.buff-me", "executed"],
      ["riven-broken-blade.choose", "executed"]
    ]
  );
  assert.equal(scoped.getObject("riven").buffs, 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["buff"]);
});

test("rad-043-167 Riven, Broken Blade golden: the Stun mode spends the Buff and really stuns the enemy (CR 424.1)", () => {
  const { outcome, scoped } = runMode("riven-broken-blade.stun-mode", { buffs: 1 });

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(scoped.getObject("riven").buffs, 0);
  assert.equal(scoped.getObject("enemy").stunned, true);
  assert.deepEqual(outcome.events.map((event) => event.action), ["spend-buff", "stun"]);
});

test("rad-043-167 Riven, Broken Blade golden: the ready mode spends the Buff and readies the source (CR 416.1)", () => {
  const { outcome, scoped } = runMode("riven-broken-blade.ready-mode", { buffs: 1 });

  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("riven").buffs, 0);
  assert.equal(scoped.getObject("riven").exhausted, false);
  assert.deepEqual(outcome.events.map((event) => event.action), ["spend-buff", "ready"]);
});

test("rad-043-167 Riven, Broken Blade golden: without a Buff the spend is a legal no-op (CR 702.2.b.1)", () => {
  const { outcome, scoped } = runMode("riven-broken-blade.buff-mode", { buffs: 1 });

  // 702.3.a：已有 Buff 的单位仍是合法选择，只是不再新增。
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(scoped.getObject("riven").buffs, 1);
});

test.todo(
  "rad-043-167 Riven, Broken Blade: record the per-turn chosen-mode receipt so each mode can be chosen only once this " +
    "turn (CR 303 / 319) — choice.exclusive-once-per-turn has no merged implementation (no assigned task)"
);
test.todo(
  "rad-043-167 Riven, Broken Blade: make spending the Buff an in-instruction cost ([do X] to [do Y], CR 355.10.c.1 / " +
    "404.1.b.1) so a failed spend blocks the Stun / ready branch — the cost plan pays spend-buff but no " +
    "in-instruction cost.pay path is merged — cost.pay itself is merged, the open piece is the success-gated " +
    "payment body (cost/kinds/README.md contract change request #2)"
);

test("rad-043-167 Riven, Broken Blade: without a Buff the linkedTo Stun still lands (no payment gate)", () => {
  // CR 355.10.c.1 / 404.1.b.1: the spend is what the printed text requires before
  // the Stun, but the merged interpreter continues linked instructions after a
  // negated one (contract 3.4). This is the exact defect judgeReason names.
  const { outcome, scoped } = runMode("riven-broken-blade.stun-mode", { buffs: 0 });

  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["riven-broken-blade.spend-buff-for-stun", "negated", "skipped"],
      ["riven-broken-blade.stun-enemy", "executed", null],
      ["riven-broken-blade.choose", "executed", null]
    ]
  );
  assert.equal(scoped.getObject("riven").buffs, 0);
  assert.equal(scoped.getObject("enemy").stunned, true, "the Stun resolves with no Buff paid");
});

test("rad-043-167 Riven, Broken Blade: without a Buff the linkedTo ready still lands (no payment gate)", () => {
  const { outcome, scoped } = runMode("riven-broken-blade.ready-mode", { buffs: 0 });

  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["riven-broken-blade.spend-buff-for-ready", "negated", "skipped"],
      ["riven-broken-blade.ready-me", "executed", null],
      ["riven-broken-blade.choose", "executed", null]
    ]
  );
  assert.equal(scoped.getObject("riven").exhausted, false, "the ready resolves with no Buff paid");
});

test("rad-043-167 Riven, Broken Blade: the choice.mode body is rejected by the merged chain Finalize", () => {
  // CR 355.3: this is the second, currently fatal blocker — the production chain
  // refuses to finalize any choice.mode until the choice-plan adapter exists.
  const fixture = chainFixture();
  const source = fixture.kernel.getObject("source");
  fixture.engine.pipeline.registerTrigger({
    id: "riven-broken-blade",
    source,
    controller: "A",
    spec: { at: "object-exhausted", filter: {} },
    body: triggered.body,
    optional: false,
    activeZones: ["board"]
  });
  fixture.engine.pipeline.emit({ timingPoint: "object-exhausted", object: source });
  assert.equal(fixture.engine.items.length, 1);

  assert.throws(
    () => fixture.engine.advance(),
    (error) => error.status === "blocked" &&
      /Mode choices require a Finalize\/Resolve choice-plan adapter/.test(error.message)
  );
});
