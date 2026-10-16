import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import standUnited from "../../../dist/cards/ogn/stand-united.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-40071acacac7084766aaea4ce4329db5541d659f9ec5225d9dc853542a456664";

const [hidden, action, play] = standUnited.abilities;
const [buffInstruction, extraMight] = play.body;
const evaluatedBuffArgs = { mode: "buff", target: buffInstruction.args.target.value };

test("Stand United program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(standUnited);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Stand United identity, ruleset, status and printed text", () => {
  assert.equal(standUnited.canonicalCardId, CANONICAL);
  assert.equal(standUnited.rulesetVersion, "core-1.5");
  assert.equal(standUnited.status, "judge-required");
  assert.match(standUnited.judgeReason, /continuous\.might/);
  assert.match(standUnited.judgeReason, /addContinuous/);
  assert.match(standUnited.judgeReason, /811\.2/);
  assert.equal(cardRegistryById.get(standUnited.canonicalCardId), standUnited);
  assert.equal(
    standUnited.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Buff a friendly unit. Buffs give an additional +1 :rb_might: to friendly units this turn. " +
      "(To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)"
  );
});

test("Stand United declares the printed [Hidden] and [Action] keywords (CR 811 / 806)", () => {
  assert.equal(standUnited.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(hidden.value, undefined);
  assert.equal(action.value, undefined);
});

test("Stand United body: a merged Buff instruction plus the unmerged Buff Might modifier", () => {
  assert.equal(play.body.length, 2);
  assert.equal(buffInstruction.id, "buff-friendly-unit");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "friendly-unit" }
  });
  assert.deepEqual(buffInstruction.targets, [
    {
      id: "friendly-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(buffInstruction.linkedTo, undefined);

  assert.equal(extraMight.id, "buffs-give-additional-might");
  assert.equal(extraMight.op, "continuous.might");
  assert.deepEqual(extraMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(extraMight.args.duration, { kind: "constant", value: "this-turn" });
  // 811.2's Stand United example: the second sentence covers every friendly
  // unit with a Buff, regardless of location, so it is an each-set with a
  // "has a buff" filter rather than the first sentence's target.
  assert.deepEqual(extraMight.args.appliesTo, {
    kind: "constant",
    value: { type: "unit", controller: "controller", hasBuff: true }
  });
  assert.equal(extraMight.targets, undefined);
});

test("Stand United: the layers engine would apply an arithmetic Might modifier, but no opcode registers one", () => {
  // Evidence that the gap is the missing instruction-level entry point, not
  // the layer math: a correctly shaped registration is evaluated and its
  // end-of-turn lifetime is expirable, yet nothing under effects/instructions
  // calls ctx.addContinuous to produce one from a resolving spell.
  const kernel = world().unit("friendly-unit", { might: 2 }).build();
  const engine = createLayerEngine([kernel.getObject("friendly-unit")], [
    {
      effect: {
        id: "stand-united-test",
        layer: "arithmetic",
        filter: { type: "unit" },
        // The same ContinuousEffect shape Shield's merged expansion emits.
        effect: {
          kind: "continuous.might",
          mode: "add",
          appliesTo: "self",
          amount: { kind: "constant", value: 1 }
        }
      },
      duration: { type: "end-of-turn" }
    }
  ]);
  assert.equal(engine.evaluateAll()[0].might, 3);
  assert.deepEqual(engine.expireAt("turn-end"), ["stand-united-test"]);
  assert.equal(engine.evaluateAll()[0].might, 2);
});

test("Stand United golden: the Buff half places one Buff counter on the chosen unit (CR 427.1.b)", () => {
  const kernel = world().unit("friendly-unit", { might: 2 }).build();
  const target = kernel.ref("friendly-unit");
  const run = runInstruction(buff, evaluatedBuffArgs, {
    world: kernel,
    targets: { "friendly-unit": [target] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").buffs, 1);
  assert.equal(run.linked.buffedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["buff"]);
});

test("Stand United golden: a unit that already has a Buff is not buffed again (CR 427.1.b.1 / 702.3)", () => {
  const kernel = world().unit("friendly-unit", { might: 2, buffs: 1 }).build();
  const run = runInstruction(buff, evaluatedBuffArgs, {
    world: kernel,
    targets: { "friendly-unit": [kernel.ref("friendly-unit")] }
  });

  // Choosing a unit that already has a Buff stays legal; nothing extra is
  // placed and the "was buffed this way" result is false.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("friendly-unit").buffs, 1);
});

test("Stand United interpreter: the Buff half resolves and the Might modifier fails closed", () => {
  const kernel = world().unit("friendly-unit", { might: 2 }).build();
  // Finalize-time target locking is supplied to the kernel directly, exactly
  // as the production caller must (the reference kernel matches filters by
  // value and cannot resolve the pipeline's "controller" placeholder).
  const body = play.body.map(({ targets, ...rest }) => rest);
  kernel.setTargets("friendly-unit", [kernel.ref("friendly-unit")]);
  const before = kernel.getObject("friendly-unit").might;

  // The Buff instruction is reached first and really executes; the second
  // sentence is then rejected and throws, so the card cannot report a
  // completed resolution with a wrong Might total.
  assert.throws(() => runAbilityBody(body, kernel), /continuous\.might/);
  assert.equal(kernel.getObject("friendly-unit").buffs, 1);
  assert.equal(kernel.getObject("friendly-unit").might, before);
});

test.todo(
  "Stand United: 'Buffs give an additional +1 Might to friendly units this turn' (CR 703 rewritten for the " +
    "turn; 811.2 keeps the second sentence location-independent) - needs continuous.might with an " +
    "end-of-turn duration and a has-buff filter, registered by an instruction primitive (RIFT-9 primitive list; " +
    "the layers evaluation side already landed with RIFT-91)"
);

test.todo(
  "Stand United [Hidden]: hide for [A] and play from the facedown zone for [0] (CR 811.1.b / 811.1.c.2) - " +
    "needs the Hidden cost/zone workstream (RIFT-84)"
);
