import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ahri-inquisitive.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";

const [attackAbility, defendAbility] = program.abilities;
const [debuffInstruction] = attackAbility.body;
const [targetSpec] = debuffInstruction.targets;
const c = value => ({ kind: "constant", value });

/** Bind only the relative opponent id for the reference kernel's scalar query.
 * The interpreter still receives the card's original sameLocationAs anchor.
 */
const withConcreteOpponent = (instruction, opponent) => ({
  ...instruction,
  targets: [
    {
      ...targetSpec,
      filter: { type: "unit", controller: opponent, sameLocationAs: "source" }
    }
  ]
});

test("Ahri, Inquisitive program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Ahri, Inquisitive identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-c68ef91624a369cffdc5c5e3f81ab2700878a51de07b1cde21bbfc25db8dea10"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /translateTriggerFilter/);
  assert.doesNotMatch(program.judgeReason, /sameLocationAs.*锚点也由绑定层解析/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.equal(
    program.sourceText,
    "When I attack or defend, give an enemy unit here -2 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: separate attack and defend triggers, each once per combat", () => {
  assert.equal(program.abilities.length, 2);

  // 383.4.e.1 / 383.4.f.1："When I attack" / "When I defend" 是两个具名触发能力。
  assert.equal(attackAbility.kind, "triggered");
  assert.equal(attackAbility.trigger.at, "attack-declared");
  assert.deepEqual(attackAbility.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(defendAbility.kind, "triggered");
  assert.equal(defendAbility.trigger.at, "defense-declared");
  assert.deepEqual(defendAbility.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });

  // 383.4.e.2.a / 383.4.f.2.a：每次战斗只检查一次条件。
  for (const ability of program.abilities) {
    assert.equal(ability.trigger.once, "per-combat");
    assert.equal(ability.optional, false);
  }
});

test("structure: -2 Might this turn with the printed minimum of 1, targeting an enemy unit here", () => {
  for (const ability of program.abilities) {
    assert.equal(ability.body.length, 1);
    const [debuff] = ability.body;
    assert.equal(debuff.op, "continuous.might");
    assert.deepEqual(debuff.args.amount, c(-2));
    assert.deepEqual(debuff.args.duration, c("this-turn"));
    assert.deepEqual(debuff.args.minimum, c(1));
    // RIFT-258 的 continuous.might：objects 用 target 选择符指名 Finalize 锁定的目标。
    assert.deepEqual(debuff.args.objects, c({ kind: "target", id: "ahri.enemy-unit-here" }));

    // 355.9.b / 355.10："an enemy unit" 是一个目标选择。
    assert.equal(debuff.targets.length, 1);
    const [target] = debuff.targets;
    assert.equal(target.id, "ahri.enemy-unit-here");
    assert.equal(target.selection, "one");
    assert.equal(target.min, 1);
    assert.equal(target.max, 1);
    assert.deepEqual(target.filter, {
      type: "unit",
      controller: "opponent",
      // 359.3.f："here" 是执行时读取的指称。
      sameLocationAs: "source"
    });
    assert.equal(debuff.picks, undefined);
    assert.equal(debuff.linkedTo, undefined);
  }
});

test.todo(
  "Ahri, Inquisitive: accept dynamic TargetSpec.location (location-of/source) in validateCardProgram before migrating here; the target-plan kernel supports it but shared validation still treats it as a LocationFilter (invalid-location-kind)."
);

test("Ahri, Inquisitive: here follows the live source after a real Move instead of its captured location (359.3.f.2)", () => {
  const kernel = world()
    .unit("ahri", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { might: 4, owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const sourced = kernel.clone({ sourceSnapshot: kernel.getObject("ahri") });
  sourced.setTargets(targetSpec.id, [sourced.ref("enemy-here")]);
  const moved = runInstruction(move, {
    objects: c("source"),
    to: c({ type: "battlefield", id: "bf-2" })
  }, { world: sourced });
  assert.equal(moved.result.status, "executed");
  assert.equal(sourced.source.location.id, "bf-1");
  assert.equal(sourced.getObject("ahri").location.id, "bf-2");

  const outcome = runAbilityBody([withConcreteOpponent(debuffInstruction, "B")], sourced);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(sourced.continuousEffects, []);
});

test("golden: a locked enemy unit that is no longer 'here' is mistargeted and ignored", () => {
  // 359.3.f.2 / 359.3.f.2.a：执行时 referent 不合法 → 该指令被忽略。这里用一个已
  // 经不在来源同一地点的目标（Finalize 锁定的对象仍存在，但 filter 不再满足）。
  const kernel = world()
    .unit("ahri", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { might: 4, owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const sourced = kernel.clone({ sourceSnapshot: kernel.getObject("ahri") });
  sourced.setTargets(targetSpec.id, [sourced.ref("enemy-elsewhere")]);

  const outcome = runAbilityBody([withConcreteOpponent(debuffInstruction, "B")], sourced);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(outcome.events, []);
});

test("golden: a locked enemy unit at the same location gets -2 Might this turn (RIFT-258)", () => {
  const kernel = world()
    .unit("ahri", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { might: 4, owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const sourced = kernel.clone({ sourceSnapshot: kernel.getObject("ahri") });
  sourced.setTargets(targetSpec.id, [sourced.ref("enemy-here")]);

  const outcome = runAbilityBody([withConcreteOpponent(debuffInstruction, "B")], sourced);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["ahri.debuff-attack", "executed"]]
  );
  // 478 / 478.1.a：Might 修改注册在 arithmetic 层，按 317.1.a 在回合末到期；
  // 479.4.b 把印刷下限 1 快照进 effect.minimum。
  assert.equal(sourced.continuousEffects.length, 1);
  const [registration] = sourced.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -2);
  assert.equal(registration.effect.effect.minimum, 1);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const engine = createLayerEngine(
    sourced.objects,
    sourced.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(engine.evaluate(sourced.ref("enemy-here")).might, 2);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(sourced.ref("enemy-here")).might, 4);
});

test("golden: the printed minimum of 1 clamps the reduction (479.4.b)", () => {
  const kernel = world()
    .unit("ahri", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-weak", { might: 2, owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const sourced = kernel.clone({ sourceSnapshot: kernel.getObject("ahri") });
  sourced.setTargets(targetSpec.id, [sourced.ref("enemy-weak")]);

  const outcome = runAbilityBody([withConcreteOpponent(debuffInstruction, "B")], sourced);
  assert.equal(outcome.status, "executed");
  // 2 Might 单位吃 -2(最小 1)：施加时快照为 -1，最终停在 1，而不是被压到 0。
  assert.equal(sourced.continuousEffects[0].effect.effect.amount, -1);
  const engine = createLayerEngine(
    sourced.objects,
    sourced.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(engine.evaluate(sourced.ref("enemy-weak")).might, 1);
});

test("Ahri, Inquisitive: the defense body applies its own -2 effect and expires at turn end", () => {
  const kernel = world()
    .unit("ahri", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { might: 5, owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly-here", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const sourced = kernel.clone({ sourceSnapshot: kernel.getObject("ahri") });
  sourced.setTargets(targetSpec.id, [sourced.ref("enemy-here")]);
  const outcome = runAbilityBody([withConcreteOpponent(defendAbility.body[0], "B")], sourced);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].id, "ahri.debuff-defense");
  const engine = createLayerEngine(
    sourced.objects,
    sourced.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(engine.evaluate(sourced.ref("enemy-here")).might, 3);
  assert.equal(engine.evaluate(sourced.ref("friendly-here")).might, 4);
  assert.equal(engine.evaluate(sourced.ref("ahri")).might, 3);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(sourced.ref("enemy-here")).might, 5);
});

test.todo(
  "Ahri, Inquisitive: emit attack-declared/defense-declared from the atomic combat-start/designation transaction (CR 466.2), and bind the sameLocationAs:source target dynamically through programs/filters.ts (359.3.f)."
);
