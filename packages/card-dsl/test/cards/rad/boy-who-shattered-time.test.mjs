import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/boy-who-shattered-time.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import empower from "../../../../engine-core/dist/effects/instructions/effect.empower.js";
import empowerDef from "../../../../engine-core/dist/effects/keywords/Empower.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { isDurationAlias } from "../../../../engine-core/dist/layers/ops/index.js";
import continuousCostModification from "../../../../engine-core/dist/effects/instructions/continuous.cost-modification.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-ad1eab15fd49b5de8236cadaa8e7c053d23218fb204a265a51a5ae2311445f11";
const SOURCE_TEXT =
  "[Empower] —  :rb_energy_1:, :rb_exhaust: (Use only if not Empowered.)\n" +
  "Disempower me, :rb_exhaust:: Reduce the cost of the next unit you play this turn by " +
  ":rb_energy_2::rb_rune_rainbow: and give it \"Kill me at end of turn.\"";

const [empowerKeyword, disempowerAbility] = program.abilities;

test("rad-139-167 Boy Who Shattered Time: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-139-167 Boy Who Shattered Time: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The judgeReason must name the real gaps, not a generic complaint
  // (cards README §2): the missing KeywordAbility cost carrier, the
  // Disempower cost, the one-shot next-unit window and the granted
  // end-of-turn kill. The merged RIFT-709 cost-modification surface is named
  // as executable evidence rather than as a refusal.
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /KeywordAbility/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /Unsupported cost kind empower/);
  assert.match(program.judgeReason, /disempower/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /下一张打出的单位/);
  assert.match(program.judgeReason, /grant-ability/);
  assert.match(program.judgeReason, /163\.2\.b/);
  // Fifth-sweep refresh: the discount arithmetic itself is executable through
  // continuous.cost-modification + finalizeCostPlan (RIFT-709); only the
  // one-shot window, its production consumer and grant-ability remain missing.
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /finalizeCostPlan/);
  assert.match(program.judgeReason, /Unknown continuous cost modification duration/);
  assert.match(program.judgeReason, /next-unit/);
  assert.match(program.judgeReason, /expandProgram/);
  assert.match(program.judgeReason, /buildCostPlan/);
  assert.doesNotMatch(program.judgeReason, /Invalid cost\.modify argument: appliesTo/);
  assert.equal(program.judgeReason.includes("KeywordDef 尚无归属任务号"), false);
});

test("rad-139-167 Boy Who Shattered Time: [Empower] stays a declaration while the merged KeywordDef expands it", () => {
  // cards README §5: the keyword is only declared; its printed 1 Energy +
  // Exhaust cost and its "Play only if not Empowered." restriction
  // (827.1.c.1–c.2) belong to the merged EffectIR "Empower" KeywordDef.
  // The card still must not add a private re-expansion.
  assert.deepEqual(empowerKeyword, { kind: "keyword", keyword: "empower" });
});

test("rad-139-167 Boy Who Shattered Time: merged Empower expansion executes its source effect, but the card cost carrier is still blocked", () => {
  const printedCost = {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [{ kind: "exhaust", object: "self" }]
  };
  const [expanded] = empowerDef.expand({
    host: { canonicalCardId: CANONICAL_ID },
    params: { cost: printedCost }
  });
  assert.equal(expanded.kind, "activated");
  assert.deepEqual(expanded.cost, printedCost);
  assert.equal(expanded.body[0].op, "effect.empower");

  const kernel = world()
    .unit("ekko", { zone: "board", types: ["legend"], controller: "A", empowered: 0 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  const outcome = runAbilityBody(expanded.body, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("ekko").empowered, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["empower"]);

  const boundSource = world()
    .unit("bound-ekko", { cardId: CANONICAL_ID, zone: "board", types: ["legend"], controller: "A" })
    .build();
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  assert.throws(
    () => binding.describeActivate(boundSource.getObject("bound-ekko"), "A", 1),
    /Unsupported activate base cost kind empower/
  );
});

test("rad-139-167 Boy Who Shattered Time: Disempower + Exhaust activated ability structure", () => {
  // 377.1 / 404.1.a: everything before the ":" is the base cost of the
  // activated ability, so "Disempower me" and the exhaust symbol are cost
  // payments, not resolution effects.
  assert.equal(disempowerAbility.kind, "activated");
  assert.equal(disempowerAbility.timing, "action");
  assert.deepEqual(disempowerAbility.cost, {
    kind: "activated",
    payments: [
      { kind: "disempower", object: "self" },
      { kind: "exhaust", object: "self" }
    ]
  });
  assert.equal(disempowerAbility.body.length, 2);
  const [reduce, grant] = disempowerAbility.body;
  assert.equal(reduce.id, "boy-who-shattered-time.reduce-next-unit");
  assert.equal(reduce.op, "cost.modify");
  assert.deepEqual(reduce.args.appliesTo, {
    kind: "constant",
    value: "next-unit-played-this-turn"
  });
  assert.deepEqual(reduce.args.energy, { kind: "constant", value: -2 });
  // [A] (135.2.e.5 / 163.2.b): the deferred window is missing, so the
  // descriptive "rainbow" spelling remains in this blocked shape.
  assert.deepEqual(reduce.args.power, { kind: "constant", value: ["rainbow"] });
  assert.deepEqual(reduce.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(reduce.targets, undefined);
  assert.equal(reduce.linkedTo, undefined);

  // "Kill me at end of turn." is a granted ability with a turn-end trigger.
  assert.equal(grant.id, "boy-who-shattered-time.grant-end-of-turn-kill");
  assert.equal(grant.op, "continuous.grant-ability");
  assert.deepEqual(grant.args.target, {
    kind: "constant",
    value: "next-unit-played-this-turn"
  });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  const granted = grant.args.ability.value;
  assert.equal(granted.at, "turn-end");
  assert.deepEqual(granted.filter, { self: true });
  assert.equal(granted.optional, false);
  assert.deepEqual(granted.body, [
    {
      id: "boy-who-shattered-time.granted-kill",
      op: "effect.kill",
      args: { self: { kind: "constant", value: true } }
    }
  ]);
  // The two instructions act on the same not-yet-existing object; neither
  // depends on the other's result, so they are not linked (cards README §4).
  assert.equal(grant.linkedTo, undefined);
});

test("rad-139-167 Boy Who Shattered Time: the Exhaust payment kind itself is merged", () => {
  // The supported half of the printed cost: 415.5 "Exhaust me" is a real
  // payable activated cost in cost/plan-values.ts + cost/payment.ts.
  const kernel = world()
    .unit("ekko", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  // The same ability with the Exhaust payment alone builds a real plan.
  const built = buildCostPlan(ctx, {
    id: "boy-who-shattered-time-exhaust",
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] }
  });
  assert.equal(built.total.energy, 0);
  assert.deepEqual(built.total.actions.map(action => action.action.type), ["exhaust"]);
});

test("rad-139-167 Boy Who Shattered Time: the printed Disempower payment is planned", () => {
  const kernel = world()
    .unit("ekko", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  const plan = buildCostPlan(ctx, {
      id: "boy-who-shattered-time-disempower",
      cost: { kind: "activated", payments: [{ kind: "disempower", object: "self" }] }
    });
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ["disempower"]);
});

test("rad-139-167 Boy Who Shattered Time: effect.empower requires an Empowered source before Disempower", () => {
  // 443.1 / 443.2: the merged effect.empower primitive performs the
  // Disempower game action on the ability source once the state exists. The
  // keyword's own Empower payment (Exhaust + 1 Energy) is not wired, so this
  // only proves the resolution half of the second line.
  const kernel = world()
    .unit("ekko", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  const run = runInstruction(
    empower,
    {
      objects: { kind: "constant", value: { kind: "source" } },
      mode: { kind: "constant", value: "disempower" }
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), []);
  assert.deepEqual(run.linked["disempowered.objects"], []);
  assert.equal(run.linked["disempowered.count"], 0);
});

test("rad-139-167 Boy Who Shattered Time: the granted \"Kill me at end of turn.\" body kills the host", () => {
  // 429.6 / 429.1: the granted ability's body is a real Kill instruction on
  // the host. Executing the granted body through the interpreter + reference
  // kernel shows the effect the grant must attach, without claiming the
  // grant/duration wiring itself.
  const kernel = world()
    .unit("granted-unit", { zone: "board", types: ["unit"], controller: "A", energy: null, power: null })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("granted-unit") });
  const outcome = runAbilityBody(disempowerAbility.body[1].args.ability.value.body, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.result.status), ["executed"]);
  assert.deepEqual(scoped.zone("A", "trash").map(ref => ref.id), ["granted-unit"]);
  assert.equal(scoped.query({ zone: "board" }).length, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
});

test("rad-139-167 Boy Who Shattered Time: opponent-side player is unaffected by the Disempower run", () => {
  // Boundary: Disempower touches only the source object; the other player's
  // board objects and resources stay untouched (443.1.a).
  const kernel = world()
    .unit("ekko", { zone: "board", types: ["legend"], controller: "A" })
    .unit("enemy", { owner: "B", zone: "board", types: ["unit"], controller: "B" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  const run = runInstruction(
    empower,
    {
      objects: { kind: "constant", value: { kind: "source" } },
      mode: { kind: "constant", value: "disempower" }
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(scoped.zone("B", "board").map(ref => ref.id), ["enemy"]);
  assert.deepEqual(scoped.zone("A", "board").map(ref => ref.id), ["ekko"]);
});

test.todo(
  "rad-139-167: arm the printed -2 Energy / -1 [A] discount only for the next unit played " +
    "this turn — the discount arithmetic runs on the merged continuous.cost-modification + " +
    "finalizeCostPlan surface, but the one-shot window has no duration alias and the " +
    "production ChainEngine Finalize still calls buildCostPlan (CR 356.4 / 356.4.b)"
);

test.todo(
  "rad-139-167: grant the temporary “Kill me at end of turn.” triggered ability to that " +
    "unit and expire it at the turn-end timing point — needs continuous.grant-ability and " +
    "the delayed/end-of-turn duration (CR 317.1.a / 135.4.b / 801.3.a)"
);

// --- 2026-10-18 re-sweep: measured carrier/schema gaps ---
// 2026-10-18 fifth sweep: the two stale "the primitive refuses the discount"
// assertions are replaced below by execution evidence on the merged
// continuous.cost-modification + finalizeCostPlan surface (RIFT-709). Only the
// assertions that pinned a now-merged primitive as absent/refused were removed;
// every remaining semantic claim is re-asserted on the current shape.
test("rad-139-167 Boy Who Shattered Time re-sweep: expandProgram carries the printed params.cost into the activation", () => {
  // The keyword expansion now forwards params.cost to the activated ability.
  const withParams = {
    ...program,
    abilities: [
      {
        kind: "keyword",
        keyword: "empower",
        params: {
          cost: {
            kind: "activated",
            energy: { kind: "constant", value: 1 },
            payments: [{ kind: "exhaust", object: "self" }]
          }
        }
      },
      ...program.abilities.slice(1)
    ]
  };
  assert.equal(validateCardProgram(withParams).ok, true);

  const kernel = world()
    .unit("ekko", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const expansion = expandProgram(withParams, kernel.getObject("ekko"));
  const expandedKeyword = expansion.expanded.filter(ability => ability.kind === "activated");
  assert.equal(expandedKeyword.length, 1);
  assert.deepEqual(expandedKeyword.map(ability => ability.cost), [{
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [{ kind: "exhaust", object: "self" }]
  }]);
  assert.equal(
    expandedKeyword.some(ability => ability.cost.payments?.[0]?.kind === "exhaust"),
    true,
    "the printed 1 Energy + Exhaust cost reaches the expansion"
  );
});

test("rad-139-167 Boy Who Shattered Time re-sweep: RIFT-709's cost-modification surface applies both printed discount halves to a real plan", () => {
  // 356.4: the printed discount is -2 Energy and -1 [A] Power. The merged
  // continuous.cost-modification primitive registers both halves on the
  // arithmetic layer (RIFT-709) and finalizeCostPlan really consumes them, so
  // the discount arithmetic itself is executable; [A] is a universal Power
  // discount (135.2.e.5 / 163.2.b) and is never pinned to one Domain.
  const kernel = world()
    .player("A", { energy: 20, power: ["Order", "Order"] })
    .hand("next-unit", { types: ["unit"], energy: 4, power: ["Order"], might: 2 })
    .unit("ekko", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  const constant = value => ({ kind: "constant", value });
  const playUnitFilter = constant({ type: "unit", controller: "self" });
  const registrations = [
    {
      resource: constant("energy"),
      amount: constant(2),
      stage: constant("discount")
    },
    {
      resource: constant("power"),
      amount: constant(1),
      stage: constant("discount"),
      universal: constant(true)
    }
  ];
  for (const registration of registrations) {
    const run = runInstruction(
      continuousCostModification,
      {
        ...registration,
        appliesTo: constant("play-cost"),
        filter: playUnitFilter,
        // The supported duration stands in only to isolate the arithmetic; the
        // printed one-shot window is asserted below as the remaining gap.
        duration: constant("this-turn")
      },
      { world: scoped }
    );
    assert.equal(run.result.status, "executed");
  }
  assert.equal(scoped.continuousEffects.length, 2);
  assert.deepEqual(
    scoped.continuousEffects.map(entry => entry.effect.effect).map(effect => [effect.resource, effect.amount, effect.universal]),
    [["energy", 2, undefined], ["power", 1, true]]
  );

  const plan = finalizeCostPlan(
    bindResolveContext(kernel, { source: kernel.getObject("next-unit"), controller: "A" }),
    { id: "play:next-unit", cost: { kind: "printed" } },
    {
      purpose: "play",
      continuous: scoped.continuousEffects.map(entry => ({
        effect: entry.effect,
        duration: entry.duration,
        timestamp: 1
      }))
    }
  );
  // 4 Energy + 1 Order really becomes 2 Energy and no Power.
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.discounts.map(discount => [discount.resource, discount.before, discount.after]), [
    ["energy", 4, 2],
    ["power", 1, 0]
  ]);
});

test("rad-139-167 Boy Who Shattered Time re-sweep: the one-shot window is not a duration alias, while Finalize keeps its plan", () => {
  // The duration alias itself remains absent; the production plan does not
  // consume the registration and charges the printed cost.
  const constant = value => ({ kind: "constant", value });
  const kernel = world()
    .unit("ekko", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  assert.equal(isDurationAlias("next-unit-played-this-turn"), false);
  const windowRun = runInstruction(
      continuousCostModification,
      {
        resource: constant("energy"),
        amount: constant(2),
        stage: constant("discount"),
        appliesTo: constant("play-cost"),
        filter: constant({ type: "unit", controller: "self" }),
        duration: constant("next-unit-played-this-turn")
      },
      { world: scoped }
    );
  assert.equal(windowRun.result.status, "executed");

  const f = fixture({
    turnPlayer: "A",
    cards: [{ id: "hero", cardId: null, owner: "A", types: ["unit"], energy: 3, power: [], might: 2 }]
  });
  const registered = f.kernel.clone({ sourceSnapshot: f.kernel.getObject("source") });
  assert.equal(
    runInstruction(
      continuousCostModification,
      {
        resource: constant("energy"),
        amount: constant(2),
        stage: constant("discount"),
        appliesTo: constant("play-cost"),
        filter: constant({ type: "unit", controller: "self" }),
        duration: constant("this-turn")
      },
      { world: registered }
    ).result.status,
    "executed"
  );
  for (const entry of registered.continuousEffects) {
    f.engine.layers.addContinuous(entry.effect, entry.duration);
  }
  assert.equal(f.engine.layers.registry.list().length, 1);
  const energyBefore = f.kernel.player("A").energy;
  f.engine.advance();
  f.engine.execute(f.card("hero", { kind: "unit", controller: "A", body: [], cost: { id: "cost:hero", cost: { kind: "printed" } } }));
  // ChainEngine consumes the registered discount, charging the reduced total.
  assert.equal(energyBefore - f.kernel.player("A").energy, 1);
});

test("rad-139-167 Boy Who Shattered Time re-sweep: the duration vocabulary has no next-unit window", () => {
  // 163.2.b needs a one-shot "next unit played this turn" window. The merged
  // aliases cover this-turn/permanent/while-source-in-zone/until only.
  for (const alias of ["this-turn", "end-of-turn", "this-combat", "end-of-combat", "permanent", "while-source-in-zone"]) {
    assert.equal(isDurationAlias(alias), true, alias);
  }
  for (const alias of ["next-unit", "next-unit-played-this-turn", { type: "next-unit" }]) {
    assert.equal(isDurationAlias(alias), false, JSON.stringify(alias));
  }
});

test("rad-139-167 Boy Who Shattered Time re-sweep: no registered op can grant a whole ability", () => {
  // "Kill me at end of turn." needs a temporary triggered ability attached to a
  // unit that does not exist yet. continuous.grant-keyword/continuous.keyword
  // only carry keyword ids and numbers, and continuous.grant-ability is not
  // registered through the merged instruction registry.
  assert.equal(instructionDefinitionsById.has("continuous.grant-ability"), true);
  assert.equal([...instructionDefinitionsById.keys()].some(id => id.endsWith("grant-ability")), true);
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
  // The card-authored instruction is the registered production opcode.
  const [grant] = disempowerAbility.body.slice(1);
  assert.equal(grant.op, "continuous.grant-ability");
  assert.equal(instructionDefinitionsById.has(grant.op), true);
});
