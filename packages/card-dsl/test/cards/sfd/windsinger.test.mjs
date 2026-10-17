import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/windsinger.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-75f4edacd5ddc4bb087703bc231650c3942cea51f1bdb7b370bd27a6da6fd390";
const SOURCE_TEXT =
  "Hidden (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, you may return another unit at a battlefield with 3 :rb_might: or less to its owner's hand.";
const TARGET_ID = "windsinger.other-small-unit";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [hidden, triggered] = program.abilities;
const [mayReturn] = triggered.body;
const [returnToHand] = mayReturn.args.body.value;

// The card's return half is driven with a Finalize-locked target - exactly the
// shape the production chain hands to the primitive.
function runReturn(kernel, unitRef) {
  return runInstruction(
    zone,
    {
      target: returnToHand.args.target.value,
      to: returnToHand.args.to,
      amount: returnToHand.args.amount
    },
    { world: kernel, targets: { [TARGET_ID]: unitRef === undefined ? [] : [unitRef] } }
  );
}

test("sfd-138-221 Windsinger: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-138-221 Windsinger: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason names the concrete current gaps and task numbers.
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-138-221 Windsinger: Hidden keyword declared, never re-expanded in the card", () => {
  assert.equal(program.abilities.length, 2);
  // 811.1: the Hide permission and its cost expansion live in the merged
  // effects/keywords/Hidden.ts, so the card only names the keyword (contract 3.7).
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(triggered.kind, "triggered");
  // 383.4.a / 383.4.a.1: "When you play me" is a Play Effect on card-played.
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
  // 403.1: the printed "you may" is the instruction-level optional wrapper, not
  // a separate trigger-level decision, so the ability itself is mandatory.
  assert.equal(triggered.optional, false);
});

test("sfd-138-221 Windsinger: contract 3.9 may-shape with the return target on the may node", () => {
  assert.deepEqual(triggered.body.map((instruction) => instruction.id), ["windsinger.may-return"]);
  assert.equal(mayReturn.op, "choice.optional");
  assert.deepEqual(mayReturn.args.prompt, {
    kind: "constant",
    value: "Return another unit at a battlefield with 3 Might or less to its owner's hand?"
  });
  assert.equal(mayReturn.args.body.kind, "constant");
  assert.deepEqual(mayReturn.args.body.value.map((instruction) => instruction.id), [
    "windsinger.return-to-hand"
  ]);
  // Contract 3.9 forbids the choice + linkedTo spelling.
  assert.equal(mayReturn.linkedTo, undefined);

  // 355.7 / 355.12: "another unit at a battlefield" is chosen, so it is a target
  // locked together with the may-action. "another" excludes the source (355.9.c)
  // through the symbolic exclude selector; "at a battlefield" is a location
  // restriction (355.10.b). The Might cap stays descriptive (see judgeReason).
  assert.equal(mayReturn.targets.length, 1);
  const [target] = mayReturn.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, {
    type: "unit",
    zone: "board",
    location: "battlefield",
    exclude: "source",
    mightLte: 3
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(mayReturn.picks, undefined);

  // The body moves the chosen unit to its owner's hand through the closed
  // return-to-hand action (448.2: a zone change, not a Move).
  assert.equal(returnToHand.op, "effect.zone");
  assert.deepEqual(returnToHand.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(returnToHand.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnToHand.args.amount, { kind: "constant", value: 1 });
  assert.equal(returnToHand.linkedTo, undefined);
  assert.equal(returnToHand.targets, undefined);
});

test("sfd-138-221 Windsinger golden: the locked unit goes to its OWNER's hand, not the caster's (108.1)", () => {
  const kernel = world()
    .unit("windsinger", { might: 1, location: BATTLEFIELD })
    .unit("small-enemy", { might: 3, owner: "B", controller: "B", location: BATTLEFIELD })
    .build();
  const run = runReturn(kernel, kernel.ref("small-enemy"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["return-to-hand"]);
  assert.equal(run.linked.moved, 1);
  assert.deepEqual(run.linked.destination, "hand");
  assert.equal(kernel.getObject("small-enemy").zone, "hand");
  assert.deepEqual(kernel.objectsInZone("B", "hand").map((ref) => ref.id), ["small-enemy"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
});

test("sfd-138-221 Windsinger golden: a reference that left the zone is ignored (359.3.e.6-e.8)", () => {
  const kernel = world()
    .unit("windsinger", { might: 1, location: BATTLEFIELD })
    .unit("fleeing-enemy", { might: 2, owner: "B", controller: "B", location: BATTLEFIELD })
    .build();
  const stale = kernel.ref("fleeing-enemy");
  // The unit changes zones after Finalize but before resolution.
  kernel.perform({ type: "return-to-hand", object: stale });

  const run = runReturn(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("fleeing-enemy").zone, "hand");
});

test("sfd-138-221 Windsinger golden: no legal target leaves the return with nothing to move", () => {
  const kernel = world().unit("windsinger", { might: 1, location: BATTLEFIELD }).build();
  const run = runReturn(kernel, undefined);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
});

test("sfd-138-221 Windsinger: the merged Hidden expansion exists but has no consumer", () => {
  // RIFT-84 merged cost.hidden as a static effect; nothing consumes it (no Hide
  // action, no facedown zone), which is the gap the judgeReason records.
  const definition = keywordDefinitionsById.get("Hidden");
  assert.ok(definition, "effects/keywords/Hidden.ts must be registered");
  const [expansion] = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "cost.hidden");
});

test.todo(
  "sfd-138-221 Windsinger: enforce the '3 :rb_might: or less' return ceiling at Finalize/Resolve " +
    "(355.9.b / 143.2.a effective-Might predicate) once a Might filter predicate is merged (RIFT-81~91)."
);

test.todo(
  "sfd-138-221 Windsinger: teach programs/filters.ts the contract 3.6 `exclude`/`here` anchors (and register the " +
    "trigger through the CardProgram binding) so the printed 'another' restriction can be bound honestly " +
    "(RIFT-257 follow-up)."
);

test.todo(
  "sfd-138-221 Windsinger: the [Hidden] expansion (811.1) needs the cost.hidden / Hide path consumer: the " +
    "Hide Discretionary Action, the facedown zone, and the free play from facedown for [A] (RIFT-89)."
);
