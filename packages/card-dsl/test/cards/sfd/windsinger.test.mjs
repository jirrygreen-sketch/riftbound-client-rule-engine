import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/windsinger.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

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
  // README section 2: the reason names only the current gaps against merged source.
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /Unsupported filter field exclude/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /mayAtFinalize/);
  assert.match(program.judgeReason, /383\.3\.a/);
  assert.match(program.judgeReason, /cost\.hidden has no layer mapping/);
  assert.match(program.judgeReason, /811\.1\.d\.3/);
  assert.match(program.judgeReason, /hidden-cleanup-state/);
  // RIFT-359 landed only the condition/result predicates: it is not an
  // outstanding dependency for this card and must no longer be named.
  assert.doesNotMatch(program.judgeReason, /RIFT-359/);
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

test("sfd-138-221 Windsinger: the printed target filter is refused by the production translator", () => {
  // 355.9.c/740.1.a's "another" is the contract 3.6 exclude anchor; the merged
  // production translator rejects it outright, so the Finalize target plan can
  // never lock the printed candidate set.
  assert.throws(
    () => translateObjectFilter({ type: "unit", zone: "board", location: "battlefield", exclude: "source", mightLte: 3 }),
    error => error.code === "judge-required" && /Unsupported filter field exclude/.test(error.message)
  );
});

test("sfd-138-221 Windsinger: the Might cap has no consumer and a 7-Might unit passes the filter", () => {
  // 143.2.a's effective-Might threshold is not a supported ObjectFilter
  // predicate: the merged layer matcher silently ignores the unknown key, so a
  // 7-Might battlefield unit would be a legal target for "3 Might or less".
  const sevenMight = {
    ref: { id: "big-unit", zoneEntryId: 1 },
    cardId: "card:big-unit",
    name: "big-unit",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    combatRole: null,
    might: 7,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.equal(matchesObjectFilter({ type: "unit", zone: "board", mightLte: 3 }, sevenMight), true);
});

test("sfd-138-221 Windsinger: production trigger binding never sets mayAtFinalize", () => {
  // 383.3.a/.a.1/.a.2: the leading "you may" is the Finalize decision, and
  // TriggerRegistration.mayAtFinalize already exists. The card-program adapter
  // only forwards ability.optional, so the registration cannot reach that
  // Finalize decision.
  const kernel = world().unit("windsinger", { cardId: CARD_ID, types: ["unit"], zone: "board" }).build();
  const source = kernel.getObject("windsinger");
  const { judgeReason: _reason, ...executableProbe } = program;
  // The printed target's exclude anchor and mightLte cap are both refused
  // before registration (gap (1)); drop exactly those two to reach the
  // registration half of gap (2). The card's own filter is covered by the
  // translator test above and cannot be bound as authored today.
  const { exclude: _exclude, mightLte: _mightLte, ...translatableFilter } = triggered.body[0].targets[0].filter;
  const probe = {
    ...executableProbe,
    status: "executable",
    abilities: executableProbe.abilities.map(ability => ability === triggered ? {
      ...ability,
      body: ability.body.map(instruction => ({
        ...instruction,
        targets: instruction.targets.map(target => ({ ...target, filter: translatableFilter }))
      }))
    } : ability)
  };
  const [registration] = triggerRegistrations(new ProgramRegistry([probe]), source);
  assert.equal(registration.optional, true);
  assert.equal(registration.mayAtFinalize, undefined);
});

test("sfd-138-221 Windsinger: the merged Hidden expansion is refused by the production static binder", () => {
  // 811.1: [Hidden] expands to static cost.hidden, whose only merged pieces are
  // the cost plan helpers (811.1.b). The production layer binder has no mapping
  // for that kind and fails closed instead of granting a pretend Hide.
  const kernel = world().unit("windsinger", { cardId: CARD_ID, types: ["spell"], zone: "hand", location: null }).build();
  const source = kernel.getObject("windsinger");
  const binder = createEngineStaticBinder({ layers: createLayerEngine([source]) });
  const [expansion] = keywordDefinitionsById.get("Hidden").expand({ host: { canonicalCardId: CARD_ID } });
  assert.throws(
    () => binder.bindStatic(expansion, source),
    /Static ability kind cost\.hidden has no layer mapping/
  );
});

test.todo(
  "Windsinger: bind the effective-Might <=3 predicate (143.2.a/355.9.b) and the exclude:source anchor " +
    "(355.9.c/740.1.a) into the production target filter and its Finalize target plan; the merged " +
    "translateObjectFilter still rejects the exclude anchor and layers/filter.ts ignores mightLte"
);
test.todo(
  "Windsinger: map the leading optional trigger to TriggerRegistration.mayAtFinalize so 383.3.a's " +
    "decision happens at Finalize; programs/triggers.ts currently forwards only ability.optional"
);
test.todo(
  "Windsinger: connect the static cost.hidden expansion to the Hide action, a facedown zone, next-turn " +
    "Reaction free play and the 811.1.d.3 original-battlefield Play Effect target restriction; " +
    "programs/statics.ts layerFor refuses cost.hidden and cost/kinds/hidden.ts only builds/pays the plan"
);
