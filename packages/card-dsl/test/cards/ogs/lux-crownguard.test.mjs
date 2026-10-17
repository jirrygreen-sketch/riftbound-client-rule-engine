import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { translateCost, translateRestriction } from "../../../../engine-core/dist/programs/play.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import program from "../../../dist/cards/ogs/lux-crownguard.js";

const CANONICAL =
  "card.hash-6f9f9006a5d35f01fe282aeeb87157def728c3d5ae72e9d0eb39f4f0e496b14e";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction] — [Add] :rb_energy_2:. Use only to play spells. (Abilities that add resources can't be reacted to.)";

const [ability] = program.abilities;
const [instruction] = ability.body;

test("ogs-014-024 Lux, Crownguard: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-014-024 Lux, Crownguard: judgeReason names restricted resource accounting", () => {
  assert.match(program.judgeReason, /only to play spells/);
  assert.match(program.judgeReason, /受限资源|restricted share|份额/);
  assert.match(program.judgeReason, /ARG_KEYS/);
  assert.match(program.judgeReason, /add-usage/);
});

test("ogs-014-024 Lux, Crownguard: Reaction-speed activated ability pays exhaust and adds 2 energy", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // CR 813.1.c/813.1.d: a Reaction tag on an activated ability.
  assert.equal(ability.timing, "reaction");
  assert.deepEqual(ability.cost, {
    kind: "cost.activated",
    payments: [{ kind: "exhaust" }]
  });
  assert.deepEqual(ability.restriction, {
    kind: "add-usage",
    value: { kind: "constant", value: "spell-energy-costs-only" }
  });

  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "lux-crownguard.add-energy");
  assert.equal(instruction.op, "effect.resources");
  assert.deepEqual(instruction.args.energy, { kind: "constant", value: 2 });
  assert.equal(instruction.args.power, undefined);
  assert.deepEqual(instruction.args.usage, { kind: "constant", value: "spell-energy-costs-only" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogs-014-024 Lux, Crownguard: cost.activated normalizes to the activated payment plan", () => {
  assert.deepEqual(translateCost(ability.cost, CANONICAL, "activate"), {
    kind: "activated",
    payments: [{ kind: "exhaust" }]
  });
});

test("ogs-014-024 Lux, Crownguard: the Add instruction credits 2 energy to the controller's rune pool", () => {
  const kernel = world().player("A", { energy: 0, power: [] }).player("B", { energy: 0 }).build();
  const run = runInstruction(
    resources,
    // effect.resources takes Expr arguments (the merged primitive's schema);
    // the card's Expr is passed through unchanged.
    { energy: instruction.args.energy },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 2);
  assert.equal(kernel.player("B").energy, 0);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 2, power: [] });
  assert.deepEqual(run.events.map(event => event.action), ["gain-energy"]);
});

test("ogs-014-024 Lux, Crownguard: a replacement hook can negate the Add without inventing a partial gain", () => {
  const kernel = world().player("A", { energy: 0 }).build();
  kernel.addReplacement(action => (action.type === "gain-energy" ? "replaced" : null));
  const run = runInstruction(
    resources,
    { energy: instruction.args.energy },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.player("A").energy, 0);
});

test.todo(
  "ogs-014-024 Lux, Crownguard: the 2 energy added is tracked as a restricted share spendable only on spell " +
    "energy costs (CR 054.2, 163.1, 166.1, 430.2, 430.3) — continuous.restrict registers " +
    "prohibit/require/permit/limit/applied-cost modes but has no added-resource restricted-share channel, " +
    "and effect.resources only merges energy into one balance; a global restriction or an ignored " +
    "restriction is not acceptable"
);

test("ogs-014-024 Lux, Crownguard golden: the card's own Add args are rejected for the unsupported usage key", () => {
  // 复核 2026-10-17: the merged effect.resources schema has no restricted-share
  // channel, so the card's own body fails before any energy is credited.
  const kernel = world().player("A", { energy: 0 }).build();
  assert.throws(
    () => runInstruction(resources, instruction.args, { world: kernel }),
    /Invalid effect\.resources Expr argument: usage/
  );
  assert.equal(kernel.player("A").energy, 0);
  // Dropping usage only merges the energy into the shared pool, which is not the
  // printed restriction (054.2): the same balance would pay non-spell costs.
  const unrestricted = runInstruction(resources, { energy: instruction.args.energy }, { world: kernel });
  assert.equal(unrestricted.result.status, "executed");
  assert.equal(kernel.player("A").energy, 2);
  assert.equal(unrestricted.linked.resources.usage, undefined);
});

test("ogs-014-024 Lux, Crownguard golden: the printed add-usage restriction has no rules adapter", () => {
  // programs/play.ts translates ability.restriction before Finalize; `add-usage`
  // is neither a Condition kind nor carried by a condition field, so the
  // production play binding fails closed instead of silently dropping the
  // printed "only to play spells" restriction.
  assert.throws(
    () => translateRestriction(ability.restriction, CANONICAL),
    (error) => error instanceof ProgramBindingError &&
      /add-usage needs a rules adapter/.test(error.message)
  );
});
