import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vaults-of-helia.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import continuousCostModification from "../../../../engine-core/dist/effects/instructions/continuous.cost-modification.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";

const CANONICAL_ID =
  "card.hash-0b929c2c78280ff14e852a6d803fa3e55251591cfc73088ec115c83af1360d7e";
const SOURCE_TEXT =
  "When you hold here, your non-token units cost :rb_energy_1: more to play this turn.";

const [ability] = program.abilities;
const [increase] = ability.body;

/** A real merged cost plan for a printed-3 unit with the +1 Energy increase installed. */
function planWithCardIncrease(energy) {
  const base = world().hand("source", { types: ["unit"], energy }).build();
  const ctx = base.clone({ sourceSnapshot: base.object(base.ref("source")) });
  return buildCostPlan(ctx, {
    id: "play",
    cost: { kind: "printed" },
    printed: { id: "unit", cardType: "Unit", domains: ["Colorless"], energy, power: 0 },
    increases: [
      {
        id: "vaults-of-helia",
        cost: { kind: "explicit", energy: { kind: "constant", value: 1 } }
      }
    ]
  });
}

test("unl-219-219 Vaults of Helia: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-219-219 Vaults of Helia: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\/buildCostPlan/);
  assert.match(program.judgeReason, /356\.3/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.match(program.judgeReason, /hold/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-219-219 Vaults of Helia: hold trigger for this Battlefield's controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.d / 383.4.d.2.b: a Hold Effect; "here" is this Battlefield (053.3)
  // and "you" its controller (190.6.d). No "may": the trigger is mandatory.
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, {
    event: "held",
    here: true,
    player: "controller"
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("unl-219-219 Vaults of Helia: one +1 Energy increase for the controller's non-token units", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(increase.id, "vaults-of-helia.increase-unit-cost");
  // 356.3: a play-cost increase, not a resolution-time resource action; the
  // primitive registers a future arithmetic-layer modification.
  assert.equal(increase.op, "continuous.cost-modification");
  assert.deepEqual(increase.args.resource, { kind: "constant", value: "energy" });
  assert.deepEqual(increase.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(increase.args.appliesTo, { kind: "constant", value: "play-cost" });
  assert.deepEqual(increase.args.duration, { kind: "constant", value: "this-turn" });
  // 185.1.a / 185.3.a.1: the printed scope is non-token units controlled by the
  // hold's player, which the declared filter records.
  assert.deepEqual(increase.args.filter.value, {
    type: "unit",
    controller: "controller",
    isToken: false
  });
  assert.equal(increase.targets, undefined);
  assert.equal(increase.picks, undefined);
  assert.equal(increase.linkedTo, undefined);
});

test("unl-219-219 Vaults of Helia: the announced increase really raises a merged cost plan", () => {
  // The merged cost plan supports the 356.3 increase stage; installing that
  // increase is the judged part. The golden proves the arithmetic this card
  // announces: a printed-3 unit costs 4, and the printed cost stays intact
  // (206: cost queries use the printed/copied cost).
  const plan = planWithCardIncrease(3);
  assert.equal(plan.total.energy, 4);
  assert.equal(plan.printed.energy, 3);
  const component = plan.components.find(entry => entry.id === "vaults-of-helia");
  assert.equal(component.stage, "increase");
  assert.equal(component.cost.energy, 1);
  assert.equal(component.cost.power.length, 0);
  assert.deepEqual(component.original, { energy: 1, power: [], xp: 0, actions: [] });
});

test("unl-219-219 Vaults of Helia golden: the merged continuous cost primitive registers the non-token-unit increase", () => {
  const kernel = world()
    .player("A", { energy: 10 })
    .card("vaults", { types: ["battlefield"], zone: "board", controller: "A", owner: "A" })
    .hand("unit", { types: ["unit"], zone: "hand", controller: "A", owner: "A", energy: 3, power: [] })
    .hand("token-unit", { types: ["unit"], zone: "hand", controller: "A", owner: "A", energy: 3, power: [], isToken: true })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("vaults"), controller: "A" });
  const run = runInstruction(continuousCostModification, increase.args, { world: context });
  assert.equal(run.result.status, "executed");
  assert.equal(context.continuousEffects.length, 1);

  const registry = new ContinuousEffectRegistry();
  for (const entry of context.continuousEffects) registry.register(entry.effect, entry.duration);
  const unitContext = context.clone({ sourceSnapshot: context.getObject("unit"), controller: "A" });
  const tokenContext = context.clone({ sourceSnapshot: context.getObject("token-unit"), controller: "A" });
  assert.equal(finalizeCostPlan(unitContext, { id: "unit-play", cost: { kind: "printed" } }, { continuous: registry.list() }).total.energy, 4);
  assert.equal(finalizeCostPlan(tokenContext, { id: "token-play", cost: { kind: "printed" } }, { continuous: registry.list() }).total.energy, 3);

  assert.equal(registry.expireAt({ id: "turn-end" }, ref => context.object(ref)).length, 1);
  assert.equal(finalizeCostPlan(unitContext, { id: "unit-after-turn", cost: { kind: "printed" } }, { continuous: registry.list() }).total.energy, 3);
});

test("unl-219-219 Vaults of Helia: the held event spelling is accepted but the here referent still blocks registration", () => {
  const source = world().card("vaults", { cardId: CANONICAL_ID, types: ["battlefield"], zone: "board", controller: "A", owner: "A" }).build().getObject("vaults");
  assert.throws(
    () => triggerRegistrations(new ProgramRegistry([program]), source),
    error => error?.code === "judge-required" && /Unsupported filter field here/.test(error.message)
  );
});

test.todo(
  "unl-219-219 Vaults of Helia: connect the held trigger's battlefield identity and install its " +
    "registered duration into the real scoring-to-Finalize path (053.3/356.3)"
);
