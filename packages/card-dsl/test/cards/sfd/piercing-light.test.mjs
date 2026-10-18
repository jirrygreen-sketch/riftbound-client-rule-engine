import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/piercing-light.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { translateInstructionTargets, translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { describePlay } from "../../../../engine-core/dist/programs/play.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";

const CANONICAL = "card.hash-c6895a694724e94fb577d7753bb9ddc8cb6e91662ff6c79fdcad9ae7755438ff";
const SOURCE_TEXT =
  "[Repeat] :rb_energy_2::rb_rune_fury: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Deal 2 to a unit at a battlefield, then deal 2 to up to one other unit.";

const [play] = program.abilities;
const [firstDeal, secondDeal] = play.body;
const firstSpec = firstDeal.targets[0];
const secondSpec = secondDeal.targets[0];

test("sfd-023-221 Piercing Light: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-023-221 Piercing Light: judge-required for the Repeat wiring and the zero-target Finalize", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /820\.1\.c\.1/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /355\.13/);
  // 2026-10-18 re-sweep: the live gaps are the Finalize cost wiring and the
  // production reject of the exclude anchor, both measured.
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /Unsupported filter field exclude/);
  assert.match(program.judgeReason, /cost\.optional-additional-paid/);
  assert.match(program.judgeReason, /Repeat count must be a non-negative safe integer/);
  assert.doesNotMatch(program.judgeReason, /映射进 Finalize target-plan 的生产消费方/);
});

test("sfd-023-221 Piercing Light structure: no speed keyword, the printed base cost and the Repeat payment", () => {
  // The printed ability line has no [Action]/[Reaction]/[Hidden] keyword, so no
  // speed keyword is declared; the spell keeps its default timing (159.2).
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");

  // [Repeat] :rb_energy_2::rb_rune_fury: (820.1.c/.c.1): two cost components,
  // each carrying the optional pay/decline decision 820.1.b requires.
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 2);
  const [energyPayment, powerPayment] = play.cost.payments;
  assert.equal(energyPayment.kind, "energy");
  assert.deepEqual(energyPayment.amount, { kind: "constant", value: 2 });
  assert.equal(energyPayment.choice.id, "piercing-light.repeat-payment");
  assert.deepEqual(energyPayment.choice.options, ["pay", "decline"]);
  assert.equal(powerPayment.kind, "power");
  assert.deepEqual(powerPayment.allowedDomains, ["Fury"]);
});

test("sfd-023-221 Piercing Light structure: battlefield target then an unlinked 'up to one other unit'", () => {
  assert.equal(play.body.length, 2);

  // "Deal 2 to a unit at a battlefield": one Board unit whose location is a
  // battlefield (355.10.b keeps the battlefield itself out of targeting).
  assert.equal(firstDeal.id, "piercing-light.deal-2-first");
  assert.deepEqual(firstDeal.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(firstSpec, {
    id: "piercing-light.battlefield-unit",
    filter: { type: "unit", zone: "board" },
    location: { type: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "then deal 2 to up to one other unit": a separate sentence (359.3.e.11),
  // so it is not linked to the first Deal; "up to one" allows zero choices
  // (355.13) and "other" excludes the first sentence's unit via the merged
  // `exclude` anchor (355.9.c / 740.1.a).
  assert.equal(secondDeal.id, "piercing-light.deal-2-second");
  assert.equal(secondDeal.op, "effect.damage");
  assert.equal(secondDeal.linkedTo, undefined);
  assert.deepEqual(secondDeal.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(secondSpec, {
    id: "piercing-light.other-unit",
    filter: {
      type: "unit",
      zone: "board",
      exclude: { target: "piercing-light.battlefield-unit" }
    },
    min: 0,
    max: 1,
    selection: "up-to"
  });
});

test("sfd-023-221 Piercing Light golden: both Deals resolve, 2 to each locked unit", () => {
  const kernel = world()
    .unit("front-unit", { owner: "B", might: 4 })
    .unit("other-unit", { owner: "B", might: 3 })
    .build();
  const first = runInstruction(
    damage,
    { amount: firstDeal.args.amount, target: firstSpec.id },
    { world: kernel, targets: { [firstSpec.id]: [kernel.ref("front-unit")] } }
  );
  assert.equal(first.result.status, "executed");
  const second = runInstruction(
    damage,
    { amount: secondDeal.args.amount, target: secondSpec.id },
    { world: kernel, targets: { [secondSpec.id]: [kernel.ref("other-unit")] } }
  );
  assert.equal(second.result.status, "executed");

  assert.equal(kernel.getObject("front-unit").damage, 2);
  assert.equal(kernel.getObject("other-unit").damage, 2);
});

test("sfd-023-221 Piercing Light golden: choosing zero units for 'up to one other unit' is legal (355.13)", () => {
  const kernel = world().unit("front-unit", { owner: "B", might: 4 }).build();
  const run = runInstruction(
    damage,
    { amount: secondDeal.args.amount, target: secondSpec.id },
    // The merged interpreter accepts an empty locked set for an up-to spec; the
    // card-program → Finalize target-plan mapping is the recorded gap.
    { world: kernel, targets: { [secondSpec.id]: [] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("front-unit").damage, 0);
});

test("sfd-023-221 Piercing Light golden: the chain Finalize accepts an explicit zero-choice for the up-to target (355.13)", () => {
  // ChainEngine.execute finalizes the spell with an explicit empty selection
  // and the resolved body damages only the first locked unit: the unchosen
  // up-to target emits no became-target event. The test-only draft stands in
  // for the card-program → Finalize target-plan mapping that remains
  // judge-required, so both authored TargetSpecs reach the real Finalize path.
  const kernel = world()
    .player("A", { energy: 2 })
    .player("B", { energy: 2 })
    .hand("piercing-light", { types: ["spell"], energy: 2, power: ["Fury"] })
    .unit("front-unit", { owner: "B", might: 4 })
    .build();
  const spellBefore = kernel.getObject("piercing-light").ref;
  const decide = (request) => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected choice ${JSON.stringify(request)}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  engine.execute({
    id: "chain:piercing-light",
    controller: "A",
    source: kernel.getObject("piercing-light"),
    kind: "spell",
    speed: "normal",
    body: [firstDeal, secondDeal],
    cost: { id: "cost:chain:piercing-light", cost: { energy: { kind: "constant", value: 0 } } },
    targets: [
      {
        requirement: firstSpec,
        options: { selected: [kernel.ref("front-unit")] }
      },
      {
        requirement: secondSpec,
        options: { selected: [] }
      }
    ]
  });
  assert.equal(engine.items[0].status, "finalized");

  // A spell waits for Priority (365.2), so two passes resolve the finalized
  // chain item and move the spell to Trash.
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 20) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }

  assert.equal(kernel.getObject("front-unit").damage, 2);
  assert.equal(kernel.getObject("piercing-light").zone, "trash");
  assert.notDeepEqual(kernel.getObject("piercing-light").ref, spellBefore);
  assert.equal(
    engine.pipeline.events.filter((event) => event.timingPoint === "became-target").length,
    1
  );
  assert.match(engine.trace.map((entry) => entry.step).join(","), /resolved/);
});

test("sfd-023-221 Piercing Light golden: a single-sentence mistarget does not suppress the other Deal (359.3.e.11)", () => {
  const kernel = world()
    .unit("front-unit", { owner: "B", might: 4 })
    .unit("other-unit", { owner: "B", might: 3 })
    .build();
  const stale = kernel.ref("front-unit");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "hand" }).status, "done");

  const first = runInstruction(
    damage,
    { amount: firstDeal.args.amount, target: firstSpec.id },
    { world: kernel, targets: { [firstSpec.id]: [stale] } }
  );
  const second = runInstruction(
    damage,
    { amount: secondDeal.args.amount, target: secondSpec.id },
    { world: kernel, targets: { [secondSpec.id]: [kernel.ref("other-unit")] } }
  );

  assert.deepEqual(first.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(second.result.status, "executed");
  assert.equal(kernel.getObject("other-unit").damage, 2);
  assert.equal(kernel.getObject("front-unit").zone, "hand");
});

test.todo(
  "sfd-023-221 Piercing Light: re-making choices for the additional execution (820.2) needs the " +
    "paid instance count at resolution; see the measured repeat-node evidence below."
);

test("sfd-023-221 Piercing Light: the paid Repeat receipt is a boolean the repeat node cannot consume (820.1.d.1)", () => {
  // Live evidence for the first gap. The receipt is readable as a predicate, but
  // the merged repeat node requires a non-negative integer count, so the printed
  // additional execution cannot be derived card-side from the paid decision.
  const kernel = world()
    .player("A", { energy: 9, power: ["Fury"] })
    .deck(["d1", "d2"])
    .object("piercing-source", { cardId: CANONICAL, types: ["spell"], zone: "board", energy: 2, power: ["Fury"] })
    .build();
  const cost = {
    plan: {
      components: [{ id: "piercing-light.repeat-payment", stage: "optional-additional" }],
      selectedAdditional: [{ id: "piercing-light.repeat-payment", kind: "repeat" }],
      declinedAdditional: []
    },
    receipt: { paid: true, additional: [{ id: "piercing-light.repeat-payment", kind: "repeat", paid: true }] }
  };
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("piercing-source") });

  const read = runAbilityBody(
    [{ id: "piercing.read-repeat", op: "condition.predicate", args: { condition: { kind: "constant", value: { kind: "result", result: "cost.optional-additional-paid", id: "piercing-light.repeat-payment" } } } }],
    context,
    undefined,
    { cost }
  );
  assert.equal(read.results[0].result.linkedValues.value, true);

  const repeated = kernel.clone({ sourceSnapshot: kernel.getObject("piercing-source") });
  assert.throws(
    () => runAbilityBody(
      [
        { id: "piercing.read-repeat", op: "condition.predicate", args: { condition: { kind: "constant", value: { kind: "result", result: "cost.optional-additional-paid", id: "piercing-light.repeat-payment" } } } },
        {
          id: "piercing.repeat",
          op: "repeat",
          linkedTo: "piercing.read-repeat",
          args: {
            count: { kind: "linked-value", instructionId: "piercing.read-repeat", key: "value" },
            body: { kind: "constant", value: [{ id: "piercing.draw", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }] }
          }
        }
      ],
      repeated,
      undefined,
      { cost }
    ),
    /Repeat count must be a non-negative safe integer/
  );
  assert.equal(repeated.player("A").handSize, 0, "no repetitions ran");
});

test("sfd-023-221 Piercing Light: the production filter binding rejects the second target's exclude anchor", () => {
  // Live evidence for the second gap. The interpreter does consume `exclude`
  // (interpreter/selectors.ts queryObjects), but the production card-program
  // translator rejects the key, so describePlay cannot build the draft at all
  // and the Finalize target mapping is never reached.
  assert.throws(
    () => translateObjectFilter(secondSpec.filter),
    (error) => error.code === "judge-required" && /Unsupported filter field exclude/.test(error.message)
  );
  assert.throws(
    () => translateInstructionTargets(play.body),
    /Unsupported filter field exclude/
  );

  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const registry = new ProgramRegistry([lifted]);
  const kernel = world()
    .object("piercing-source", { cardId: CANONICAL, types: ["spell"], zone: "hand", energy: 2, power: ["Fury"] })
    .build();
  const source = kernel.getObject("piercing-source");
  assert.throws(
    () => describePlay(registry, { type: "play", object: source.ref, player: "A" }, source),
    /Unsupported filter field exclude/
  );

  // The interpreter side of the same anchor is merged: an explicit exclude
  // really removes the first unit from the second query.
  const counted = kernel.query({ type: "unit", zone: "board", exclude: { target: "piercing-light.battlefield-unit" } });
  assert.deepEqual(counted, []);
});

test("sfd-023-221 Piercing Light: the zero-choice 'up to one' Finalize write path is merged end to end (355.13)", () => {
  // The zero-target path the judgeReason credits: an explicit empty selection
  // for an up-to spec finalizes cleanly and locks an empty plan.
  const kernel = world()
    .unit("front-unit", { owner: "B", might: 4 })
    .unit("other-unit", { owner: "B", might: 3 })
    .build();
  const context = bindResolveContext(kernel, { source: kernel.getObject("front-unit"), controller: "A" });
  const plan = finalizeTargetPlan(context, { ...secondSpec, location: undefined }, {
    selected: [],
    isPending: () => false
  });
  assert.deepEqual(plan.selected, []);
  assert.equal(plan.lockedAt, "finalize");

  const resolution = resolveTargetPlan(context, plan, {});
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.selected, []);
});
