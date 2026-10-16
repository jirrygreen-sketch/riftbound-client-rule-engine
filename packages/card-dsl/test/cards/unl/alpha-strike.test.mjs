import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/alpha-strike.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-615c0725c9dee5568f8995d3c574c9270aea149c0f18dc1de8953693293494b2";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Choose a friendly unit. It deals damage equal to its Might split among enemy units at battlefields. " +
  "Then for each unit this kills, do this: Gain 1 XP.";

const [actionKeyword, play] = program.abilities;
const [dealMightSplit, gainXpPerKill] = play.body;

// The reference kernel compares filter values literally, so the production
// Finalize-locked targets are supplied by the harness and the authored
// TargetSpecs (asserted structurally above) are stripped before execution. The
// strip walks the body because the damage instruction declares its own specs.
function withoutTargetSpecs(body) {
  return body.map(({ targets, args, ...instruction }) => ({
    ...instruction,
    args: Object.fromEntries(
      Object.entries(args).map(([key, expression]) => {
        if (key === "body" && expression.kind === "constant" && Array.isArray(expression.value)) {
          return [key, { ...expression, value: withoutTargetSpecs(expression.value) }];
        }
        return [key, expression];
      })
    )
  }));
}
const executableBody = withoutTargetSpecs(play.body);

test("unl-192-219 Alpha Strike: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-192-219 Alpha Strike: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The reason cites the official reflexive-trigger wording, the passive-kill
  // attribution rules and the missing count window.
  assert.match(program.judgeReason, /388/);
  assert.match(program.judgeReason, /389/);
  assert.match(program.judgeReason, /429\.1\.a\.2/);
  assert.match(program.judgeReason, /429\.4/);
  assert.match(program.judgeReason, /323\.4/);
  assert.match(program.judgeReason, /429\.5/);
});

test("unl-192-219 Alpha Strike: [Action], one damage instruction with two TargetSpecs and the printed split", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["alpha-strike.deal-might-split", "alpha-strike.gain-xp-per-kill"]
  );

  assert.equal(dealMightSplit.op, "effect.damage");
  // "It deals damage equal to its Might": the source is the chosen friendly
  // unit and the amount reads that unit's Might at resolution
  // (418.6.b.3 / 143.2 / 359.3.f.1).
  assert.deepEqual(dealMightSplit.args.source, {
    kind: "object-property",
    object: { target: "alpha-strike.friendly-unit" },
    property: "ref"
  });
  assert.deepEqual(dealMightSplit.args.amount, {
    kind: "object-property",
    object: { target: "alpha-strike.friendly-unit" },
    property: "might"
  });
  assert.deepEqual(dealMightSplit.args.target, {
    kind: "constant",
    value: "alpha-strike.enemy-units"
  });
  // 355.14.e: the amounts are assigned at resolution, not at finalization.
  assert.deepEqual(dealMightSplit.args.divide, { kind: "constant", value: true });

  assert.deepEqual(dealMightSplit.targets.map((spec) => spec.id), [
    "alpha-strike.friendly-unit",
    "alpha-strike.enemy-units"
  ]);
  // "Choose a friendly unit" (355.5 / 355.7 / 355.9.a.1).
  assert.deepEqual(dealMightSplit.targets[0], {
    id: "alpha-strike.friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // "enemy units at battlefields": each enemy unit is a target (355.14.a) and
  // the location is only its legality restriction (355.10.b).
  assert.deepEqual(dealMightSplit.targets[1], {
    id: "alpha-strike.enemy-units",
    filter: { type: "unit", controller: "opponent", location: "battlefield" },
    min: 1,
    max: null,
    selection: "any"
  });
});

test("unl-192-219 Alpha Strike: the XP clause reads the missing per-resolution kill count and is linked to the damage", () => {
  // "Then for each unit this kills, do this" references the damage action's
  // result, so the instruction is linked (359.3.e.14) and gated on the result
  // binding the missing if-killed primitive must produce; the amount reads the
  // missing kill count. Both fail closed instead of granting unconditional XP.
  assert.equal(gainXpPerKill.op, "effect.xp");
  assert.equal(gainXpPerKill.linkedTo, "alpha-strike.deal-might-split");
  assert.deepEqual(gainXpPerKill.condition, {
    kind: "expression",
    value: {
      kind: "linked-value",
      instructionId: "alpha-strike.deal-might-split",
      key: "killed"
    }
  });
  assert.deepEqual(gainXpPerKill.args.amount, {
    kind: "linked-value",
    instructionId: "alpha-strike.deal-might-split",
    key: "killedCount"
  });
  assert.deepEqual(gainXpPerKill.args.player, { kind: "constant", value: "controller" });
});

test("unl-192-219 Alpha Strike golden: the printed split really distributes the unit's Might across the enemy targets", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-one", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-two", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const run = runInstruction(
    damage,
    {
      amount: dealMightSplit.args.amount,
      source: dealMightSplit.args.source,
      target: "alpha-strike.enemy-units",
      divide: true
    },
    {
      world: kernel,
      targets: {
        "alpha-strike.friendly-unit": [kernel.ref("friendly")],
        "alpha-strike.enemy-units": [kernel.ref("enemy-one"), kernel.ref("enemy-two")]
      },
      answers: { "effect.damage:divide:0": 3, "effect.damage:divide:1": 2 }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 5);
  assert.equal(kernel.getObject("enemy-one").damage, 3);
  assert.equal(kernel.getObject("enemy-two").damage, 2);
  // The kernel records the dealt amount on the damage events (the event id is
  // the kernel's own sequence, so only the action and amount are asserted).
  assert.deepEqual(run.events.map((event) => event.action), ["damage", "damage"]);
  assert.deepEqual(
    run.result.linkedValues.dealtTo.map((entry) => entry.amount),
    [3, 2]
  );
  // The chosen friendly unit's current Might is what the amount read.
  assert.equal(kernel.getObject("friendly").might, 5);
});

test("unl-192-219 Alpha Strike golden: the source of the damage is the chosen friendly unit, not the spell", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  // 418.6.b.3: "It deals damage" makes the chosen unit the source. The
  // reference kernel records action objects rather than a damage source on its
  // events, so a replacement hook captures the submitted GameAction itself
  // (returning null replaces nothing).
  const submitted = [];
  kernel.addReplacement((action) => {
    if (action.type === "damage") submitted.push(action);
    return null;
  });
  const run = runInstruction(
    damage,
    {
      amount: dealMightSplit.args.amount,
      source: dealMightSplit.args.source,
      target: "alpha-strike.enemy-units",
      divide: true
    },
    {
      world: kernel,
      targets: {
        "alpha-strike.friendly-unit": [kernel.ref("friendly")],
        "alpha-strike.enemy-units": [kernel.ref("enemy")]
      },
      answers: { "effect.damage:divide:0": 2 }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].source.id, "friendly");
  assert.equal(submitted[0].target.id, "enemy");
  assert.equal(submitted[0].amount, 2);
  // The amount is the friendly unit's current Might, not a printed constant.
  assert.equal(kernel.getObject("friendly").might, 2);
  assert.deepEqual(run.result.linkedValues.dealtTo[0].target.id, "enemy");
  assert.equal(kernel.getObject("enemy").damage, 2);
});

test("unl-192-219 Alpha Strike golden: an enemy target that left its battlefield is no longer legally damaged (355.14.h prerequisite)", () => {
  const kernel = world()
    .unit("friendly", { owner: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-one", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-two", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const locked = [kernel.ref("enemy-one"), kernel.ref("enemy-two")];
  // enemy-two leaves the Board after finalization; only the surviving member is
  // damaged (359.3.e.2-359.3.e.8, the 355.14.h "choose which targets cease
  // being targets" case the effect controller resolves in production).
  kernel.perform({ type: "kill", object: kernel.ref("enemy-two") });

  const run = runInstruction(
    damage,
    {
      amount: dealMightSplit.args.amount,
      source: dealMightSplit.args.source,
      target: "alpha-strike.enemy-units",
      divide: true
    },
    {
      world: kernel,
      targets: {
        "alpha-strike.friendly-unit": [kernel.ref("friendly")],
        "alpha-strike.enemy-units": locked
      },
      answers: { "effect.damage:divide:0": 4 }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-one").damage, 4);
  assert.equal(kernel.getObject("enemy-two").zone, "trash");
  assert.equal(run.linked.dealtTo.length, 1);
});

test("unl-192-219 Alpha Strike golden: the XP clause fails closed because no kill count is linked", () => {
  const kernel = world()
    .player("A", { xp: 0 })
    .unit("friendly", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  // The XP clause runs through the real interpreter behind a real, registered
  // primitive that produces no killed binding: its declared condition cannot
  // resolve the linked value, so the clause is ignored instead of granting
  // unconditional XP (contract 3.4 / 3.6).
  const outcome = resolveChainBody(
    [
      {
        id: "alpha-strike.deal-might-split",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 0 } }
      },
      gainXpPerKill
    ],
    kernel
  );

  assert.equal(outcome.status, "partial");
  const xpResult = outcome.results.find((result) => result.id === "alpha-strike.gain-xp-per-kill");
  assert.equal(xpResult.result.status, "ignored");
  assert.equal(kernel.player("A").xp, 0);

  // The primitive really would grant XP when a count exists, so the closure is
  // the missing binding rather than a broken instruction.
  const xpRun = runInstruction(xp, { amount: { kind: "constant", value: 2 } }, { world: kernel });
  assert.equal(xpRun.result.status, "executed");
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(xpRun.linked.gained, 2);
});

test.todo(
  "unl-192-219 Alpha Strike: add the \"for each unit this kills, do this\" reflexive triggered ability to the chain as its own pending item (CR 388 / 389.1; the six Ability forms cannot add a chain item at resolution - RIFT-9 trigger.reflexive)"
);
test.todo(
  "unl-192-219 Alpha Strike: count the units killed by this damage during this resolution (CR 429.1.a.2 / 429.4 / 323.4 passive lethal-damage kill plus 429.5 attribution; the closed history query only counts game actions - engine batch 4)"
);
test.todo(
  "unl-192-219 Alpha Strike: let the effect controller choose which targets cease being targets when the available damage is lower than at resolution (CR 355.14.h / 355.14.h.1; target/target-plan work - RIFT-90)"
);
test.todo(
  "unl-192-219 Alpha Strike: apply the printed [Action] Showdown timing permission through the keyword registry and the chain's canAct (CR 806.1.b; keyword expansion wiring - RIFT-84/RIFT-89)"
);
test.todo(
  "unl-192-219 Alpha Strike: run the entire instruction list - including the divide damage - through the production chain entry point; chain/interpreter-adapter.ts LITERAL_FIELDS does not decode effect.damage's literal divide flag, so resolveChainBody rejects \"divide\": {kind: \"constant\"} with \"effect.damage args.divide must be true when present\" (the primitive and the raw interpreter path both work - engine adapter batch)"
);
