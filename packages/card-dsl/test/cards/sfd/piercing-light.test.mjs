import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/piercing-light.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /355\.13/);
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
    // chain-side zero-target Finalize write path is the recorded gap.
    { world: kernel, targets: { [secondSpec.id]: [] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("front-unit").damage, 0);
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
  "sfd-023-221 Piercing Light: collecting the optional 2-energy + 1-Fury-power Repeat cost at " +
    "Finalize, exposing the paid count to the effect execution, and re-making choices for the " +
    "additional execution (820.1.c.1 / 820.1.d.1 / 820.2) need the cost plan's optionalAdditional " +
    "wiring and a paid-instance receipt."
);

test.todo(
  "sfd-023-221 Piercing Light: locking a zero-choice 'up to one' target through the production " +
    "Finalize flow (355.13) and the became-target trigger for the chosen units belong to the " +
    "target system's Finalize consumer."
);

test.todo(
  "sfd-023-221 Piercing Light: excluding the first sentence's unit from the second target through " +
    "the merged `exclude` anchor needs the chain's Finalize target pipeline to evaluate the anchor " +
  "against the first locked TargetSpec."
);
