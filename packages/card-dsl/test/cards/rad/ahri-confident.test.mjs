import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ahri-confident.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import disarm from "../../../../engine-core/dist/effects/keywords/Disarm.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-b5c30bb9570eb87f81c02526593c66f04d242c43ca13f9e3f0e38ed148fe62c1";
const SOURCE_TEXT =
  "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
  "When you reduce the Might of an enemy unit here by 1 or more, give me +1 :rb_might: this turn.";

const [keyword, triggered] = program.abilities;
const [instruction] = triggered.body;

test("rad-038-167 Ahri, Confident: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-038-167 Ahri, Confident: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README 第 2 节：judgeReason 要写清缺哪个 op、哪条规则、依赖哪个任务。
  assert.match(program.judgeReason, /might-changed/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-038-167 Ahri, Confident: unvalued Disarm keyword (831.1.c.3 default 1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "disarm" });
  assert.equal(keyword.value, undefined);
});

test("rad-038-167 Ahri, Confident: might-changed trigger filters a here-and-now reduction", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "might-changed");
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.trigger.filter, {
    event: "might-changed",
    filter: {
      type: "unit",
      controller: "opponent",
      sameLocationAs: "self",
      mightChanged: "decreased",
      amount: { gte: 1 }
    }
  });
});

test("rad-038-167 Ahri, Confident: +1 Might this turn is authored as an arithmetic-layer effect on self", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(instruction.id, "ahri-confident.give-me-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // “me” is the ability host: the contract 3.6 appliesTo: "self" spelling, not a
  // fabricated TargetSpec whose filter would carry object: "self".
  assert.deepEqual(instruction.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-038-167 Ahri, Confident golden: the +1 Might body registers an end-of-turn arithmetic effect", () => {
  const kernel = world().unit("ahri", { might: 4 }).unit("enemy", { owner: "B", controller: "B", might: 3 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ahri") });

  const outcome = runAbilityBody(triggered.body, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["ahri-confident.give-me-might", "executed"]
  ]);
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);

  const layers = createLayerEngine(
    [scoped.getObject("ahri"), scoped.getObject("enemy")],
    scoped.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(layers.evaluate(scoped.ref("ahri")).might, 5);
  assert.equal(layers.evaluate(scoped.ref("enemy")).might, 3);
  assert.equal(scoped.getObject("ahri").buffs, 0);
});

test("rad-038-167 Ahri, Confident: the merged binding accepts the authored body and the printed Disarm", () => {
  // RIFT-257 的 programs 绑定已合入：+1 [M] 的 appliesTo:self 体通过指令翻译，
  // 声明与快照上的 Disarm 都进入展开管线。
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const source = { ...world().unit("ahri", { might: 4 }).build().getObject("ahri"), cardId: CANONICAL };
  const expanded = binding.inspect(source);
  const kinds = expanded.abilities.map(ability => ability.kind === "static" ? ["static", ability.effect.kind] : [ability.kind, ability.trigger?.at ?? ability.keyword]);
  // 声明顺序：keyword disarm、triggered might-changed（卡面），随后是 Disarm 展开的 attack-declared。
  assert.deepEqual(kinds, [
    ["keyword", "disarm"],
    ["triggered", "might-changed"],
    ["triggered", "attack-declared"]
  ]);
});

test("rad-038-167 Ahri, Confident golden: the merged Disarm 1 expansion applies -1 Might to the chosen enemy here", () => {
  const [expanded] = disarm.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.trigger.at, "attack-declared");
  const [instruction] = expanded.body;
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.targets, [{
    id: "disarm.enemy-unit",
    filter: { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one"
  }]);

  const kernel = world()
    .unit("ahri", { might: 4 })
    .unit("enemy", { owner: "B", controller: "B", might: 2 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ahri") });
  scoped.setTargets("disarm.enemy-unit", [scoped.ref("enemy")]);
  // The reference kernel compares controller placeholders verbatim, so the
  // "opponent" anchor only resolves in the production target system; execute
  // the interpreter body without its TargetSpecs and feed the locked target
  // directly, the one-two-punch / orb-of-regret convention. The expansion's
  // own TargetSpec is asserted above instead.
  const outcome = runAbilityBody([{ ...instruction, targets: undefined }], scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  assert.equal(scoped.continuousEffects[0].effect.effect.amount, -1);

  const layers = createLayerEngine(
    [scoped.getObject("enemy")],
    scoped.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(layers.evaluate(scoped.ref("enemy")).might, 1);
});


test.todo(
  "rad-038-167 Ahri, Confident: attack-declared must be emitted by the combat role transaction " +
    "(combat/flow.ts still throws combat-start-transaction, CR 466.2) before the Disarm trigger can fire"
);

test.todo(
  "rad-038-167 Ahri, Confident: might-changed must be emitted from layer recomputation (deriveMightChangedEmissions " +
    "has no production caller) and its event name must join EVENT_PATTERN_TYPES, with a payload predicate comparing " +
    "previousMight/currentMight so the +1 Might reward fires"
);

test.todo(
  "rad-038-167 Ahri, Confident: 'give an enemy unit here' needs a source-relative location anchor in the " +
    "merged trigger/instruction filter translator (translateObjectFilter rejects sameLocationAs), and the " +
    "Disarm reward needs the target system to resolve controller: opponent at Finalize"
);
