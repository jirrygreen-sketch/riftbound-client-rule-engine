import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ahri-inquisitive.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [attackAbility, defendAbility] = program.abilities;
const [debuffInstruction] = attackAbility.body;
const [targetSpec] = debuffInstruction.targets;
const c = value => ({ kind: "constant", value });

/**
 * "an enemy unit here" 的 filter 里，controller: "opponent" 与 sameLocationAs: "source"
 * 是选择管线占位符：生产管线在 Finalize 把 "opponent" 绑定成能力控制者的对手，
 * 解释器在执行时解析 sameLocationAs 锚点（359.3.f）。参考测试内核按值比较 controller，
 * 因此下面的执行用例像 assembly-rig / yone-blademaster 的 golden 一样，把占位符替换成
 * 具体对手 id 后跑同一原语与同一位置锚点，不复制结算逻辑。
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
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /359\.3\.f/);
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
    assert.deepEqual(debuff.args.target, c("ahri.enemy-unit-here"));

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

test("golden: a locked enemy unit at the same location passes target legality", () => {
  const kernel = world()
    .unit("ahri", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { might: 4, owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const sourced = kernel.clone({ sourceSnapshot: kernel.getObject("ahri") });
  sourced.setTargets(targetSpec.id, [sourced.ref("enemy-here")]);

  // continuous.might 尚未注册：目标合法性通过后才会触达原语分发，因此这里只断言
  // “未被 mistargeted 忽略”——未注册 opcode 会抛出，说明合法性检查已经通过。
  assert.throws(
    () => runAbilityBody([withConcreteOpponent(debuffInstruction, "B")], sourced),
    /Unregistered instruction opcode: continuous\.might/
  );
});

test.todo(
  "Ahri, Inquisitive: giving an enemy unit -2 Might this turn with the printed minimum of 1 clamp and " +
    "end-of-turn expiry (continuous.might + continuous.duration, RIFT-91; effect.buff is the 702–705 Buff " +
    "counter and cannot substitute)"
);
