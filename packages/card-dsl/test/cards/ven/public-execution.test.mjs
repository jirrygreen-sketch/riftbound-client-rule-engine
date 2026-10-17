import flowDefinition from "../../../../engine-core/dist/effects/keywords/Flow.js";
import { buildCostPlan, payCostPlan, DUEL_DOMAINS } from "../../../../engine-core/dist/cost/index.js";
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/public-execution.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-c0e71d5f247d83c5854d4a20f7ece28e38086a6726e768eae11da9b47b22991b";
const SOURCE_TEXT =
  "Choose a friendly unit. Kill an enemy unit with less Might than it.\n" +
  "[Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)";
const FRIENDLY = "public-execution.friendly-unit";
const ENEMY = "public-execution.enemy-unit";

const [flowKeyword, play] = program.abilities;
const [killLesserEnemy] = play.body;
const [friendlySpec, enemySpec] = killLesserEnemy.targets;

/**
 * The reference kernel compares "self"/"opponent" filters literally, while the
 * production chain query path (chain/engine.ts) normalizes them against the
 * item's controller. Reproduce that normalization so the card's own query shape
 * is what executes; nothing else about the instruction is rewritten.
 */
function chainKernel(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

/** A spell source on the Chain plus one friendly and one enemy unit. */
const board = ({ friendlyMight = 4, enemyMight = 2 } = {}) => world()
  .object("execution", { owner: "A", controller: "A", types: ["spell"], zone: "chain" })
  .unit("friendly-unit", { owner: "A", controller: "A", might: friendlyMight })
  .unit("enemy-unit", { owner: "B", controller: "B", might: enemyMight })
  .build();

test("ven-154-166 Public Execution: program passes validateCardProgram as judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-154-166 Public Execution: judgeReason names the relative-Might target predicate and the Flow gap", () => {
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /mightLessThanTarget/);
  assert.match(program.judgeReason, /target\/target-plan/);
  assert.match(program.judgeReason, /Flow/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.ok(!/RIFT-266/.test(program.judgeReason));
});

test("ven-154-166 Public Execution: [Flow] is declared as a keyword, not re-implemented", () => {
  // 829.1.c: the printed "Flow [Cost]" line is a keyword; its expansion (and the
  // printed 5 energy + 2 rainbow Power cost) is owned by effects/keywords/Flow.
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);
});

test("ven-154-166 Public Execution: one kill instruction whose two target specs are both chosen at Finalize", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(killLesserEnemy.id, "public-execution.kill-lesser-enemy");
  assert.equal(killLesserEnemy.op, "effect.kill");
  assert.equal(killLesserEnemy.linkedTo, undefined);
  assert.equal(killLesserEnemy.picks, undefined);
  assert.deepEqual(killLesserEnemy.args, {
    target: { kind: "constant", value: ENEMY }
  });
  // 355.5 / 355.8 / 355.12: "Choose …" names specific objects, so both are
  // targets and both are locked as the spell is finalized; the may/counter style
  // linkedTo form is not used.
  assert.equal(killLesserEnemy.targets.length, 2);
  assert.deepEqual(friendlySpec, {
    id: FRIENDLY,
    filter: { type: "unit", zone: "board", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // 355.9.b / 143.2.a: "with less Might than it" is a relative targeting
  // restriction. The key below is descriptive only — no merged predicate reads
  // it (see judgeReason), so this group must not be treated as finalizable.
  assert.deepEqual(enemySpec, {
    id: ENEMY,
    filter: {
      type: "unit",
      zone: "board",
      controller: "opponent",
      mightLessThanTarget: FRIENDLY
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-154-166 Public Execution: the kill re-checks the relative Might condition at resolve time", () => {
  // 359.3.e.2: at resolve the spell confirms the target still meets the
  // restriction. The same comparison is written as an instruction-level
  // condition so a target that lost the restriction is not killed, and the
  // Might of both objects is read as their effective (layer-calculated) value.
  assert.equal(killLesserEnemy.condition.kind, "compare");
  assert.equal(killLesserEnemy.condition.operator, "lt");
  assert.deepEqual(killLesserEnemy.condition.left, {
    kind: "object-property",
    object: { target: ENEMY },
    property: "might"
  });
  assert.deepEqual(killLesserEnemy.condition.right, {
    kind: "object-property",
    object: { target: FRIENDLY },
    property: "might"
  });
});

test("ven-154-166 Public Execution golden: a weaker enemy unit is killed through the merged primitive", () => {
  const kernel = board({ friendlyMight: 4, enemyMight: 2 });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("execution") });
  scoped.setTargets(FRIENDLY, [kernel.ref("friendly-unit")]);
  scoped.setTargets(ENEMY, [kernel.ref("enemy-unit")]);

  const outcome = resolveChainBody(play.body, chainKernel(scoped));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["public-execution.kill-lesser-enemy", "executed"]]
  );
  // 429.1 / 429.2.a: kill moves the permanent from the Board to its owner's Trash.
  assert.equal(scoped.getObject("enemy-unit").zone, "trash");
  assert.equal(scoped.getObject("friendly-unit").zone, "board");
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
  assert.deepEqual(outcome.linkedValues["public-execution.kill-lesser-enemy.killed"], [
    kernel.ref("enemy-unit")
  ]);
});

test("ven-154-166 Public Execution golden: an enemy without less Might is not killed (fail-closed relative check)", () => {
  const kernel = board({ friendlyMight: 4, enemyMight: 6 });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("execution") });
  scoped.setTargets(FRIENDLY, [kernel.ref("friendly-unit")]);
  scoped.setTargets(ENEMY, [kernel.ref("enemy-unit")]);

  const outcome = resolveChainBody(play.body, chainKernel(scoped));

  // The condition guards the instruction (contract 3.4: a condition applies
  // only to its own instruction); a skipped condition is a negated instruction,
  // and the target survives.
  assert.deepEqual(
    outcome.results.map((entry) => [entry.result.status, entry.result.reason]),
    [["negated", "skipped"]]
  );
  assert.equal(scoped.getObject("enemy-unit").zone, "board");
  assert.deepEqual(scoped.events.filter((event) => event.action === "kill"), []);
});

test("ven-154-166 Public Execution golden: equal Might is not 'less Might' either", () => {
  const kernel = board({ friendlyMight: 5, enemyMight: 5 });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("execution") });
  scoped.setTargets(FRIENDLY, [kernel.ref("friendly-unit")]);
  scoped.setTargets(ENEMY, [kernel.ref("enemy-unit")]);

  const outcome = resolveChainBody(play.body, chainKernel(scoped));

  assert.deepEqual(
    outcome.results.map((entry) => [entry.result.status, entry.result.reason]),
    [["negated", "skipped"]]
  );
  assert.equal(scoped.getObject("enemy-unit").zone, "board");
});

test("ven-154-166 Public Execution golden: a locked enemy unit that already left the Board is ignored", () => {
  const kernel = board({ friendlyMight: 4, enemyMight: 2 });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("execution") });
  const stale = kernel.ref("enemy-unit");
  scoped.perform({ type: "move-zone", object: stale, to: "trash" });
  scoped.setTargets(FRIENDLY, [kernel.ref("friendly-unit")]);
  scoped.setTargets(ENEMY, [stale]);

  const outcome = resolveChainBody(play.body, chainKernel(scoped));

  // 359.3.e.2/e.7: a target that changed zones no longer satisfies the filter,
  // so the instruction is ignored rather than rebinding by id.
  assert.deepEqual(
    outcome.results.map((entry) => [entry.result.status, entry.result.reason]),
    [["ignored", "mistargeted"]]
  );
  assert.deepEqual(outcome.events, []);
});

test("ven-154-166 Public Execution golden: the kill primitive itself refuses a stale locked reference", () => {
  const kernel = board({ friendlyMight: 4, enemyMight: 2 });
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  const run = runInstruction(kill, { target: ENEMY }, {
    world: kernel,
    targets: { [ENEMY]: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo(
  "ven-154-166 Public Execution: 'an enemy unit with less Might than it' (355.9.b / 143.2.a) must be enforced while the " +
    "targets are chosen, not only at resolve — needs a relative-characteristic target predicate in the target/chain plan " +
    "(programs/filters.ts and target-plan relative predicates); today the descriptive mightLessThanTarget key " +
    "is evaluated by no merged code"
);

test.todo(
  "ven-154-166 Public Execution: the printed [Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: alternate cost and its " +
    "then-banish replacement (829.1.b/829.1.c) need the card-program -> KeywordDef params.cost forwarding, " +
    "Flow alternate-cost Finalize consumer, and replacement.event chain wiring"
);

test("ven-154-166 Public Execution: the merged Flow cost planner selects the printed 5 Energy and two any-domain Power", () => {
  const base = world().player("A", { energy: 5, power: ["Fury", "Calm"] })
    .card("execution", { zone: "trash", types: ["spell"], energy: 2, power: ["Body"] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("execution") });
  const cost = { kind: "explicit", energy: { kind: "constant", value: 5 },
    payments: [{ kind: "power", amount: { kind: "constant", value: 2 }, allowedDomains: DUEL_DOMAINS }] };
  const [declaration, replacement] = flowDefinition.expand({ host: { canonicalCardId: CARD_ID }, params: { cost } });
  assert.deepEqual(declaration.effect.cost, cost);
  assert.equal(declaration.effect.sourceZone, "trash");
  const plan = buildCostPlan(kernel, { id: "execution:flow", cost: { kind: "printed" },
    baseModifications: [{ id: "execution:flow", kind: "flow", cost: declaration.effect.cost }] });
  assert.equal(plan.total.energy, 5);
  assert.equal(plan.total.power.length, 1);
  assert.equal(plan.total.power[0].amount, 2);
  assert.deepEqual(plan.total.power[0].allowedDomains, DUEL_DOMAINS);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(receipt.actions[0].action.plan.power, ["Fury", "Calm"]);
  assert.equal(replacement.replaces.event, "object-leaves-chain");
  assert.equal(replacement.replaces.filter.leavingInstruction, false);
  assert.equal(replacement.with[0].op, "effect.banish");
});
