import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/teemo-strategist.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: reveal } = await import(new URL("effects/instructions/effect.reveal.js", engineCore));
const { default: recycle } = await import(new URL("effects/instructions/effect.recycle.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));

const CANONICAL = "card.hash-605d9e63c28576716347062f9abdcd9fe543138a4b9bee8f5308c24ffac2ae1e";
const [hidden, defend, playedFromHidden] = program.abilities;

const printedSourceText =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When I defend or I'm played from [Hidden], reveal the top 5 cards of your Main Deck. " +
  "Deal 1 to an enemy unit here for each card with [Hidden], then recycle them.";

test("Teemo, Strategist program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /Facedown/);
  assert.equal(program.sourceText, printedSourceText);
});

test("structure: Hidden keyword plus the defend / played-from-Hidden triggers", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  assert.equal(defend.kind, "triggered");
  assert.equal(defend.trigger.at, "defense-declared");
  assert.deepEqual(defend.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self", here: true }
  });
  assert.equal(defend.optional, false);
  assert.deepEqual(
    defend.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["teemo.reveal", "effect.reveal"],
      ["teemo.damage", "effect.damage"],
      ["teemo.recycle", "effect.recycle"]
    ]
  );

  // Zone/count can reveal the entire deck when at most five remain. A larger
  // deck requires the upstream ordered pick binding described in judgeReason.
  for (const ability of [defend, playedFromHidden]) {
    assert.deepEqual(ability.body[0].args, {
      zone: { kind: "constant", value: "deck" },
      count: { kind: "constant", value: 5 }
    });
  }

  // "Deal 1 to an enemy unit here for each card with [Hidden]" — the amount is
  // the descriptive count-over-revealed-set predicate (see judgeReason), and the
  // target is one enemy unit at the source's current location.
  const damage = defend.body[1];
  assert.equal(damage.linkedTo, "teemo.reveal");
  // The per-card count has no producer in the merged primitives, so the amount
  // reads a linked key that the reveal step never writes: the interpreter then
  // ignores the instruction (MissingInformation) rather than dealing a guessed
  // amount.
  assert.deepEqual(damage.args.amount, {
    kind: "linked-value",
    instructionId: "teemo.reveal",
    key: "revealedHiddenCount"
  });
  assert.deepEqual(damage.args.target, { kind: "constant", value: "teemo.enemy-unit-here" });
  assert.equal(damage.args.source, undefined, "the damage primitive defaults to its actual ability source");
  assert.deepEqual(damage.targets[0], {
    id: "teemo.enemy-unit-here",
    filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "then recycle them" — linked to the reveal, so the referenced set is the
  // revealed cards (CR 359.3.e.14).
  const recycleInstruction = defend.body[2];
  assert.equal(recycleInstruction.linkedTo, "teemo.reveal");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "teemo.reveal",
    key: "revealed"
  });

  // "or I'm played from [Hidden]" — a second trigger for the same effect.
  assert.equal(playedFromHidden.kind, "triggered");
  assert.equal(playedFromHidden.trigger.at, "card-played");
  assert.deepEqual(playedFromHidden.trigger.filter, {
    event: "card-played",
    filter: { role: "self", playedFrom: "hidden" }
  });
  assert.deepEqual(
    playedFromHidden.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["teemo.hidden.reveal", "effect.reveal"],
      ["teemo.hidden.damage", "effect.damage"],
      ["teemo.hidden.recycle", "effect.recycle"]
    ]
  );
});

test("golden: the reveal half shows all five deck cards through effect.reveal", () => {
  const kernel = world()
    .deck(["c1", "c2", "c3", "c4", "c5"], { owner: "A", types: ["unit"] })
    .hand("unrevealed-hand-card")
    .build();
  const run = runInstruction(reveal, defend.body[0].args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealed.length, 5);
  assert.equal(run.linked.revealedCount, 5);
  // A full-zone reveal promises membership, not query/deck order; the ordered
  // pick scenario below separately verifies the true top-five order.
  assert.deepEqual(new Set(run.linked.revealed), new Set(kernel.zone("A", "deck")));
  assert.equal(run.events.filter(event => event.action === "reveal").length, 5);
  // CR 425.1.a: revealed cards stay in their zone.
  assert.equal(kernel.player("A").deckSize, 5);
  assert.equal(kernel.player("A").handSize, 1);
});

test("golden: ordered upstream picks reveal the true top five of a larger deck without moving them", () => {
  const kernel = world().deck(["z-top", "y", "x", "w", "v", "a-bottom"]).build();
  const before = kernel.zone("A", "deck");
  const topFive = kernel.zoneSlice("A", "deck", "top", 5).map(object => object.ref);
  const run = runInstruction(reveal, { pick: "teemo-top-five" }, {
    world: kernel, picks: { "teemo-top-five": topFive }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, topFive);
  assert.equal(run.linked.revealedCount, 5);
  assert.equal(run.events.length, 5);
  assert.deepEqual(kernel.zone("A", "deck"), before);
});

test("golden: the linked recycle moves the revealed cards to the deck bottom", () => {
  const kernel = world()
    .deck(["c1", "c2", "c3", "c4", "c5"], { owner: "A", types: ["unit"] })
    .build();
  const revealed = kernel.objectsInZone("A", "deck");
  const run = runInstruction(recycle, defend.body[2].args, {
    world: kernel,
    linked: { revealed }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 5);
  assert.equal(run.events.filter(event => event.action === "recycle").length, 5);
  assert.equal(kernel.getObject("c1").zone, "deck");
  assert.notEqual(kernel.getObject("c1").ref.zoneEntryId, 1);
});

test("golden: an empty reveal is negated as impossible instead of inventing cards (CR 425.2)", () => {
  const kernel = world().build();
  const run = runInstruction(reveal, defend.body[0].args, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.linked.revealed, []);
  assert.equal(run.linked.revealedCount, 0);
  assert.deepEqual(run.events, []);
});

test.todo(
  "Teemo, Strategist: wire ordered top-five picks into the authored body and the chain argument adapter " +
    "(RIFT-66); the reveal primitive supports pick, but zone/count must not approximate deck subsets"
);
test("golden: the damage half cannot deal a guessed amount while the [Hidden] count has no producer", () => {
  const battlefield = { type: "battlefield", id: "teemo-battlefield" };
  const initial = world()
    .deck(["c1", "c2", "c3", "c4", "c5"], { owner: "A", types: ["unit"] })
    .unit("teemo", { owner: "A", location: battlefield })
    .unit("enemy", { owner: "B", might: 3, location: battlefield })
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("teemo") });
  kernel.setTargets("teemo.enemy-unit-here", [kernel.ref("enemy")]);
  assert.deepEqual(kernel.getObject("enemy").location, kernel.source.location);
  // Run the played-defend body itself through the real interpreter: the reveal
  // links only the revealed refs, so the damage amount (revealedHiddenCount)
  // has no producer and the instruction is ignored (CR 359.3.e.12) instead of
  // dealing a guessed count. The linked recycle still executes (359.3.e.14.b).
  const outcome = resolveChainBody(defend.body, kernel);
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["teemo.reveal", "executed"],
      ["teemo.damage", "ignored"],
      ["teemo.recycle", "executed"]
    ]
  );
  const damageResult = outcome.results.find(result => result.id === "teemo.damage");
  assert.equal(damageResult.result.reason, "mistargeted");
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.equal(kernel.events.some(event => event.action === "damage"), false);
  assert.equal(kernel.events.filter(event => event.action === "recycle").length, 5);
});

test.todo(
  "Teemo, Strategist: 'for each card with [Hidden]' needs a count over the linked revealed set with a " +
    "keyword predicate; neither count-over-linked-set nor a keyword filter key exists in the frozen " +
    "filter contract (RIFT-9 primitive list / RIFT-90 target workstream)"
);
test.todo(
  "Teemo, Strategist: [Hidden] expansion — Hide cost (811.1.b), next-turn [Reaction] and the facedown " +
    "play permission ('played from [Hidden]', 811.1.d.3) — keywords/Hidden.ts expands it, but no Hide " +
    "action/facedown zone/consumer and no CardProgram→layers registration exist (RIFT-257 + Hide contract)"
);
test.todo(
  "Teemo, Strategist: printed text is the pre-errata version; the official correction (S-ORIGINS " +
    "Teemo, Strategist) drops the played-from-Hidden branch and chooses the enemy unit before " +
    "revealing. The data fix belongs to card-data, not to this program " +
    "(docs/plans/survey/data-issues-recheck.md ogn-121-298)"
);
