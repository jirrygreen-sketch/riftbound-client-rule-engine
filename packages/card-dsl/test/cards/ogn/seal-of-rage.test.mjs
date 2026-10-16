import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/seal-of-rage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import effectResources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";

const CANONICAL = "card.hash-8ecba382226849757c2ac004a54b1ce00f2d0d303a1d99520e1855117bd7a161";

const [activated] = program.abilities;
const [addFury] = activated.body;

test("ogn-040-298 Seal of Rage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_fury:. " +
      "(Abilities that add resources can't be reacted to.)"
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Seal of Rage structure: reaction-speed exhaust ability that Adds 1 Fury power", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  // “[Reaction] —” on the ability: closed-state permission (CR v1.5 813.1.d / 813.2).
  assert.equal(activated.timing, "reaction");
  assert.equal(activated.restriction, undefined);
  assert.equal(activated.cost.kind, "activated");
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);

  assert.equal(activated.body.length, 1);
  assert.equal(addFury.id, "seal-of-rage.add-fury");
  assert.equal(addFury.op, "effect.resources");
  assert.equal(addFury.op, effectResources.op);
  // “[Add] :rb_rune_fury:.” — Add 1 Fury Power (CR 430.1 / 430.5).
  assert.deepEqual(addFury.args.power, { kind: "constant", value: ["Fury"] });
  assert.equal(addFury.args.linkKey, undefined);
  assert.equal(addFury.targets, undefined);
  assert.equal(addFury.picks, undefined);
  assert.equal(addFury.linkedTo, undefined);
});

test("Seal of Rage golden: effect.resources adds 1 Fury power to the controller's pool", () => {
  const base = world()
    .unit("seal-of-rage", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .player("A", { energy: 1, power: ["Calm"] })
    .player("B")
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("seal-of-rage") });

  const outcome = resolveChainBody(activated.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(kernel.player("A").power, ["Calm", "Fury"]);
  assert.deepEqual(kernel.player("B").power, []);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-power"]);
  assert.deepEqual(outcome.results[0].result.linkedValues.resources, {
    player: "A",
    energy: 0,
    power: ["Fury"]
  });
});

test("Seal of Rage golden: the exhaust cost plus the Add resolve together", () => {
  const base = world()
    .unit("seal-of-rage", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("seal-of-rage") });
  const plan = buildCostPlan(kernel, {
    id: "cost:seal-of-rage",
    cost: activated.cost
  });
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("seal-of-rage").exhausted, true);

  const outcome = resolveChainBody(activated.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.player("A").power, ["Fury"]);
  assert.equal(kernel.getObject("seal-of-rage").exhausted, true);
});

test.todo(
  "Seal of Rage: the [Reaction] permission itself (CR v1.5 813.1.d / 813.2: closed-state " +
    "activation) is expanded by the keyword registry into a continuous.timing static ability; " +
    "the card declares only its speed, and the production chain must read the granted timing " +
    "(RIFT-85 / RIFT-120)."
);
