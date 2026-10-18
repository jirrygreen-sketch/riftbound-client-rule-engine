import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sinister-poro.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateObjectFilter, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { fixture as turnFixture } from "../../../../engine-core/test/turn/helpers.mjs";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";

/** Drain the merged chain until it blocks; used to reach the combat gate. */
function settleTurn(flow) {
  let budget = 0;
  while (flow.chain.items.length) {
    if (++budget > 100) throw new Error("Nonterminating test chain");
    flow.pass(flow.chain.priority);
  }
  flow.advance();
}

const timingsOf = (flow) => flow.chain.pipeline.events.map((event) => event.timingPoint);

const CARD_ID =
  "card.hash-012e505f18f7dd78843bcdd1d710fa4398ff99390018e2e21b662d53ed596e01";
const SOURCE_TEXT =
  "When I attack, you may pay :rb_energy_1: to move an enemy unit here to its base.";

const [ability] = program.abilities;
const [payEnergy, moveEnemy] = ability.body;
const targetSpec = moveEnemy.targets[0];

function battlefieldBoard() {
  const kernel = world()
    .player("B")
    .unit("sinister-poro", { might: 1, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", {
      owner: "B",
      controller: "B",
      might: 3,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy-far", {
      owner: "B",
      controller: "B",
      might: 3,
      location: { type: "battlefield", id: "bf-2" }
    })
    .build();
  return kernel.clone({ source: kernel.ref("sinister-poro"), sourceSnapshot: kernel.getObject("sinister-poro") });
}

test("unl-137-219 Sinister Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-137-219 Sinister Poro: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /CostSpec|Finalize/);
  assert.match(program.judgeReason, /sameLocationAs/);
  // 2026-10-18 re-sweep: the reason names the measured arg-shape rejection too.
  assert.match(program.judgeReason, /Invalid cost\.pay argument: energy/);
  assert.match(program.judgeReason, /payments/);
});

test("unl-137-219 Sinister Poro: attack-declared self trigger with the printed may cost as the Finalize decision", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.e: an Attack Trigger fires when the unit gains the Attacker designation.
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  // 383.3.e.2 / 383.3.e.2.a-b: the leading "you may" is decided during finalization; refusing removes
  // the triggered ability from the chain.
  assert.equal(ability.optional, true);
  assert.equal(ability.trigger.condition, undefined);
});

test("unl-137-219 Sinister Poro: 1 Energy recorded as the trigger's base cost, then the Move", () => {
  assert.deepEqual(ability.body.map(step => [step.id, step.op]), [
    ["sinister-poro.pay-energy", "cost.pay"],
    ["sinister-poro.move-enemy", "effect.move"]
  ]);
  // 383.3.b: "pay :rb_energy_1:" follows the leading may, so it is the triggered ability's base cost
  // (CR 204.1.c / 204.3.a). The body record is descriptive until a Finalize cost field exists.
  assert.deepEqual(payEnergy.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(payEnergy.linkedTo, undefined);

  // 204.3.a: the [do Y] effect half reads the paid cost's outcome through the link.
  assert.equal(moveEnemy.linkedTo, "sinister-poro.pay-energy");
  assert.deepEqual(moveEnemy.args.objects, {
    kind: "constant",
    value: { target: "sinister-poro.enemy-unit-here" }
  });
  // "to its base": the moved unit's own controller's Base (effect.move's controller-base spelling).
  assert.deepEqual(moveEnemy.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(moveEnemy.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(moveEnemy.args.linkKey, { kind: "constant", value: "moved" });
  assert.equal(moveEnemy.picks, undefined);
});

test("unl-137-219 Sinister Poro golden: the recorded cost.pay is descriptive only and is refused by the merged primitive", () => {
  // 383.3.b.1: the printed 1 Energy is the triggered ability's base cost, paid
  // during Finalize. Because contract 3.1's TriggeredAbility has no CostSpec
  // slot, the card records the payment in its body. That record is not an
  // executable instruction: the merged cost.pay primitive accepts only
  // { cost, power, nonstandardOrder, payments, linkKey } and rejects the
  // authored energy key, which is why the card cannot be promoted yet.
  assert.deepEqual(payEnergy.args, { energy: { kind: "constant", value: 1 } });
  const kernel = world().player("A", { energy: 1 }).build();
  assert.throws(
    () => runInstruction(costPay, payEnergy.args, { world: kernel }),
    /Invalid cost\.pay argument: energy/
  );
  assert.equal(kernel.player("A").energy, 1);
});

test("unl-137-219 Sinister Poro: 'an enemy unit here' is one opponent-controlled unit at my location", () => {
  // 740.1.b (enemy) + 359.3.f (here); 355.7/355.9.a make the named unit a single target.
  assert.deepEqual(targetSpec, {
    id: "sinister-poro.enemy-unit-here",
    filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-137-219 Sinister Poro golden: the locked enemy unit moves to its own base (CR 107.1)", () => {
  const kernel = battlefieldBoard();
  const run = runInstruction(
    move,
    {
      objects: moveEnemy.args.objects,
      to: moveEnemy.args.to,
      amount: moveEnemy.args.amount,
      linkKey: moveEnemy.args.linkKey
    },
    { world: kernel, targets: { "sinister-poro.enemy-unit-here": [kernel.ref("enemy-here")] } }
  );

  assert.equal(run.result.status, "executed");
  // controller-base resolves per object: the enemy unit belongs to B, so it goes to B's Base.
  assert.deepEqual(kernel.getObject("enemy-here").location, { type: "base", player: "B" });
  assert.deepEqual(kernel.getObject("enemy-far").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(run.linked.moved.movements, [
    {
      object: { id: "enemy-here", zoneEntryId: 1 },
      from: { type: "battlefield", id: "bf-1" },
      to: { type: "base", player: "B" }
    }
  ]);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("unl-137-219 Sinister Poro golden: the card's own printed Move args run on the merged primitive", () => {
  // moveEnemy.args are the card's own data (target id, controller-base, amount 1); the caller supplies
  // the Finalize-locked target set, exactly as the production target pipeline must.
  const accepted = battlefieldBoard();
  const run = runInstruction(move, moveEnemy.args, {
    world: accepted,
    targets: { "sinister-poro.enemy-unit-here": [accepted.ref("enemy-here")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(accepted.getObject("enemy-here").location, { type: "base", player: "B" });
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);

  // 359.3.e: a mistargeted locked reference is ignored, not redirected to another unit.
  const stale = battlefieldBoard();
  const staleRef = stale.ref("enemy-here");
  stale.perform({ type: "kill", object: staleRef });
  const ignored = runInstruction(move, moveEnemy.args, {
    world: stale,
    targets: { "sinister-poro.enemy-unit-here": [staleRef] }
  });
  assert.deepEqual(ignored.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(stale.getObject("enemy-far").location, { type: "battlefield", id: "bf-2" });
});

test.todo(
  "unl-137-219 Sinister Poro: charge the printed 1 Energy as the triggered ability's base cost at Finalize " +
    "(CR 383.3.b.1 / 415.4-415.5) — contract 3.1's TriggeredAbility has no CostSpec field for a base cost, and the " +
    "recorded body cost.pay is rejected by the merged primitive (see the execution test above)"
);
test.todo(
  "unl-137-219 Sinister Poro: fire the attack-declared trigger from the real combat workflow (CR 383.4.e / 466.2.c) " +
    "— the timing point exists but combat/ has no emit path wired yet"
);

test("unl-137-219 Sinister Poro: the printed 'here' anchor is still rejected by the production target translator", () => {
  // 359.3.f / 740.1.b: \"an enemy unit here\" needs sameLocationAs: source.
  // The merged translator still refuses that field, so the declared TargetSpec
  // is kept as the authored shape rather than approximated by any enemy unit.
  assert.throws(
    () => translateObjectFilter(targetSpec.filter),
    (error) => error.name === "ProgramBindingError" && /Unsupported filter field sameLocationAs/.test(error.message)
  );
  // The trigger filter itself does translate, so the missing "here" anchor is
  // the only target-side gap here.
  assert.deepEqual(translateTriggerFilter({ event: "attack-declared", filter: { source: "self" } }, "sinister-poro", "attack-declared"), {
    event: "attack-declared",
    object: { objectId: "sinister-poro" }
  });
});

test("unl-137-219 Sinister Poro: combat still has no attack-declared emission path (CR 383.4.e / 466.2.c)", () => {
  // The printed trigger can never fire until a combat transaction emits the
  // attacker designation. The merged combat flow refuses to start that
  // transaction, so the timing point remains unreachable.
  // A unit moves onto a battlefield already held by an opposing unit. The
  // merged combat flow stages Combat and then blocks before any partial start:
  // "combat-start-transaction" (CR 466.2 needs an atomic simultaneous timing
  // wave + Attacker/Defender designation). No attacker is ever designated, so
  // the printed attack trigger can never be reached.
  const f = turnFixture({
    fields: [{ id: "bf1", controller: "B" }, { id: "bf2", controller: null }],
    setup: (w) => w.unit("defender", { owner: "B", location: { type: "battlefield", id: "bf1" } })
  });
  f.flow.start();
  f.flow.execute(f.draft("move-to-enemy", [{ id: "move", op: "effect.move", args: { to: { kind: "constant", value: { type: "battlefield", id: "bf1" } } } }]));
  assert.throws(
    () => settleTurn(f.flow),
    (error) => error.status === "blocked" && error.code === "combat-start-transaction"
  );
  assert.equal(f.flow.battlefields[0].staged, "combat");
  // No attack-declared event was ever emitted by the pipeline.
  assert.equal(timingsOf(f.flow).includes("combat-start"), false);
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "attack-declared").length, 0);
});
