import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/helm-of-suppression.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-c78464f75c9c394d39ba60be62b2e010158f2a4a17cebed21a59e9bf42bd8207";
const SOURCE_TEXT =
  "[Empower] :rb_energy_4::rb_rune_calm: (:rb_energy_4::rb_rune_calm:: Empower this. Use only if not Empowered.)\n" +
  "Opponents' spells cost :rb_energy_1: more. If this is [Empowered], they cost :rb_energy_1::rb_rune_rainbow: more instead.";

const SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

const [empower, baseIncrease, empoweredIncrease] = program.abilities;

/** A merged Finalize context for an opposing spell being played (no printed discount). */
function spellContext() {
  const base = world().hand("spell", { types: ["spell"], energy: 2, power: null }).build();
  return base.clone({ sourceSnapshot: base.object(base.ref("spell")) });
}

test("ven-045-166 Helm of Suppression: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-045-166 Helm of Suppression: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /356\.3/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /Unsupported static appliesTo/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-045-166 Helm of Suppression: the printed Empower cost is declared, not expanded", () => {
  assert.equal(empower.kind, "keyword");
  assert.equal(empower.keyword, "empower");
  // 827.1.c: the printed cost is 4 Energy plus one Calm Power rune.
  assert.equal(empower.value, 4);
  assert.equal(empower.costDomain, "Calm");
});

test("ven-045-166 Helm of Suppression: +1 Energy for opponents' spells, and the Empowered [1][A] instead branch", () => {
  // 356.3: "cost … more" is an increase, applied in the increase step.
  assert.equal(baseIncrease.kind, "static");
  assert.equal(baseIncrease.effect.kind, "continuous.cost-modification");
  assert.equal(baseIncrease.effect.resource, "energy");
  assert.deepEqual(baseIncrease.effect.amount, { kind: "constant", value: 1 });
  assert.equal(baseIncrease.effect.appliesTo, "spell-play-cost");
  // 740.1.b: "Opponents' spells" is the ability controller's opponents' spells.
  assert.deepEqual(baseIncrease.effect.filter, { type: "spell", controller: "opponent" });
  assert.deepEqual(baseIncrease.condition, {
    kind: "not",
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "self-is-empowered" }
    }
  });

  // "instead": the Empowered branch replaces the +1 Energy with +1 Energy and
  // one any-Domain Power; it is not an additional, second increase.
  assert.equal(empoweredIncrease.kind, "static");
  assert.deepEqual(empoweredIncrease.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(empoweredIncrease.effect.insteadOf, {
    kind: "constant",
    value: "helm-of-suppression-base-increase"
  });
  // 135.2.e.5.a / 163.2.b: [A] is paid by Power of any Domain. The closed
  // Domain union has no Universal Power value, so the card records the payment
  // eligibility set instead of collapsing it into one concrete Domain.
  assert.deepEqual(empoweredIncrease.effect.additionalPower, {
    kind: "constant",
    value: { amount: 1, eligibleDomains: SIX_DOMAINS }
  });
  assert.deepEqual(empoweredIncrease.condition, {
    kind: "expression",
    value: { kind: "constant", value: "self-is-empowered" }
  });
  assert.deepEqual(empoweredIncrease.effect.filter, baseIncrease.effect.filter);
});

test("ven-045-166 Helm of Suppression golden: the +1 Energy increase is applied by the merged cost plan (CR 356.3)", () => {
  const plan = buildCostPlan(spellContext(), {
    id: "opposing-spell",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    // The increase is supplied by the caller in the shape cost/cost-plan.ts
    // consumes today (CostPlanInput.increases); the card -> plan registration is
    // the judged part. The delta itself is the card's printed +1 Energy.
    increases: [
      {
        id: "helm-of-suppression-base-increase",
        cost: {
          kind: "explicit",
          energy: baseIncrease.effect.amount
        }
      }
    ]
  });

  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(
    plan.components.map(component => [component.id, component.stage, component.cost.energy]),
    [
      ["base", "base", 2],
      ["helm-of-suppression-base-increase", "increase", 1]
    ]
  );
  assert.deepEqual(plan.discounts, []);
});

test("ven-045-166 Helm of Suppression golden: without the increase the same spell costs its printed 2 Energy", () => {
  const plan = buildCostPlan(spellContext(), {
    id: "opposing-spell-plain",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } }
  });

  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.components.map(component => component.stage), ["base"]);
});

test("ven-045-166 Helm of Suppression: the Empowered branch's Power component is not a concrete Domain", () => {
  // 135.2.e.5.a: a single-Domain spelling would misrepresent who can pay the
  // printed [A]. The card therefore carries the six-domain eligibility set and
  // never a bare domain string.
  const power = empoweredIncrease.effect.additionalPower.value;
  assert.equal(typeof power, "object");
  assert.equal(power.amount, 1);
  assert.deepEqual(power.eligibleDomains, SIX_DOMAINS);
  assert.equal(empoweredIncrease.effect.domain, undefined);
});

test.todo(
  "ven-045-166 Helm of Suppression: [Empower] 4 Energy + 1 Calm Power must expand to its activation cost with the " +
    "\"use only if not Empowered\" restriction (827.1.c.1 / 442.1.b) - no Empower/Empowered KeywordDef exists in " +
    "effects/keywords/registry.generated.ts (full program binding: 'Keyword empower has no executable KeywordDef')"
);
test.todo(
  "ven-045-166 Helm of Suppression: the static cost increase must be installed on an opposing spell's cost plan - " +
    "buildCostPlan only reads caller-supplied CostPlanInput.increases and ProgramStaticBinder.staticTarget rejects " +
    "appliesTo 'spell-play-cost' (Unsupported static appliesTo); the merged cost.modify instruction primitive is a " +
    "card instruction, not this static-to-cost-plan path"
);
test.todo(
  "ven-045-166 Helm of Suppression: the [A] Power increase must be payable by Power of any Domain - the closed six-Domain " +
    "union has no Universal Power value, and the Empowered predicate (828.1.c) has no evaluable form - the named " +
    "expression predicate is constantly true in the test kernel and throws MissingInformation in the production " +
    "interpreter (in-progress RIFT-359)"
);
