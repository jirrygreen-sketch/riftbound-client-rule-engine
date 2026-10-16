import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/back-off.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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

// The production chain adapter (chain/interpreter-adapter.ts LITERAL_FIELDS)
// does not list effect.stun's `target`, so it re-validates the evaluated
// TargetSpec id as an Expr and throws (recorded in the test.todo below and in
// ogn/solari-shieldbearer). For the body run this one field is decoded locally
// to the plain id — exactly what the adapter would produce once the field is
// registered — so the card's own instruction order, condition and ops stay
// untouched.
const decodedBody = (body) =>
  body.map((instruction) =>
    instruction.op === "effect.stun"
      ? { ...instruction, args: { target: instruction.args.target.value } }
      : { ...instruction }
  );

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
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason must name the real gap (the play origin) plus the keyword
  // expansion dependencies — not a generic "not implemented".
  assert.match(program.judgeReason, /playedFromHand/);
  assert.match(program.judgeReason, /356\.1/);
  assert.match(program.judgeReason, /RIFT-84/);
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
  // "If you played this from your hand": the play-origin fact has no merged
  // consumer, so the condition reads it from the source characteristics; a
  // missing characteristic fails closed (ignored), never an unconditional draw.
  assert.deepEqual(drawInstruction.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "source", property: "playedFromHand" },
    operator: "eq",
    right: { kind: "constant", value: true }
  });
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

test("unl-042-219 Back Off golden: the draw clause draws when the play-origin fact says hand", () => {
  const kernel = world().deck(["top-card", "next-card"], { owner: "A" }).build();
  const scoped = kernel.clone({
    sourceSnapshot: { ...kernel.source, playedFromHand: true }
  });

  const outcome = resolveChainBody([drawInstruction], scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["back-off.draw-if-from-hand", "executed"]
  ]);
  assert.deepEqual(scoped.objectsInZone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(scoped.player("A").deckSize, 1);
});

test("unl-042-219 Back Off golden: without the play-origin fact the draw fails closed, the stun still resolves", () => {
  // "If you played this from your hand" has no merged play-origin fact. Reading
  // the absent characteristic is MissingInformation, which the interpreter
  // reports as ignored/mistargeted — it never turns into an unconditional draw.
  const kernel = stunnedKernel();
  kernel.setTargets("back-off.stunned-unit", [kernel.ref("enemy")]);

  const outcome = resolveChainBody(decodedBody(play.body), kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["back-off.stun-unit", "executed", null],
      ["back-off.draw-if-from-hand", "ignored", "mistargeted"]
    ]
  );
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.equal(kernel.player("A").deckSize, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
});

test.todo(
  "unl-042-219 Back Off: the printed '[Stun] a unit' through the production chain adapter needs " +
    "effect.stun's literal `target` field decoded (chain/interpreter-adapter.ts LITERAL_FIELDS) — " +
    "the merged primitive reads it as a TargetSpec id (RIFT-119 primitive; the golden uses the " +
    "interpreter's default registry, matching the merged sfd/ogn effect.stun precedent)"
);

test.todo(
  "unl-042-219 Back Off: 'If you played this from your hand' needs an observable play-origin fact " +
    "(CR 356.1 / 356.2) on ObjectSnapshot or the card-played event payload; nothing merged exposes it"
);

test.todo(
  "unl-042-219 Back Off: [Hidden] (CR 811) expansion — the Hide discretionary action, the facedown " +
    "zone permission and the free played-from-facedown cost — is owned by RIFT-84; [Action] (CR 806) " +
    "needs the continuous.timing consumer and chain canAct wiring (RIFT-85 / RIFT-91)"
);
