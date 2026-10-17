import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/blazing-scorcher.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import effectReady from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";

const CANONICAL_ID =
  "card.hash-0da93712208ccce43badde9998369ec8b785af649c804e812feb2bb580f2908c";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)";

test("ogn-001-298 Blazing Scorcher: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Blazing Scorcher supported cost planner charges the Accelerate component only when selected", () => {
  for (const selected of [false, true]) {
    const base = world().player("A", { energy: 10, power: ["Fury"] })
      .hand("scorcher", { energy: 5, power: ["Fury"], types: ["unit"] }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("scorcher") });
    const plan = buildCostPlan(kernel, {
      id: `scorcher:${selected}`,
      cost: { kind: "explicit", energy: { kind: "constant", value: 5 } },
      domains: ["Fury"],
      optionalAdditional: [{ id: "accelerate", kind: "accelerate", selected }]
    });
    assert.equal(plan.total.energy, selected ? 6 : 5);
    assert.deepEqual(plan.total.power, selected ? [{ amount: 1, allowedDomains: ["Fury"] }] : []);
    assert.deepEqual(plan.selectedAdditional, selected ? [{ id: "accelerate", kind: "accelerate" }] : []);
    assert.deepEqual(plan.declinedAdditional, selected ? [] : ["accelerate"]);
    assert.equal(payCostPlan(kernel, plan).paid, true);
    assert.equal(kernel.player("A").energy, selected ? 4 : 5);
  }
});

test("ogn-001-298 Blazing Scorcher: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-001-298 Blazing Scorcher: judgeReason names the missing wiring", () => {
  // CR 805.1.b / 805.1.b.1: the printed cost is [1][C], and this unit's Fury
  // domain constrains the Power portion. The keyword itself is not implementable
  // inside the card file, so the reason must name what is missing.
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /805\.1\.b\.1/);
  assert.match(program.judgeReason, /805\.2\.b/);
  assert.match(program.judgeReason, /费用\/替代管线/);
});

test("ogn-001-298 Blazing Scorcher: exactly one unvalued Accelerate keyword ability", () => {
  // CR 805.4: multiple instances of Accelerate are redundant, so the card
  // declares the keyword once and carries no numeric value (805.1.b prints a
  // fixed [1][C] cost, not a per-card X).
  assert.equal(program.abilities.length, 1);
  const [keyword] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "accelerate");
  assert.equal(keyword.value, undefined);
});

test("ogn-001-298 Blazing Scorcher: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Accelerate");
  assert.ok(registered, "effects/keywords/Accelerate.ts must be in the generated registry");
  // Card IR uses the lowercase keyword id required by validateCardProgram's
  // SYMBOL_PATTERN; the KeywordDef is indexed by the printed name (805.1).
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("805.1.b"));
  assert.ok(registered.ruleRefs.includes("805.6"));
});

test("ogn-001-298 Blazing Scorcher: the merged Accelerate enter-ready body readies the unit (CR 805.6)", () => {
  const host = { canonicalCardId: program.canonicalCardId };
  const [, replacement] = accelerate.expand({ host });
  const enterReady = replacement.with[0];
  assert.equal(enterReady.op, "effect.ready");

  const base = world().unit("blazing-scorcher", { exhausted: true, might: 5, types: ["unit"] }).build();
  // The caller must supply the host's current zone-bound reference for every
  // ability execution (interpreter README); the replacement body addresses the
  // unit through the symbolic "source" selector, so bind it as the source.
  const bound = base.clone({ sourceSnapshot: undefined, source: base.ref("blazing-scorcher") });
  const run = runInstruction(effectReady, enterReady.args, { world: bound });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
  assert.equal(bound.getObject("blazing-scorcher").exhausted, false);
  assert.deepEqual(run.linked.readied.objects, [bound.ref("blazing-scorcher")]);
});

test.todo(
  "Blazing Scorcher: pay [1][Fury] as an optional additional cost while playing me, then have the "
    + "delayed replacement make me enter ready instead of exhausted (CR 805.1.b/805.2.b/805.6, "
    + "805.6.a does not trigger 'becomes ready') — blocked because the card-program play adapter "
    + "does not yet turn the keyword into an optionalAdditional accelerate component, gate the "
    + "805.2.b delayed replacement on the selectedAdditional paid proof, or consume the "
    + "accelerate.cost / enter-ready replacement"
);
