import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/back-off.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-8976907cb3568b5c00ce51faf4a35f8342adffe884444d535f12324bb4ae3778";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Stun] a unit. (It doesn't deal combat damage this turn.)\n" +
  "If you played this from your hand, draw 1.";

const [hiddenKeyword, actionKeyword, play] = program.abilities;
const [stunInstruction, drawInstruction] = play.body;

const stunnedKernel = () => world().unit("enemy", { owner: "B", might: 3 }).build();

test("unl-042-219 Back Off: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-042-219 Back Off: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // Current-gap refresh: the merged play-origin predicate replaced the
  // unreadable ObjectSnapshot characteristic; the remaining gap is the Chain
  // not supplying the event payload to a card's own play.body resolution.
  assert.match(program.judgeReason, /played-from-hand/);
  assert.match(program.judgeReason, /conditionInputs/);
  assert.match(program.judgeReason, /356\.1/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /hidden-cleanup-state/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason must name the real gap (the play origin) plus the keyword
  // expansion dependencies — not a generic "not implemented".
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-042-219 Back Off: [Hidden] + [Action] keywords and the printed play body", () => {
  assert.equal(program.abilities.length, 3);
  // 811 / 806: permission keywords are declared only; the registry owns their
  // expansion (keyword files + chain timing permission).
  assert.deepEqual(hiddenKeyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(hiddenKeyword.value, undefined);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["back-off.stun-unit", "effect.stun"],
      ["back-off.draw-if-from-hand", "effect.draw"]
    ]
  );
});

test("unl-042-219 Back Off: [Stun] a unit is one board-unit target for effect.stun", () => {
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "back-off.stunned-unit" }
  });
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.equal(stunInstruction.picks, undefined);
  assert.equal(stunInstruction.condition, undefined);
  // 355.5 / 355.10: "a unit" is a Choice of one specific game object, so it is
  // a target; 424.1 limits candidates to Board units (enemy or friendly).
  assert.deepEqual(stunInstruction.targets, [
    {
      id: "back-off.stunned-unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(instructionDefinitionsById.get("effect.stun"), stun);
});

test("unl-042-219 Back Off: the draw clause is guarded by the play-origin fact and not linked to the stun", () => {
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  // The two printed sentences are independent: the draw is not linked to the
  // stun (055 / 359.3.e.11), so a failed stun does not suppress the draw.
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  // "If you played this from your hand" (356.1/356.2): RIFT-359 merged the
  // play-origin predicate, which reads the resolving event's from-zone fact for
  // the selected event role. The card uses it instead of an ObjectSnapshot
  // characteristic that the contract never exposes. The card's own play.body
  // resolution still receives no event payload (see judgeReason), so the whole
  // card stays judge-required while the branch itself stays fail-closed.
  assert.deepEqual(drawInstruction.condition, { kind: "played-from-hand", object: "source" });
});

test("unl-042-219 Back Off golden: the printed [Stun] clause stuns the chosen unit (CR 424.1)", () => {
  const kernel = stunnedKernel();
  kernel.setTargets("back-off.stunned-unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody([stunInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["back-off.stun-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
  assert.equal(outcome.results[0].result.linkedValues.stunned.count, 1);
});

test("unl-042-219 Back Off golden: an already-Stunned unit is a legal no-op (CR 424.1.a.1)", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 3, stunned: true }).build();
  kernel.setTargets("back-off.stunned-unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody([stunInstruction], kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.stunned.count, 0);
  assert.equal(outcome.results[0].result.linkedValues.stunned.alreadyStunned, 1);
  assert.deepEqual(outcome.events, []);
});

test("Back Off: the supported draw primitive draws one card; play-origin binding remains unverified", () => {
  const kernel = world().deck(["top-card", "next-card"], { owner: "A" }).build();
  // Isolate the declared draw component without fabricating a play-origin fact
  // on the source snapshot. The production chain path that must supply the
  // event payload is exercised by its own scenario below.
  const outcome = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(outcome.result.status, "executed");
  assert.deepEqual(kernel.objectsInZone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
});

test("Back Off: the original conditional draw fails closed when the play-origin fact is unavailable", () => {
  const kernel = world().deck(["top-card", "next-card"], { owner: "A" }).build();
  const outcome = runAbilityBody([drawInstruction], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["back-off.draw-if-from-hand", "ignored", "mistargeted"]
  ]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.equal(kernel.player("A").deckSize, 2);
  assert.deepEqual(outcome.events, []);
});

test("Back Off golden: the merged play-origin predicate draws from hand and refuses a play from Trash (356.1/356.2)", () => {
  // README section 4: run the real body through the production argument adapter
  // with the read-only event payload RIFT-359 introduced. The predicate itself is
  // merged; what is still missing is the Chain supplying it for a card's own
  // play.body resolution (see judgeReason).
  const fromHand = world()
    // The source sits on the Chain while its Play Effect resolves (353.2/383.4.a);
    // only the resolving event's from-zone fact decides the branch.
    .card("back-off", { cardId: "back-off", types: ["spell"], zone: "chain" })
    .deck(["top-card", "next-card"], { owner: "A" })
    .build();
  const handScoped = fromHand.clone({ sourceSnapshot: fromHand.getObject("back-off") });
  const played = resolveChainBody([drawInstruction], handScoped, {
    event: {
      timingPoint: "card-played",
      fromZone: "hand",
      playedFromZone: "hand",
      playedFromHand: true,
      object: { ref: handScoped.ref("back-off"), zone: "chain", fromZone: "hand" },
      source: { ref: handScoped.ref("back-off"), zone: "chain", fromZone: "hand" }
    }
  });
  assert.equal(played.status, "executed");
  assert.deepEqual(played.results.map(entry => [entry.id, entry.result.status]), [
    ["back-off.draw-if-from-hand", "executed"]
  ]);
  assert.deepEqual(handScoped.objectsInZone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.equal(handScoped.player("A").deckSize, 1);

  const fromTrash = world()
    .card("back-off", { cardId: "back-off", types: ["spell"], zone: "chain" })
    .deck(["top-card", "next-card"], { owner: "A" })
    .build();
  const trashScoped = fromTrash.clone({ sourceSnapshot: fromTrash.getObject("back-off") });
  const notFromHand = resolveChainBody([drawInstruction], trashScoped, {
    event: {
      timingPoint: "card-played",
      fromZone: "trash",
      playedFromZone: "trash",
      object: { ref: trashScoped.ref("back-off"), zone: "chain", fromZone: "trash" },
      source: { ref: trashScoped.ref("back-off"), zone: "chain", fromZone: "trash" }
    }
  });
  // 359.3.e.11 / condition semantics: a false play-origin test skips the branch
  // instead of drawing unconditionally.
  assert.equal(notFromHand.status, "partial");
  assert.deepEqual(notFromHand.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["back-off.draw-if-from-hand", "negated", "skipped"]
  ]);
  assert.deepEqual(trashScoped.objectsInZone("A", "hand"), []);
  assert.equal(trashScoped.player("A").deckSize, 2);
});

test("Back Off: the production chain adapter still rejects the declared effect.stun argument envelope (CR 424.1)", () => {
  // Evidence for judgeReason (3): LITERAL_FIELDS in chain/interpreter-adapter.ts
  // has no effect.stun entry, so the Expr-wrapped target reaches the frozen
  // primitive schema unchanged and the resolution fails before Stun executes.
  const kernel = world().unit("enemy", { owner: "B", might: 3 }).build();
  kernel.setTargets("back-off.stunned-unit", [kernel.ref("enemy")]);
  assert.throws(() => resolveChainBody([stunInstruction], kernel),
    /effect\.stun target must be a spec id string/);
  assert.equal(kernel.getObject("enemy").stunned, false);
});

test.todo("back-off: supply the resolving event's play-origin payload to a card's own play.body so the merged played-from-hand predicate can evaluate it (CR 356.1/356.2)");

test.todo("back-off: consume Hidden cost.hidden in the Hide action and facedown play timing/cost flow (CR 811)");
