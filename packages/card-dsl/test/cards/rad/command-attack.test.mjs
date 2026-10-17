import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/command-attack.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";

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
const [bindController, lookInstruction, revealChoice, recycleInstruction] = lookMode.body;
const [revealInstruction, drawInstruction] = revealChoice.args.body.value;
const [pickSpec] = revealInstruction.picks;
const [drawnPickSpec] = drawInstruction.picks;

function deckedKernel() {
  const kernel = world()
    .player("A")
    .deck(["gear-a", "spell-b", "gear-c", "unit-d", "spell-e", "deeper"], { owner: "A" })
    .unit("src", { owner: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });
  // The ordered deck-top range is provided by the caller through zoneSlice
  // order (contract 3.6); the reference kernel models it with setPicks.
  const topFive = kernel.objectsInZone("A", "deck").slice(0, 5);
  scoped.setPicks("command-attack.top-five", topFive);
  return { kernel: scoped, topFive };
}

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

test("rad-033-167 Command: Attack: the judgeReason names the actual remaining gaps", () => {
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /830\.3/);
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /ObjectFilter/);
  assert.match(program.judgeReason, /top 5/);
  assert.match(program.judgeReason, /picksSpecId/);
  assert.match(program.judgeReason, /RIFT-358/);
  // RIFT-357 is merged and is named as the landed dependency, never as a gap.
  assert.doesNotMatch(program.judgeReason, /依赖：RIFT-357/);
  assert.doesNotMatch(program.judgeReason, /描述性目的地标记/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(90|64|66|257)/);
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
    modeChoice.args.modes.value.map((mode) => mode.id),
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
  // The destination is a chosen Battlefield Location (355.4 / 355.4.a);
  // RIFT-357's merged Expr kind "location" carries the symbolic selector and
  // the interpreter resolves it at resolution time.
  assert.deepEqual(moveInstruction.args.to, {
    kind: "location",
    value: {
      kind: "choose",
      id: "command-attack.battlefield-destination",
      filter: { type: "battlefield" }
    }
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
  // "your Main Deck" is the caster's deck (190.6.d), bound once with
  // condition.value and read back as a linked value because effect.inspect's
  // player argument accepts a PlayerId Expr, not a symbolic object selector.
  assert.equal(bindController.id, "command-attack.bind-controller");
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });

  // "Look at the top 5 cards of your Main Deck": the merged effect.inspect top
  // scope consumes the card's stable ordered range id (contract 3.6's zoneSlice
  // order); it never reads deck order from the unordered set query.
  assert.equal(lookInstruction.id, "command-attack.look-top-5");
  assert.equal(lookInstruction.op, "effect.inspect");
  assert.equal(lookInstruction.args.scope.value, "top");
  assert.equal(lookInstruction.args.amount.value, 5);
  assert.equal(lookInstruction.args.zone.value, "deck");
  assert.deepEqual(lookInstruction.args.picksSpecId, {
    kind: "constant",
    value: "command-attack.top-five"
  });
  assert.equal(lookInstruction.linkedTo, "command-attack.bind-controller");
  assert.deepEqual(lookInstruction.picks, [
    {
      id: "command-attack.top-five",
      options: ["dynamic:main-deck-top-five"],
      min: 0,
      max: 5,
      selection: "up-to",
      filter: { owner: "self", zone: "deck" }
    }
  ]);

  // "You may reveal a gear from among them and draw it": a resolution-time
  // optional (383.3.a.3) wrapped per contract 3.9, linked to the look.
  assert.equal(revealChoice.id, "command-attack.reveal-and-draw-opt");
  assert.equal(revealChoice.op, "choice.optional");
  assert.equal(revealChoice.linkedTo, "command-attack.look-top-5");
  assert.equal(revealChoice.args.body.kind, "constant");
  assert.deepEqual(
    revealChoice.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [
      ["command-attack.reveal-gear", "effect.reveal"],
      ["command-attack.draw-gear", "effect.zone"]
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

  // "and draw it": 414.1 moves the revealed card from the Main Deck into its
  // owner's hand (the merged effect.zone form), not another top card.
  assert.deepEqual(drawInstruction.args.to, { kind: "constant", value: "hand" });
  assert.equal(drawInstruction.linkedTo, "command-attack.reveal-gear");
  assert.deepEqual(drawnPickSpec.options, [
    { kind: "linked-value", instructionId: "command-attack.reveal-gear", key: "revealed" }
  ]);

  // "Recycle the rest": a following, independent instruction of the same mode
  // that recycles everything still in the looked-at set.
  assert.equal(recycleInstruction.id, "command-attack.recycle-rest");
  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.equal(recycleInstruction.linkedTo, "command-attack.look-top-5");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "command-attack.look-top-5",
    key: "command-attack-looked"
  });
});

test("rad-033-167 Command: Attack golden: the top-5 look sees the deck's real order and moves nothing", () => {
  const { kernel, topFive } = deckedKernel();
  const before = kernel.objectsInZone("A", "deck");

  const outcome = resolveChainBody([bindController, lookInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["command-attack.look-top-5.command-attack-looked"].length, 5);
  assert.deepEqual(
    outcome.linkedValues["command-attack.look-top-5.command-attack-looked"].map((ref) => ref.id),
    topFive.map((ref) => ref.id)
  );
  // 128.3-128.4 / 432.1.c: a private look leaves the objects in their zone.
  assert.deepEqual(kernel.objectsInZone("A", "deck"), before);
  assert.deepEqual(outcome.events.map((event) => event.action), ["look"]);
});

test("rad-033-167 Command: Attack golden: accepting reveals a gear, draws it, and recycles the rest", () => {
  const { kernel, topFive } = deckedKernel();
  const chosen = topFive[2]; // gear-c
  kernel.setPicks("command-attack.revealed-gear", [chosen]);
  kernel.setPicks("command-attack.drawn-gear", [chosen]);
  kernel.setAnswers({ "command-attack.reveal-and-draw-opt/optional": true });

  // The reveal step is driven at the primitive level because the chain adapter
  // (chain/interpreter-adapter.ts LITERAL_FIELDS) unwraps only `target` for
  // effect.reveal, not the card's declared `pick` — the same gap the merged
  // sfd/ornn-blacksmith golden records.
  const lookOutcome = resolveChainBody([bindController, lookInstruction], kernel);
  assert.equal(lookOutcome.status, "executed");

  const revealed = runInstruction(reveal, { pick: revealInstruction.args.pick.value }, {
    world: kernel,
    picks: { "command-attack.revealed-gear": [chosen] }
  });
  assert.equal(revealed.result.status, "executed");
  // 425.1.a.2: the revealed card stays in the Main Deck until the draw moves it.
  assert.equal(kernel.getObject(chosen.id).zone, "deck");

  // The chain adapter's LITERAL_FIELDS decodes effect.zone's `pick`/`to` at the
  // card level, but runInstruction drives the primitive's schema directly, so
  // the already-unwrapped literal values are passed here (the same split the
  // merged sfd/ornn-blacksmith golden documents for effect.reveal / effect.zone).
  const drawn = runInstruction(zone, {
    pick: drawInstruction.args.pick.value,
    to: { kind: "constant", value: "hand" },
    amount: { kind: "constant", value: 1 }
  }, {
    world: kernel,
    picks: { "command-attack.drawn-gear": [chosen] }
  });
  assert.equal(drawn.result.status, "executed");
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["gear-c"]);

  // "Recycle the rest": the moved card's stale reference drops out (124), so the
  // other four looked-at cards go to the bottom of the owner's Main Deck.
  const recycled = runInstruction(recycle, {
    objects: recycleInstruction.args.objects
  }, {
    world: kernel,
    linked: { "command-attack-looked": topFive }
  });
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 4);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "deeper",
    "gear-a",
    "spell-b",
    "unit-d",
    "spell-e"
  ]);
});

test("rad-033-167 Command: Attack golden: declining the may recycles every looked-at card", () => {
  const { kernel, topFive } = deckedKernel();
  kernel.setAnswers({ "command-attack.reveal-and-draw-opt/optional": false });

  const outcome = resolveChainBody(lookMode.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["command-attack.bind-controller", "executed"],
      ["command-attack.look-top-5", "executed"],
      ["command-attack.reveal-and-draw-opt", "negated"],
      ["command-attack.recycle-rest", "executed"]
    ]
  );
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "deeper",
    ...topFive.map((ref) => ref.id)
  ]);
});

test("rad-033-167 Command: Attack golden: without an upstream ordered range the look sees nothing", () => {
  // The card names its ordered range, but no upstream provider filled it (the
  // production Finalize surface locks instruction targets only). The merged
  // effect.inspect therefore looks at zero cards and never falls back to the
  // unordered set query, so no card is reordered or moved (contract 3.6; the
  // same reading the merged sfd/called-shot golden records).
  const kernel = world()
    .player("A")
    .deck(["gear-a", "spell-b", "gear-c", "unit-d", "spell-e", "deeper"], { owner: "A" })
    .unit("src", { owner: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });

  const outcome = resolveChainBody([bindController, lookInstruction, recycleInstruction], scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["command-attack.bind-controller", "executed"],
      ["command-attack.look-top-5", "executed"],
      ["command-attack.recycle-rest", "executed"]
    ]
  );
  assert.equal(outcome.linkedValues["command-attack.look-top-5.command-attack-looked"].length, 0);
  assert.equal(outcome.linkedValues["command-attack.recycle-rest.recycledCount"], 0);
  assert.deepEqual(scoped.objectsInZone("A", "deck").map((ref) => ref.id), [
    "gear-a",
    "spell-b",
    "gear-c",
    "unit-d",
    "spell-e",
    "deeper"
  ]);
  assert.deepEqual(outcome.events, []);
});

test("rad-033-167 Command: Attack golden: mode 1 really moves the Deploy gear to the chosen battlefield", () => {
  // 355.4 / 355.4.a: the destination is a valid Location other than the moved
  // object's current one, chosen at resolution. The merged runtime Location
  // selector (RIFT-357) offers the real Battlefield locations; the answer is
  // supplied the way a production resolution would supply it.
  const kernel = world()
    .player("B")
    .unit("deploy-gear", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("src")
    .unit("battlefield-unit", {
      owner: "B",
      zone: "board",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });
  scoped.setTargets("command-attack.friendly-deploy-gear", [kernel.ref("deploy-gear")]);
  scoped.setAnswers({ "command-attack.move/command-attack.battlefield-destination": { type: "battlefield", id: "bf-1" } });
  const bodyWithoutTargetSpec = moveMode.body.map(({ targets, ...rest }) => rest);

  const outcome = resolveChainBody(bodyWithoutTargetSpec, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["command-attack.move", "executed"]]
  );
  // 421/448: an effect Move relocates the Gear without the Standard Move's
  // exhaust cost or Main-Phase gate (451.1).
  assert.deepEqual(scoped.getObject("deploy-gear").location, { type: "battlefield", id: "bf-1" });
  assert.equal(scoped.getObject("deploy-gear").exhausted, false);
  assert.deepEqual(scoped.events.map((event) => event.action), ["move-location"]);
});

test("rad-033-167 Command: Attack golden: a battlefield-less board offers no destination and moves nothing", () => {
  // 355.4.a: only valid Battlefield locations are legal destinations. With no
  // such location in the game state the Location choice has no options, so the
  // Move is negated instead of guessing a destination.
  const kernel = world()
    .unit("deploy-gear", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("src", { location: { type: "base", player: "A" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });
  scoped.setTargets("command-attack.friendly-deploy-gear", [kernel.ref("deploy-gear")]);
  const bodyWithoutTargetSpec = moveMode.body.map(({ targets, ...rest }) => rest);

  assert.throws(() => resolveChainBody(bodyWithoutTargetSpec, scoped), /Location choice has no options/);
  assert.deepEqual(scoped.getObject("deploy-gear").location, { type: "base", player: "A" });
});

test.todo(
  "rad-033-167 Command: Attack: the ordered top-5 range and mode/target Finalize lifecycle (RIFT-358) " +
    "are still not wired into the production chain; the golden supplies the ordered range the way " +
    "contract 3.6 requires."
);

test.todo(
  "rad-033-167 Command: Attack: 'with [Deploy]' needs a keyword predicate in the filter vocabulary " +
    "(830.3); programs/filters.ts translateObjectFilter still rejects 'hasKeyword' with " +
    "\"Unsupported filter field hasKeyword\", so the targeting restriction cannot be evaluated."
);
