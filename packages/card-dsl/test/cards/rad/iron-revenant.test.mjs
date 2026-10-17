import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/iron-revenant.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { translateCost, translateRestriction } from "../../../../engine-core/dist/programs/play.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-265aafa041fadfb8711bb9cb71cfbe3b22843b0d19b59642dd156252990e13e0";
const SOURCE_TEXT =
  "[Reaction][>] Banish a unit or gear from your trash, :rb_exhaust:: [Add] :rb_rune_rainbow:. " +
  "Spend this Power only to play units or gear. (Abilities that add resources can't be reacted to.)";

const [ability] = program.abilities;
const [addPower] = ability.body;

test("rad-143-167 Iron Revenant: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-143-167 Iron Revenant: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // cards README §2: judgeReason names the missing payment kind, the Universal
  // Power gap, the use restriction and the printing difference.
  assert.match(program.judgeReason, /banish/);
  assert.match(program.judgeReason, /cost\/plan-values\.ts/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /rad-170-167/);
  // The merged restriction path, not a missing op, is the current gap.
  assert.match(program.judgeReason, /translateRestriction|needs a rules adapter/);
  assert.match(program.judgeReason, /activateAddDuringPayment/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-91|RIFT-120|RIFT-257|RIFT-261/);
});

test("rad-143-167 Iron Revenant: Reaction-speed Add ability with the printed Banish + Exhaust cost", () => {
  // 813.1.d: "[Reaction][>]" on an ability is a speed permission on the
  // ability itself, so the IR declares reaction timing directly.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "reaction");

  // 377.1 / 355.10.c.1: "Banish a unit or gear from your trash" is a cost
  // within the instruction, chosen at Finalize with no target (a cost does not
  // target anything). The merged cost pipeline has no banish kind, which is
  // the judged gap.
  const [banishPayment, exhaustPayment] = ability.cost.payments;
  assert.equal(banishPayment.kind, "banish");
  assert.deepEqual(banishPayment.choice, {
    id: "iron-revenant.banished-card",
    options: ["unit-or-gear-in-controller-trash"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "trash",
    type: ["unit", "gear"],
    owner: "controller"
  });
  assert.deepEqual(exhaustPayment, { kind: "exhaust", object: "self" });

  // "Spend this Power only to play units or gear." is a use restriction on the
  // added resource; kept as a declaration because the merged chain does not
  // consume card restrictions (see judgeReason).
  assert.deepEqual(ability.restriction, { kind: "use-only-to-play-units-or-gear" });

  assert.equal(ability.body.length, 1);
  assert.equal(addPower.id, "iron-revenant.add-universal-power");
  assert.equal(addPower.op, "effect.resources");
  // 135.2.e.5 / 163.2.b: [A] is Universal Power; the closed six-domain set has
  // no executable value, so the descriptive "rainbow" spelling is kept.
  assert.deepEqual(addPower.args, { power: { kind: "constant", value: ["rainbow"] } });
  assert.equal(addPower.targets, undefined);
  assert.equal(addPower.picks, undefined);
  assert.equal(addPower.linkedTo, undefined);
});

test("rad-143-167 Iron Revenant: the Banish action itself is merged and moves the chosen trash card", () => {
  // The supported half of the cost: effect.banish performs the real banish
  // game action. This proves the action, not the Finalize cost wiring.
  const kernel = world()
    .unit("dead-unit", { zone: "trash", types: ["unit"], controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("dead-unit") });
  const trashRef = scoped.ref("dead-unit");
  const run = runInstruction(
    banish,
    { objects: { kind: "constant", value: { target: "iron-revenant.chosen" } } },
    { world: scoped, targets: { "iron-revenant.chosen": [trashRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
  assert.equal(run.linked.banishedCount, 1);
  assert.equal(run.linked.banishedObject.id, "dead-unit");
  assert.deepEqual(scoped.zone("A", "trash"), []);
  assert.deepEqual(scoped.zone("A", "banishment").map(ref => ref.id), ["dead-unit"]);
});

test("rad-143-167 Iron Revenant boundary: the printed Banish cost has no payable plan today", () => {
  // The cost layer keeps its closed nonstandard payment vocabulary, so the
  // declared Banish payment cannot be planned; the card stays judge-required
  // until a banish kind exists (CR 377.1 / 355.10.c.1 / 415.4). The kind check
  // runs before object selection, so the card's own declaration fails on the
  // missing kind.
  const translated = translateCost(ability.cost, "iron-revenant.cost", "activate");
  assert.equal(translated.payments[0].kind, "banish");
  const kernel = world()
    .player("A", { energy: 3 })
    .unit("revenant", { types: ["legend"], might: 4 })
    .unit("trashed-unit", { zone: "trash", types: ["unit"], owner: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("revenant") });
  assert.throws(
    () => buildCostPlan(context, { id: "iron-revenant.plan", cost: translated }),
    /Unsupported payment kind: banish/i
  );
  // The second gap is shape-level and shows up on any supported kind: branch
  // selection offers describe-only option names, while the planner only accepts
  // exact ObjectRefs chosen at Finalize (355.10.c.1).
  assert.throws(
    () => buildCostPlan(context, {
      id: "iron-revenant.plan",
      cost: {
        kind: "activated",
        payments: [{
          kind: "recycle",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "iron-revenant.banished-card",
            options: ["unit-or-gear-in-controller-trash"],
            min: 1, max: 1, selection: "one", zone: "trash", type: ["unit", "gear"], owner: "controller"
          }
        }]
      }
    }),
    /exact object reference/i
  );
  // The real Banish action stays available and leaves the trash untouched when
  // no plan could be paid.
  assert.equal(kernel.zone("A", "trash").length, 1);
  assert.deepEqual(kernel.zone("A", "banishment"), []);
});

test("rad-143-167 Iron Revenant boundary: the declared use restriction has no Finalize adapter", () => {
  // programs/play.ts translateRestriction only forwards a Condition/value
  // shape, so the descriptive kind this card prints cannot become an
  // enforceable Finalize condition yet.
  assert.throws(
    () => translateRestriction(ability.restriction, program.canonicalCardId),
    /needs a rules adapter/i
  );
});

test.todo(
  "rad-143-167: [A] Universal Power is not executable — 135.2.e.5.b / 163.2.b require Power " +
    "spendable as any Domain, but the closed Domain union (Fury/Calm/Mind/Body/Chaos/Order) and " +
    "the gain-power action have no universal value; effect.resources documents that it must never " +
    "be approximated by a chosen domain, so the readable \"rainbow\" spelling is kept until a " +
    "contract change lands"
);

test.todo(
  "rad-143-167: add a banish payment kind to the cost plan so “Banish a unit or gear from your " +
    "trash” is charged at Finalize from the public Trash (CR 355.10.a.1 / 355.10.c.1 / 415.4); " +
    "the cost payment vocabulary still has no banish kind and its choice options still require " +
    "exact ObjectRefs"
);

test.todo(
  "rad-143-167: represent and spend Universal Power ([A], CR 135.2.e.5 / 163.2.b) — the closed " +
    "Domain union and gain-power action have no universal value, so this needs a contract change, " +
    "plus the 430.3 Reaction-Add activation window during payment"
);

test.todo(
  "rad-143-167: enforce “Spend this Power only to play units or gear.” by tracking the added " +
    "Power's use restriction and consuming it in the chain/cost check"
);

test.todo(
  "rad-143-167: resolve the non-reminder printing difference with rad-170-167 (which drops " +
    "“only”) before claiming a single executable semantic for this canonical identity"
);
