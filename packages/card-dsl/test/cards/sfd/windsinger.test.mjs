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

test("Windsinger: validates identity, registration, verbatim source and current blockers", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  for (const gap of [/mightLte/, /exclude/, /RIFT-359/, /383\.3\.a/, /811\.1\.d\.3/]) assert.match(program.judgeReason, gap);
});

test("Windsinger: the leading may is a trigger Finalize decision and keeps all printed target restrictions", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.optional, true);
  assert.deepEqual(triggered.trigger, { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } });
  assert.equal(triggered.body.length, 1);
  assert.equal(returnToHand.op, "effect.zone");
  assert.equal(returnToHand.linkedTo, undefined);
  assert.deepEqual(returnToHand.args, {
    target: { kind: "constant", value: TARGET_ID },
    to: { kind: "constant", value: "hand" },
    amount: { kind: "constant", value: 1 }
  });
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

test("Windsinger: Hidden expands through the real keyword registry", () => {
  const definition = keywordDefinitionsById.get("Hidden");
  assert.ok(definition);
  const [expansion] = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "cost.hidden");
});

test.todo("Windsinger: bind effective Might <=3 and exclude:source in the production target filter (RIFT-359)");
test.todo("Windsinger: map the leading optional trigger to mayAtFinalize (383.3.a)");
test.todo("Windsinger: complete Hide/next-turn Reaction play and the original-battlefield Play Effect restriction (811.1.b/811.1.d.3)");
