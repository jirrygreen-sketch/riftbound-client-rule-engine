import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/command-attack.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-322879459664911876c55f40be8e59ed07ad8e5c3f1a7cc3b296600b3a4b87a6";
// Verbatim catalog bytes, including the data issue: the two modes run together
// as "battlefield.Look" (no space or line break between the sentences).
const SOURCE_TEXT =
  "Choose one —\n" +
  "Move a friendly gear with [Deploy] to a battlefield.Look at the top 5 cards of your Main Deck. " +
  "You may reveal a gear from among them and draw it. Recycle the rest.";

const [play] = program.abilities;
const [modeChoice] = play.body;
const [moveMode, lookMode] = modeChoice.args.modes.value;
const [moveInstruction] = moveMode.body;
const [moveSpec] = moveInstruction.targets;
const [lookInstruction, revealChoice, recycleInstruction] = lookMode.body;
const [revealInstruction, drawInstruction] = revealChoice.args.body.value;
const [pickSpec] = revealInstruction.picks;

test("rad-033-167 Command: Attack: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-033-167 Command: Attack: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-033-167 Command: Attack: the judgeReason names the actual merged gaps", () => {
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /ObjectFilter/);
  assert.match(program.judgeReason, /top 5/);
  assert.match(program.judgeReason, /picksSpecId/);
});

test("rad-033-167 Command: Attack: 'Choose one —' is one choice.mode with two declared modes", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");

  // 355.3 / contract 3.9: the bulleted list is one mode choice, count 1,
  // different true; the chosen body runs in place (no choice + linkedTo).
  assert.equal(modeChoice.id, "command-attack.choose-mode");
  assert.equal(modeChoice.op, "choice.mode");
  assert.deepEqual(modeChoice.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(modeChoice.args.different, { kind: "constant", value: true });
  assert.equal(modeChoice.args.modes.kind, "constant");
  assert.deepEqual(
    modeChoice.args.modes.value.map(mode => mode.id),
    ["command-attack.move-gear", "command-attack.look-for-gear"]
  );
});

test("rad-033-167 Command: Attack mode 1: an effect Move of a friendly Deploy gear to a battlefield", () => {
  assert.equal(moveInstruction.id, "command-attack.move");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "command-attack.friendly-deploy-gear" }
  });
  // The destination is a chosen Battlefield Location (355.4 / 355.4.a); the
  // frozen IR has no runtime Location selector, so the program keeps a
  // descriptive marker that effect.move rejects outright (fail-closed).
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: { kind: "destination-selector", filter: { type: "battlefield" } }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveInstruction.picks, undefined);

  // 355.7 / 355.9.a.1: "a friendly gear" is a target; "with [Deploy]" is a
  // targeting restriction whose keyword predicate has no merged vocabulary yet.
  assert.equal(moveSpec.id, "command-attack.friendly-deploy-gear");
  assert.deepEqual(moveSpec.filter, {
    type: "gear",
    controller: "self",
    zone: "board",
    hasKeyword: "deploy"
  });
  assert.equal(moveSpec.min, 1);
  assert.equal(moveSpec.max, 1);
  assert.equal(moveSpec.selection, "one");
});

test("rad-033-167 Command: Attack mode 2: private top-5 look, optional reveal-draw, recycle the rest", () => {
  // "Look at the top 5 cards of your Main Deck": a non-zero top-N private look,
  // which effect.inspect documents as needing an upstream ordered picks
  // collection (query cannot order a deck).
  assert.equal(lookInstruction.id, "command-attack.look-top-5");
  assert.equal(lookInstruction.op, "effect.inspect");
  assert.equal(lookInstruction.args.scope.value, "top");
  assert.equal(lookInstruction.args.amount.value, 5);
  assert.equal(lookInstruction.args.zone.value, "deck");
  assert.equal(lookInstruction.linkedTo, undefined);

  // "You may reveal a gear from among them and draw it": a resolution-time
  // optional (383.3.a.3) wrapped per contract 3.9, linked to the look.
  assert.equal(revealChoice.id, "command-attack.reveal-and-draw-opt");
  assert.equal(revealChoice.op, "choice.optional");
  assert.equal(revealChoice.linkedTo, "command-attack.look-top-5");
  assert.equal(revealChoice.args.body.kind, "constant");
  assert.deepEqual(
    revealChoice.args.body.value.map(instruction => [instruction.id, instruction.op]),
    [
      ["command-attack.reveal-gear", "effect.reveal"],
      ["command-attack.draw-gear", "effect.draw"]
    ]
  );

  // The chosen card is a non-target pick over the looked-at result (355.7 / 355.10
  // distinguish targets from picks), 0..1 so declining the reveal is legal.
  assert.equal(revealInstruction.args.pick.value, "command-attack.revealed-gear");
  assert.equal(pickSpec.id, "command-attack.revealed-gear");
  assert.deepEqual(pickSpec.options, [
    {
      kind: "linked-value",
      instructionId: "command-attack.look-top-5",
      key: "command-attack-looked"
    }
  ]);
  assert.equal(pickSpec.min, 0);
  assert.equal(pickSpec.max, 1);
  assert.equal(pickSpec.selection, "up-to");

  // "and draw it": the draw follows the reveal (425.4.a).
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });

  // "Recycle the rest": a following, independent instruction of the same mode.
  assert.equal(recycleInstruction.id, "command-attack.recycle-rest");
  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.equal(recycleInstruction.linkedTo, "command-attack.look-top-5");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "command-attack.look-top-5",
    key: "command-attack-rest"
  });
});

test("rad-033-167 Command: Attack golden: the top-5 look fails closed instead of reading the deck out of order", () => {
  // Guard the red line: with no ordered picks collection, the look must not
  // silently fall back to query(). The reference kernel negates it, draws
  // nothing and leaves the deck untouched.
  const kernel = world().deck(["top", "second", "third", "fourth", "fifth"]).unit("src").build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });
  scoped.setAnswers({ "command-attack.reveal-and-draw-opt/optional": false });

  const outcome = resolveChainBody(lookMode.body, scoped);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), [
    "top",
    "second",
    "third",
    "fourth",
    "fifth"
  ]);
  assert.equal(scoped.player("A").handSize, 0);
  assert.deepEqual(outcome.events, []);
});

test("rad-033-167 Command: Attack golden: mode 1's descriptive destination is rejected, never guessed", () => {
  const kernel = world()
    .unit("deploy-gear", {
      types: ["gear"],
      energy: 1,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("src")
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });
  scoped.setTargets("command-attack.friendly-deploy-gear", [kernel.ref("deploy-gear")]);
  const bodyWithoutTargetSpec = moveMode.body.map(({ targets, ...rest }) => rest);

  // The interpreter evaluates the marker and effect.move's destination()
  // rejects it, so the Gear stays where it is.
  assert.throws(
    () => resolveChainBody(bodyWithoutTargetSpec, scoped),
    /effect\.move to must be a location, controller-base, or location choice/
  );
  assert.deepEqual(scoped.getObject("deploy-gear").location, { type: "base", player: "A" });
});

test.todo(
  "rad-033-167 Command: Attack: the runtime Battlefield destination (355.4 / 355.4.a) needs a " +
    "Location selector in the target/location plan (RIFT-90); a merged non-zero top-N ordered " +
    "look is the RIFT-64/RIFT-66 follow-up (zoneSlice ordering is not wired into inspect/reveal)."
);

test.todo(
  "rad-033-167 Command: Attack: 'with [Deploy]' needs a keyword predicate in the filter " +
    "vocabulary (830.3) and [Deploy] has no KeywordDef (830.1.b); Finalize must also lock the " +
    "mode before its target (355.3 before 355.5), which is RIFT-90/RIFT-120 work."
);
