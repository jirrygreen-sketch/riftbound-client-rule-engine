import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-burrower.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const reveal = (await import(new URL("effects/instructions/effect.reveal.js", ENGINE))).default;
const recycle = (await import(new URL("effects/instructions/effect.recycle.js", ENGINE))).default;

const CANONICAL_ID = "card.hash-289ad4d681c7cb59dd55bae00863be7516f68dff172a97e886f4ff7920625b0c";
const SOURCE_TEXT =
  "When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck. " +
  "You may play one. Then recycle the rest.";

const [ability] = program.abilities;
const [exhaustSelf, revealTopTwo, mayPlay, recycleRest] = ability.body;
const [playOne] = mayPlay.args.body.value;

/**
 * The merged chain adapter (chain/interpreter-adapter.ts) unwraps a primitive's
 * Expr-wrapped literal selectors only for the fields its LITERAL_FIELDS table
 * declares. For this card's body that table is missing two entries:
 *   - 'effect.reveal' lists only ['target'], so the Expr-wrapped `pick` reaches the
 *     primitive and is refused ("pick must be a non-empty id");
 *   - 'effect.exhaust' lists ['target','pick','choice'] — `choose` (the descriptor
 *     this card and ogn/relentless-storm use) is not listed at all, so the
 *     descriptor reaches the primitive wrapped and is refused too;
 *   - the effect.play arguments nested inside choice.optional's body also arrive
 *     wrapped, because the adapter only descends into `body` for the structural
 *     control nodes it recognizes by opcode (sequence/repeat/choice.optional) — it
 *     does unwrap choice.optional's body, so this card's nested play keeps its
 *     'pick'/'choice' only when that table entry is present.
 * Both are adapter-side wiring gaps outside this task's write scope (judgeReason
 * item 3 and the contract-change request). The test therefore drives the body
 * through the REAL interpreter and the REAL registered primitives, with exactly
 * those two declarations unwrapped — the same construction the adapter performs
 * for every field it does list. It does not replace the primitives, fake the
 * choices, or rewrite the card's arguments.
 */
const CORRECTED_LITERAL_FIELDS = {
  'effect.exhaust': ['target', 'pick', 'choose'],
  'effect.play': ['target', 'pick', 'choice'],
  'effect.reveal': ['target', 'pick']
};
const unwrappedRegistry = new Map([...instructionDefinitionsById].map(([op, definition]) => [op, {
  op,
  argsSchema: {
    parse: (envelope) => {
      const raw = { ...envelope.primitiveArgs };
      for (const key of CORRECTED_LITERAL_FIELDS[op] ?? []) {
        const candidate = raw[key];
        if (candidate && typeof candidate === 'object' && 'kind' in candidate &&
          (candidate.kind === 'constant' || candidate.kind === 'literal')) raw[key] = candidate.value;
      }
      return definition.argsSchema.parse(raw);
    }
  },
  execute: (context, args) => definition.execute(context, args)
}]));

/**
 * The production caller must resolve the printed "your Main Deck" and the ordered
 * deck top through the contract 3.6 zoneSlice. `resolveBody` mirrors the merged
 * adapter's instruction preparation (primitive arguments wrapped in one literal
 * envelope) while using the corrected field table above.
 */
function prepare(body) {
  return body.map((instruction) => {
    if (instructionDefinitionsById.has(instruction.op)) {
      return { ...instruction, args: { primitiveArgs: { kind: "constant", value: instruction.args } } };
    }
    const args = Object.fromEntries(Object.entries(instruction.args).map(([key, expr]) => {
      if ((expr.kind === "constant" || expr.kind === "literal") && key === "body" && Array.isArray(expr.value)) {
        return [key, { ...expr, value: prepare(expr.value) }];
      }
      return [key, expr];
    }));
    return { ...instruction, args };
  });
}
const resolveBody = (body, context) => runAbilityBody(prepare(body), context, unwrappedRegistry);

function conquerWorld() {
  const kernel = world()
    .deck(["d1", "d2", "d3"])
    .unit("void-burrower", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("void-burrower") });
  // 425.3.a / contract 3.6: the top two cards in real deck order, supplied by the
  // caller from zoneSlice (the set-query vocabulary cannot express deck order).
  context.setPicks("void-burrower.top-two", context.zoneSlice("A", "deck", "top", 2).map((object) => object.ref));
  return context;
}

test("sfd-187-221 Void Burrower: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-187-221 Void Burrower: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The four recorded blockers, including the identity's printing difference.
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /sfd-243-221/);
  assert.match(program.judgeReason, /428\.1/);
});

test("sfd-187-221 Void Burrower: conquer trigger, leading may, exhaust, reveal, play, recycle in printed order", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c.2.b / 190.6.d: "you conquer" is this ability's controller conquering;
  // the closed EventPattern spelling is "conquered".
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquered", player: "self" });
  // 383.3.a: the leading "you may" is the ability's own Finalize decision.
  assert.equal(ability.optional, true);
  assert.equal(ability.trigger.once, undefined);

  assert.deepEqual(ability.body.map((instruction) => [instruction.id, instruction.op]), [
    ["void-burrower.exhaust-self", "effect.exhaust"],
    ["void-burrower.reveal-top-two", "effect.reveal"],
    ["void-burrower.may-play-one", "choice.optional"],
    ["void-burrower.recycle-rest", "effect.recycle"]
  ]);

  // 383.3.b / 355.10.c.1: "exhaust me" is the trigger's base cost and is not a
  // target, so it is a non-target choose anchored to the source.
  assert.deepEqual(exhaustSelf.args, {
    choose: {
      kind: "constant",
      value: { id: "void-burrower.exhaust-self", filter: { object: "self" } }
    }
  });
  assert.equal(exhaustSelf.targets, undefined);
  assert.equal(exhaustSelf.picks, undefined);
  assert.equal(exhaustSelf.linkedTo, undefined);

  // 425.1 / 425.3.a: the top two are an ordered pick, never a count over a set
  // query (effect.reveal refuses that shape outright).
  assert.deepEqual(revealTopTwo.args, { pick: { kind: "constant", value: "void-burrower.top-two" } });
  assert.deepEqual(revealTopTwo.picks, [
    {
      id: "void-burrower.top-two",
      options: ["dynamic:top-two-main-deck-cards"],
      selection: "all"
    }
  ]);
  assert.equal(revealTopTwo.targets, undefined);

  // 383.3.a.3 / contract 3.9: the later "You may play one" is one choice.optional
  // whose body holds the chosen instruction (never a bare choice plus a linkedTo
  // consumer).
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(mayPlay.args.body.value.map((instruction) => [instruction.id, instruction.op]), [
    ["void-burrower.play-one", "effect.play"]
  ]);
  assert.equal(mayPlay.linkedTo, undefined);
  // 420.3.a / 420.3.b: the play reads the revealed cards as a non-target pick and
  // supplies no cost override, leaving the printed Play procedure to pay the
  // card's own cost.
  assert.equal(playOne.picks[0].id, "void-burrower.play-one");
  assert.deepEqual(playOne.picks[0].options, [
    { kind: "linked-value", instructionId: "void-burrower.reveal-top-two", key: "revealed" }
  ]);
  assert.deepEqual(playOne.args.choice, {
    kind: "constant",
    value: { id: "void-burrower.play-one-choice", min: 1, max: 1 }
  });
  assert.equal(playOne.args.cost, undefined);
  assert.equal(playOne.args.location, undefined);

  // 417.1.a / 417.4: "Then recycle the rest" recycles the revealed set; the played
  // card's stale deck identity drops out by 124, and the instruction is not linked
  // to the optional play (359.3.e.11).
  assert.deepEqual(recycleRest.args, {
    objects: { kind: "linked-value", instructionId: "void-burrower.reveal-top-two", key: "revealed" }
  });
  assert.equal(recycleRest.linkedTo, undefined);
});

test("sfd-187-221 Void Burrower: accepting plays one revealed card and recycles the other", () => {
  const kernel = conquerWorld();
  kernel.setPicks("void-burrower.play-one", [kernel.ref("d1")]);
  kernel.setAnswers({
    "void-burrower.may-play-one/optional": true,
    "void-burrower.may-play-one/void-burrower.play-one/void-burrower.play-one-choice": [kernel.ref("d1")]
  });
  const outcome = resolveBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["void-burrower.exhaust-self", "executed"],
    ["void-burrower.reveal-top-two", "executed"],
    ["void-burrower.play-one", "executed"],
    ["void-burrower.may-play-one", "executed"],
    ["void-burrower.recycle-rest", "executed"]
  ]);

  // The legend exhausted itself (the printed cost instruction ran for real), the
  // chosen card left the deck for the board, and the remaining revealed card was
  // recycled to the bottom of the Main Deck.
  assert.equal(kernel.getObject("void-burrower").exhausted, true);
  // The legend is on the Board too, so the board holds itself plus the played card.
  assert.deepEqual(kernel.zone("A", "board").map((ref) => ref.id), ["void-burrower", "d1"]);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d3", "d2"]);
  assert.deepEqual(kernel.events.map((event) => event.action).filter(Boolean), [
    "exhaust",
    "reveal",
    "reveal",
    "play",
    "recycle"
  ]);
  assert.equal(outcome.results.at(-1).result.linkedValues.recycledCount, 1);
});

test("sfd-187-221 Void Burrower: declining the play still recycles every revealed card", () => {
  // 359.3.e.11: "Then recycle the rest." is not gated on the optional play.
  const kernel = conquerWorld();
  kernel.setAnswers({ "void-burrower.may-play-one/optional": false });
  const outcome = resolveBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status, result.result.reason ?? null]), [
    ["void-burrower.exhaust-self", "executed", null],
    ["void-burrower.reveal-top-two", "executed", null],
    ["void-burrower.may-play-one", "negated", "skipped"],
    ["void-burrower.recycle-rest", "executed", null]
  ]);
  assert.equal(kernel.getObject("void-burrower").exhausted, true);
  // Nothing was played: only the legend remains on the Board.
  assert.deepEqual(kernel.zone("A", "board").map((ref) => ref.id), ["void-burrower"]);
  // Both revealed cards recycle in revealed top-to-bottom order (417.4 / 417.5.a).
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d3", "d1", "d2"]);
  assert.equal(outcome.results.at(-1).result.linkedValues.recycledCount, 2);
});

test("sfd-187-221 Void Burrower: an already-exhausted legend shows why a state change cannot stand in for the cost", () => {
  // 415.1.b / 415.1.c: exhausting an already exhausted object does nothing extra,
  // and effect.exhaust treats that as a successful no-effect execution with a zero
  // count rather than a failure. The linking therefore does NOT stop the body: the
  // reveal and the recycle still run. That negative evidence is exactly judgeReason
  // item 2 — the printed "exhaust me" is a Finalize base cost that must make the
  // trigger unperformable when it cannot be paid, which a resolution-time state
  // change cannot express. The golden states the real behaviour instead of
  // claiming the cost is enforced.
  const kernel = conquerWorld();
  kernel.perform({ type: "exhaust", object: kernel.ref("void-burrower") });
  kernel.setAnswers({ "void-burrower.may-play-one/optional": false });
  const outcome = resolveBody(ability.body, kernel);

  const exhaustResult = outcome.results.find((result) => result.id === "void-burrower.exhaust-self");
  assert.equal(exhaustResult.result.status, "executed");
  assert.equal(exhaustResult.result.linkedValues.exhausted.count, 0);
  assert.equal(exhaustResult.result.linkedValues.exhausted.alreadyExhausted, 1);
  // The no-op exhaust did not stop the linked body: both revealed cards recycled.
  assert.equal(outcome.results.at(-1).result.linkedValues.recycledCount, 2);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d3", "d1", "d2"]);
  assert.equal(kernel.getObject("void-burrower").exhausted, true);
  assert.deepEqual(kernel.events.map((event) => event.action).filter(Boolean), [
    "exhaust",
    "reveal",
    "reveal",
    "recycle",
    "recycle"
  ]);
});

test("sfd-187-221 Void Burrower: the merged reveal primitive accepts the ordered pick and links real refs", () => {
  // 425.1.a.2: revealing leaves the cards where they are; only the ordered pick
  // carries the real top-of-deck order (contract 3.6 zoneSlice).
  const kernel = world().deck(["d1", "d2", "d3"]).build();
  const topTwo = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  const run = runInstruction(reveal, { pick: "void-burrower.top-two" }, {
    world: kernel,
    picks: { "void-burrower.top-two": topTwo }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 2);
  assert.deepEqual(run.linked.revealed.map((ref) => ref.id), ["d1", "d2"]);
  assert.deepEqual(run.events.map((event) => event.action), ["reveal", "reveal"]);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("sfd-187-221 Void Burrower: the merged recycle primitive drops the played card's stale deck identity", () => {
  // 124 / 417.1.a: the played card left the deck, so its old zone identity is
  // invalid; the same linked list therefore recycles exactly "the rest".
  const kernel = world().deck(["d1", "d2"]).build();
  const [first, second] = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  assert.equal(kernel.perform({ type: "play", object: first, player: "A" }).status, "done");
  const run = runInstruction(recycle, { objects: { kind: "constant", value: [first, second] } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d2"]);
});

test.todo(
  "sfd-187-221 Void Burrower: emission of the conquer timing point into the chain pipeline " +
    "(scoring/ RIFT-76 → chain/events RIFT-120) plus the contract 3.5 card-program → " +
    "TriggerRegistration consumer"
);

test.todo(
  "sfd-187-221 Void Burrower: charging the leading \"exhaust me\" as the triggered ability's " +
    "base cost at Finalize (383.3.b / 404.1.b.1 / 740.4.a.2) — IR's TriggeredAbility has no cost " +
    "field and nothing builds a TriggerRegistration out of a card program (RIFT-89)"
);

test.todo(
  "sfd-187-221 Void Burrower: supplying the ordered Main Deck slice from zoneSlice to card " +
    "programs, and adding effect.reveal's `pick` / effect.exhaust's `choose` to " +
    "chain/interpreter-adapter.ts's LITERAL_FIELDS (named in the contract-change request)"
);

test.todo(
  "sfd-187-221 Void Burrower: the identity's printing difference must be ruled on — sfd-243-221 " +
    "reads \"You may banish one, then play it. Recycle the rest.\", which changes the chosen card's " +
    "zone path (428.1 vs 420.3); the local catalog and survey leave the canonical identity " +
    "unresolved (blocker non-reminder-printing-difference)"
);
