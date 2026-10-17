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
const [returnToHand] = triggered.body;

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
  assert.match(program.judgeReason, /811\.1\.d\.3/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /383\.3\.a/);
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
  assert.deepEqual(triggered.trigger, { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } });
  // 383.3.a: the leading "you may" is a trigger decision at Finalize.
  assert.equal(triggered.optional, true);
});

test("sfd-138-221 Windsinger: the Finalize may keeps a single direct return and its target", () => {
  assert.deepEqual(triggered.body.map((instruction) => instruction.id), ["windsinger.return-to-hand"]);
  assert.equal(triggered.body.length, 1);
  assert.equal(triggered.optional, true);
  // The former resolution-time prompt is represented by the leading printed may
  // and optional:true; there is no second optional decision during resolution.
  assert.match(program.sourceText, /When you play me, you may return another unit/);
  assert.equal(returnToHand.linkedTo, undefined);

  // 355.7 / 355.12: "another unit at a battlefield" is chosen, so it is a target
  // locked together with the may-action. "another" excludes the source (355.9.c)
  // through the symbolic exclude selector; "at a battlefield" is a location
  // restriction (355.10.b). The Might cap stays descriptive (see judgeReason).
  assert.equal(returnToHand.targets.length, 1);
  const [target] = returnToHand.targets;
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
  assert.equal(returnToHand.picks, undefined);

  // The body moves the chosen unit to its owner's hand through the closed
  // return-to-hand action (448.2: a zone change, not a Move).
  assert.equal(returnToHand.op, "effect.zone");
  assert.deepEqual(returnToHand.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(returnToHand.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnToHand.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(returnToHand.args, {
    target: { kind: "constant", value: TARGET_ID },
    to: { kind: "constant", value: "hand" },
    amount: { kind: "constant", value: 1 }
  });
  assert.equal(returnToHand.linkedTo, undefined);
  assert.deepEqual(returnToHand.targets, [{
    id: TARGET_ID,
    filter: { type: "unit", zone: "board", location: "battlefield", exclude: "source", mightLte: 3 },
    min: 1, max: 1, selection: "one"
  }]);
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

test("sfd-138-221 Windsinger: Hidden expands through the real keyword registry", () => {
  const definition = keywordDefinitionsById.get("Hidden");
  assert.ok(definition, "effects/keywords/Hidden.ts must be registered");
  const [expansion] = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "cost.hidden");
});

test.todo("Windsinger: bind effective Might <=3 and exclude:source in the production target filter (RIFT-359)");
test.todo("Windsinger: map the leading optional trigger to mayAtFinalize (383.3.a)");
test.todo("Windsinger: complete Hide/next-turn Reaction play and the original-battlefield Play Effect restriction (811.1.b/811.1.d.3)");
