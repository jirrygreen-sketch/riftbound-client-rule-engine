import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/scrutinizing-scope.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-b08afbe6dc630f67287c7ab652b90f17c81abfd9d7f94bda47eae324899ce111";
const [ability] = program.abilities;
const [guess, reveal, recycleBranch, drawBranch] = ability.body;

test("rad-064-167 Scrutinizing Scope: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    ":rb_energy_1:, :rb_exhaust:: Choose an opponent. They guess a card type. " +
      "Reveal the top card of your Main Deck. If it has that type, recycle it. " +
      "Otherwise, draw it. (Unit, gear, and spell are types.)"
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-064-167 Scrutinizing Scope: judgeReason names the guess primitive and the remaining type data problem", () => {
  assert.match(program.judgeReason, /choice\.hidden-guess/);
  assert.match(program.judgeReason, /compareValues/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /128\.3/);
  // RIFT-358 merged the ordered deck-top supply; the reason must now say the
  // reveal half is executable instead of asking for an ordered producer.
  assert.match(program.judgeReason, /PickSpec\.zoneSlice/);
  assert.match(program.judgeReason, /golden/);
  assert.doesNotMatch(program.judgeReason, /没有已合入的提供者/);
  // The card-type data problem must be stated, not silently resolved.
  assert.match(program.judgeReason, /Spell/);
  assert.match(program.judgeReason, /145\.1\/151\.1/);
  assert.doesNotMatch(program.judgeReason, /RIFT-66/);
});

test("rad-064-167 Scrutinizing Scope: structure — one activated ability with the printed energy and exhaust cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);
  // The catalog prints no power; no power field is invented.
  assert.equal(Object.hasOwn(ability.cost, "power"), false);
});

test("rad-064-167 Scrutinizing Scope: structure — guess, reveal the deck top, then two conditioned branches", () => {
  assert.equal(ability.body.length, 4);

  // "Choose an opponent. They guess a card type." — one primitive, chooser-only.
  assert.equal(guess.id, "scrutinizing-scope.guess-type");
  assert.equal(guess.op, "choice.hidden-guess");
  assert.deepEqual(guess.args.guesser.value, { selector: "opponent", count: 1 });
  assert.deepEqual(guess.args.options.value, ["unit", "gear", "spell"]);
  assert.deepEqual(guess.args.visibility, { kind: "constant", value: "chooser-only" });
  assert.deepEqual(guess.args.linkKey, { kind: "constant", value: "guessedType" });

  // "Reveal the top card of your Main Deck." — the controller's own deck, one
  // card. No player argument: the revealing player defaults to the controller
  // (190.6.d's implied "you"), which is what "your Main Deck" means.
  assert.equal(reveal.id, "scrutinizing-scope.reveal-top");
  assert.equal(reveal.op, "effect.reveal");
  assert.deepEqual(reveal.args.pick, {
    kind: "constant",
    value: "scrutinizing-scope.deck-top"
  });
  // RIFT-358: the real deck-top reference is an ordered, Finalize-locked pick;
  // effect.reveal never infers card order from ctx.query.
  assert.deepEqual(reveal.picks, [
    {
      id: "scrutinizing-scope.deck-top",
      options: [],
      ordered: true,
      zoneSlice: {
        zone: "deck",
        from: "top",
        count: { kind: "constant", value: 1 }
      },
      selection: "all"
    }
  ]);
  assert.equal(reveal.targets, undefined);

  // The branch is not a player choice: no choice.mode appears anywhere.
  assert.equal(
    ability.body.some(instruction => instruction.op === "choice.mode"),
    false
  );
});

test("rad-064-167 Scrutinizing Scope: the compare/in membership test really decides the two branches", () => {
  // The guess primitive has no producer yet, so the branch conditions are
  // driven by seeding the linked value the guess would write, with its own
  // instruction id in scope so linkedTo resolves. The membership operator and
  // the recycle/zone bodies are the merged evaluator and primitives.
  const seeded = (types) => {
    const kernel = world().deck(["top", "second"], { owner: "A", types }).build();
    const scope = kernel.clone({ sourceSnapshot: kernel.getObject("top"), controller: "A" });
    return { kernel, scope };
  };
  const guessWrite = {
    id: "scrutinizing-scope.guess-type",
    op: "condition.value",
    args: {
      value: { kind: "constant", value: "gear" },
      key: { kind: "constant", value: "guessedType" }
    }
  };
  const matched = seeded(["gear"]);
  const matchedOutcome = resolveChainBody(
    [
      guessWrite,
      {
        id: "scrutinizing-scope.reveal-top",
        op: "condition.value",
        args: {
          value: { kind: "constant", value: [matched.kernel.ref("top")] },
          key: { kind: "constant", value: "revealed" }
        }
      },
      recycleBranch
    ],
    matched.scope
  );
  const matchedRecycle = matchedOutcome.results.find((result) => result.id === recycleBranch.id);
  assert.equal(matchedRecycle.result.status, "executed");
  // 417.1: the recycled card goes to the BOTTOM of its owner's Main Deck.
  assert.deepEqual(matched.scope.zoneSlice("A", "deck", "top").map((object) => object.ref.id), ["second", "top"]);
  assert.equal(matchedOutcome.events.filter((event) => event.action === "recycle").length, 1);

  const mismatched = seeded(["unit"]);
  const mismatchedOutcome = resolveChainBody(
    [
      guessWrite,
      {
        id: "scrutinizing-scope.reveal-top",
        op: "condition.value",
        args: {
          value: { kind: "constant", value: [mismatched.kernel.ref("top")] },
          key: { kind: "constant", value: "revealed" }
        }
      },
      recycleBranch
    ],
    mismatched.scope
  );
  const mismatchedRecycle = mismatchedOutcome.results.find((result) => result.id === recycleBranch.id);
  assert.equal(mismatchedRecycle.result.status, "negated");
  assert.equal(mismatchedRecycle.result.reason, "skipped");
  assert.deepEqual(mismatched.scope.zoneSlice("A", "deck", "top").map((object) => object.ref.id), ["top", "second"]);
  assert.equal(mismatchedOutcome.events.filter((event) => event.action === "recycle").length, 0);
});

test("rad-064-167 Scrutinizing Scope: the matched branch recycles, the otherwise branch returns the card to hand", () => {
  // "If it has that type, recycle it."
  assert.equal(recycleBranch.id, "scrutinizing-scope.recycle-if-matched");
  assert.equal(recycleBranch.op, "effect.recycle");
  assert.equal(recycleBranch.linkedTo, reveal.id);
  // The merged membership test: the scalar guessed type is tested with
  // compare/in against the revealed card's types array (compareValues
  // implements left-in-right).
  assert.deepEqual(recycleBranch.condition, {
    kind: "compare",
    left: {
      kind: "linked-value",
      instructionId: "scrutinizing-scope.guess-type",
      key: "guessedType"
    },
    operator: "in",
    right: {
      kind: "object-property",
      object: { linked: "scrutinizing-scope.reveal-top" },
      property: "types"
    }
  });
  assert.deepEqual(recycleBranch.args.objects, {
    kind: "linked-value",
    instructionId: reveal.id,
    key: "revealed"
  });
  assert.equal(recycleBranch.targets, undefined);

  // "Otherwise, draw it." — the negation of the same comparison, so the two
  // branches are mutually exclusive without asking the player to choose.
  assert.equal(drawBranch.id, "scrutinizing-scope.draw-if-other");
  assert.equal(drawBranch.op, "effect.zone");
  assert.equal(drawBranch.linkedTo, reveal.id);
  assert.equal(drawBranch.condition.kind, "not");
  assert.deepEqual(drawBranch.condition.condition, {
    kind: "compare",
    left: {
      kind: "linked-value",
      instructionId: "scrutinizing-scope.guess-type",
      key: "guessedType"
    },
    operator: "in",
    right: {
      kind: "object-property",
      object: { linked: "scrutinizing-scope.reveal-top" },
      property: "types"
    }
  });
  // The revealed card is a non-target pick (355.10.c/e), sourced from the
  // reveal's own link value.
  assert.deepEqual(drawBranch.args.pick, { kind: "constant", value: "revealed-card" });
  assert.deepEqual(drawBranch.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawBranch.picks, [
    {
      id: "revealed-card",
      options: [{ kind: "linked-value", instructionId: reveal.id, key: "revealed" }],
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // Neither branch declares a target: nothing here becomes targeted
  // (355.6/355.7).
  assert.equal(drawBranch.targets, undefined);
  assert.equal(recycleBranch.targets, undefined);
});

test.todo(
  "rad-064-167 Scrutinizing Scope: 'Choose an opponent. They guess a card type' needs the " +
    "choice.hidden-guess primitive (private declarative guess + comparison against the revealed " +
    "card's type, CR 1.5 128.3/425/135.2.b.7) — unmerged (survey section 25)."
);

test.todo(
  "rad-064-167 Scrutinizing Scope: 'Choose an opponent. They guess a card type' needs a producer for the " +
    "guessed-type link the compare/in membership test reads (CR 128.3 / 425 / 135.2.b.7)."
);

test("rad-064-167 Scrutinizing Scope: the ordered deck-top pick locks the real top card and effect.reveal reveals it", () => {
  // RIFT-358: the declared PickSpec.zoneSlice is locked at Finalize and handed to
  // effect.reveal as a non-target pick; no ctx.query ordering is involved. The
  // production ChainEngine supplies the Finalize lock.
  const board = fixture({ choose: request => request.type === "optional" ? true : undefined });
  board.engine.execute({
    id: "scope-reveal",
    controller: "A",
    source: board.kernel.getObject("source"),
    kind: "activated",
    speed: "reaction",
    body: [reveal]
  });
  // The top card is locked by the ordered pick at Finalize, before resolution.
  assert.deepEqual(board.engine.items[0].pickPlans[0].refs, [board.kernel.ref("A:deck:1")]);
  for (let index = 0; index < 6 && board.engine.items.length; index++) {
    board.engine.pass(board.engine.priority);
  }
  assert.equal(board.engine.items.length, 0);
  assert.deepEqual(board.kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref.id), ["A:deck:1", "A:deck:2"],
    "reveal does not move or reorder the deck");
  assert.deepEqual(board.kernel.linked("scrutinizing-scope.reveal-top.revealed").map((ref) => ref.id), ["A:deck:1"]);
  assert.equal(board.kernel.linked("scrutinizing-scope.reveal-top.revealedCount"), 1);
  assert.deepEqual(board.engine.pipeline.events.filter((event) => event.timingPoint === "card-revealed").map((event) => event.object.ref.id), ["A:deck:1"]);
});

test.todo(
  "rad-064-167 Scrutinizing Scope: this printing's card type is inconsistent with its rules text " +
    "(catalog says Spell; the text is a permanent's activated ability with an Exhaust cost). " +
    "Card-data issue report, not a card-program change."
);
