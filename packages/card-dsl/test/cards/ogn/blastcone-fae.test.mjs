import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/blastcone-fae.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-5babb90d79192ee6ca892489ae07370b086c015b0a2db49d665b82be90f4fcc9";

test("Blastcone Fae program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /811/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "When you play me, give a unit -2 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
});

test("Blastcone Fae structure: Hidden keyword plus the printed self-play debuff", () => {
  assert.equal(program.abilities.length, 2);
  const [hidden, triggered] = program.abilities;
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });

  // "give a unit -2 [M] this turn, to a minimum of 1 [M]": exactly one unit,
  // the printed -2 and the printed floor of 1 are both recorded.
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "blastcone-fae.give-minus-2");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(instruction.args.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });

  assert.equal(instruction.targets.length, 1);
  assert.deepEqual(instruction.targets[0], {
    id: "blastcone-fae.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("Blastcone Fae: the printed -2 Might with floor 1 executes through the merged continuous.might (478.1.c, 317.1.a)", () => {
  const [instruction] = program.abilities[1].body;
  const kernel = world()
    .unit("blastcone-fae", { owner: "A", controller: "A", might: 2 })
    .unit("marked-unit", { owner: "B", controller: "B", might: 2 })
    .build();
  const run = runInstruction(
    might,
    {
      amount: instruction.args.amount,
      duration: instruction.args.duration,
      minimum: instruction.args.minimum,
      target: "blastcone-fae.unit"
    },
    { world: kernel, targets: { "blastcone-fae.unit": [kernel.ref("marked-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });

  // 478 layer arithmetic with the printed floor: 2 Might - 2 ends at 1, not 0.
  const engine = createLayerEngine(
    [kernel.getObject("marked-unit")],
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("marked-unit")).might, 1);
  // 317.2.c: the modification expires at the end of the turn.
  engine.advance({ id: "turn-end" });
  assert.equal(engine.evaluate(kernel.ref("marked-unit")).might, 2);
});

test.todo(
  "Blastcone Fae: register the triggered body from the static CardProgram so the -2 Might fires on card-played " +
    "(RIFT-257 CardProgram -> chain/pipeline binding)"
);

test.todo(
  "Blastcone Fae [Hidden] (811): Hide for one rainbow rune, play from facedown for 0, plus the 811.1.d.3 targeting " +
    "restriction that its play effect must choose units at the battlefield it was played to (RIFT-261 cost.hidden/cost.pay / RIFT-90)"
);
