import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/decree-of-discord.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-4691711da635261037a803f4f36b852363c66f425acc01fe7259b51e4045a69e";
const SOURCE_TEXT =
  "Return any number of enemy Order (:rb_rune_order:) units with total Might 5 or less " +
  "to their owners' hands.";

const [play] = program.abilities;
const [returnUnits] = play.body;
const targetSpec = returnUnits.targets[0];

/** Execute the merged return half with the Finalize-locked targets the chain supplies. */
function runReturn(kernel, refs) {
  return runInstruction(
    zone,
    {
      target: returnUnits.args.target.value,
      to: returnUnits.args.to,
      amount: returnUnits.args.amount
    },
    { world: kernel, targets: { [targetSpec.id]: refs } }
  );
}

test("ven-107-166 Decree of Discord: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-107-166 Decree of Discord: judgeReason names the group constraint and the domain predicate", () => {
  // CR 355.11 group targeting + 134 domain vocabulary: both are the declared gaps.
});

test("ven-107-166 Decree of Discord: one return instruction with an any-number target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);

  // 355.7 / 355.13: the named units are chosen targets, and "any number" includes zero.
  assert.deepEqual(returnUnits.args, {
    target: { kind: "constant", value: "decree-of-discord.enemy-order-units" },
    to: { kind: "constant", value: "hand" }
  });
  assert.deepEqual(targetSpec, {
    id: "decree-of-discord.enemy-order-units",
    filter: {
      type: "unit",
      zone: "board",
      controller: "opponent",
      targetRestriction: "domain-order"
    },
    min: 0,
    max: null,
    selection: "any",
    // The 355.11 group marker for the shared total-Might restriction (no consumer yet).
    group: true
  });
  assert.equal(returnUnits.op, "effect.zone");
  assert.equal(returnUnits.picks, undefined);
  assert.equal(returnUnits.linkedTo, undefined);
  assert.deepEqual(returnUnits.condition, {
    kind: "compare",
    left: { kind: "count", subject: "objects", filter: { object: { target: targetSpec.id } } },
    operator: "gt", right: { kind: "constant", value: 0 }
  });
});

test("ven-107-166 Decree of Discord golden: locked enemy units return to their OWNER's hands", () => {
  const kernel = world()
    .unit("enemy-small", { owner: "B", controller: "B", might: 2 })
    .unit("enemy-big", { owner: "B", controller: "B", might: 3 })
    .build();
  const run = runReturn(kernel, [kernel.ref("enemy-small"), kernel.ref("enemy-big")]);

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand", "return-to-hand"]);
  // 127.1: the cards go to their owners' hands, not the caster's.
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["enemy-small", "enemy-big"]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(run.linked.moved, 2);
});

test("ven-107-166 Decree of Discord golden: a stale locked reference is ignored (359.3.e.6-e.8)", () => {
  const kernel = world().unit("gone", { owner: "B", controller: "B", might: 2 }).build();
  const stale = kernel.ref("gone");
  // The unit changes zones before resolution, so the old zone-bound reference is dead.
  kernel.perform({ type: "return-to-hand", object: stale });

  const run = runReturn(kernel, [stale]);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["gone"]);
});



test("decree-of-discord: the review records the current blockers", () => {
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /power:null/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test.todo("decree-of-discord: 355.11: enforce total Might <= 5 and maximum legal subset reselection at resolution");

test.todo("decree-of-discord: 134: match Order domain independently of printed Power cost (RIFT-359)");

test("Decree of Discord supported return: a stolen unit returns to its owner's hand", () => {
  const kernel = world().unit("stolen", { owner: "A", controller: "B", might: 2 }).build();
  const run = runReturn(kernel, [kernel.ref("stolen")]);
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["stolen"]);
  assert.deepEqual(kernel.zone("B", "hand"), []);
});

test("Decree of Discord supported return: choosing no units returns none", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
});
