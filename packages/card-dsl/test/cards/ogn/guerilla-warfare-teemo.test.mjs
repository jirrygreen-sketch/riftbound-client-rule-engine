import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import guerillaWarfare from "../../../dist/cards/ogn/guerilla-warfare-teemo.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-1175fb7ab62c4d777b8ccd63b423982a0b70440ed2d5652d2b61dde6fb07b06f";

const [play] = guerillaWarfare.abilities;
const [returnInstruction, waiverInstruction] = play.body;
const returnSpec = returnInstruction.targets[0];

test("Guerilla Warfare program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(guerillaWarfare);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Guerilla Warfare identity, ruleset, status, printed text and judgeReason", () => {
  assert.equal(guerillaWarfare.canonicalCardId, CANONICAL);
  assert.equal(guerillaWarfare.rulesetVersion, "core-1.5");
  assert.equal(guerillaWarfare.status, "judge-required");
  assert.equal(
    guerillaWarfare.sourceText,
    "Return up to two cards with [Hidden] from your trash to your hand. " +
      "You can hide cards ignoring costs this turn."
  );
  // The judgeReason must name the missing keyword predicate, the Hide machinery
  // and the concrete tasks instead of a generic pending note.
  assert.match(guerillaWarfare.judgeReason, /811\.5/);
  assert.match(guerillaWarfare.judgeReason, /keywords/);
  assert.match(guerillaWarfare.judgeReason, /811\.1\.b/);
  assert.match(guerillaWarfare.judgeReason, /811\.1\.c\.1/);
  assert.equal(cardRegistryById.get(guerillaWarfare.canonicalCardId), guerillaWarfare);
});

test("Guerilla Warfare has no speed keyword on this printing", () => {
  assert.equal(guerillaWarfare.abilities.length, 1);
  assert.equal(
    guerillaWarfare.abilities.some(ability => ability.kind === "keyword"),
    false
  );
  assert.equal(play.cost, undefined);
});

test("Guerilla Warfare structure: an up-to-two return, then the unmerged Hide cost waiver", () => {
  assert.equal(play.body.length, 2);

  // "Return up to two cards with [Hidden] from your trash to your hand."
  assert.equal(returnInstruction.id, "return-hidden-cards");
  assert.equal(returnInstruction.op, "effect.zone");
  assert.deepEqual(returnInstruction.args.target, { kind: "constant", value: "hidden-cards-in-trash" });
  assert.deepEqual(returnInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(returnInstruction.args.to, { kind: "constant", value: "hand" });
  assert.equal(returnInstruction.linkedTo, undefined);
  // "up to two cards" (355.13) — a target group of 0..2 cards in the
  // controller trash; the [Hidden] restriction is the descriptive key.
  assert.deepEqual(returnSpec, {
    id: "hidden-cards-in-trash",
    filter: { zone: "trash", owner: "self", keywords: ["Hidden"] },
    min: 0,
    max: 2,
    selection: "up-to"
  });

  // "You can hide cards ignoring costs this turn." — an unmerged cost waiver
  // with the printed end-of-turn duration.
  assert.equal(waiverInstruction.id, "hide-ignoring-costs");
  assert.equal(waiverInstruction.op, "cost.modify");
  assert.deepEqual(waiverInstruction.args, {
    scope: { kind: "constant", value: "hide" },
    ignoreCosts: { kind: "constant", value: true },
    duration: { kind: "constant", value: "this-turn" }
  });
  assert.equal(waiverInstruction.targets, undefined);
  assert.equal(waiverInstruction.linkedTo, undefined);
});

test("Guerilla Warfare: the supported return half keeps the zone and owner semantics", () => {
  // The return primitive is registered and the supported parts of the target
  // filter remain meaningful even while the Hidden characteristic predicate
  // is pending.
  assert.equal(instructionDefinitionsById.has("effect.zone"), true);
  const kernel = world()
    .card("hidden-card", { zone: "trash" })
    .card("plain-card", { zone: "trash" })
    .card("other-zone", { zone: "hand" })
    .build();
  assert.deepEqual(
    kernel.query({ zone: "trash", owner: "A" }).map(object => object.ref.id),
    ["hidden-card", "plain-card"]
  );
  assert.deepEqual(
    kernel.query({ zone: "hand", owner: "A" }).map(object => object.ref.id),
    ["other-zone"]
  );
});

test("Guerilla Warfare golden: the return half brings up to two locked trash cards to hand (417.1.b)", () => {
  const kernel = world()
    .card("one", { zone: "trash" })
    .card("two", { zone: "trash" })
    .card("three", { zone: "trash" })
    .build();
  const run = runInstruction(
    zone,
    {
      target: "hidden-cards-in-trash",
      amount: { kind: "constant", value: 2 },
      to: { kind: "constant", value: "hand" }
    },
    {
      world: kernel,
      targets: { "hidden-cards-in-trash": [kernel.ref("one"), kernel.ref("two")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["one", "two"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["three"]);
  assert.equal(kernel.getObject("one").zone, "hand");
  assert.equal(run.linked.moved, 2);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand", "return-to-hand"]);
});

test("Guerilla Warfare golden: the return half runs from the program body through the chain adapter", () => {
  // The production adapter keeps raw Exprs; effect.zone evaluates them itself,
  // so the card own literal amount and destination are what executes here.
  const kernel = world().card("one", { zone: "trash" }).card("two", { zone: "trash" }).build();
  kernel.setTargets("hidden-cards-in-trash", [kernel.ref("one"), kernel.ref("two")]);

  // The TargetSpec is dropped for this run (merged sibling golden convention):
  // the reference kernel matches filters by plain value, so the production
  // predicates `owner: self` and the descriptive `keywords` key cannot be
  // resolved there; Finalize locking is supplied through setTargets instead.
  const { targets, ...lockedReturn } = returnInstruction;
  const outcome = resolveChainBody([lockedReturn], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["one", "two"]);
  assert.equal(outcome.linkedValues["return-hidden-cards.moved"], 2);
  assert.equal(outcome.linkedValues["return-hidden-cards.destination"], "hand");
});

test("Guerilla Warfare golden: choosing zero cards moves nothing (355.13)", () => {
  const kernel = world().card("one", { zone: "trash" }).build();
  const run = runInstruction(
    zone,
    {
      target: "hidden-cards-in-trash",
      amount: { kind: "constant", value: 2 },
      to: { kind: "constant", value: "hand" }
    },
    { world: kernel, targets: { "hidden-cards-in-trash": [] } }
  );

  // With no legal object left the primitive reports ignored/mistargeted; the
  // program must never report a move that did not happen.
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.zone("A", "hand").length, 0);
  assert.equal(kernel.zone("A", "trash").length, 1);
  assert.equal(run.events.length, 0);
});

test("Guerilla Warfare: the supported return half executes before the pending Hide waiver", () => {
  const kernel = world().card("one", { zone: "trash" }).build();
  kernel.setTargets("hidden-cards-in-trash", [kernel.ref("one")]);
  const [returnBody] = play.body;
  const { targets, ...lockedReturn } = returnBody;
  const outcome = resolveChainBody([lockedReturn], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["one"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.equal(outcome.linkedValues["return-hidden-cards.moved"], 1);
});

test.todo(
  "Guerilla Warfare [Hidden] restriction: give the target filter a keyword-characteristic predicate so " +
    "the cards with [Hidden] can be selected (811.5), and expose ObjectSnapshot.keywords to filters"
);

test.todo(
  "Guerilla Warfare Hide waiver: implement the Hide Discretionary Action, the facedown zone and the " +
    "[A] payment (811.1.b / 422.1 / 422.2), then a duration-bounded cost waiver so the spell can grant " +
    "cost-free hiding for the turn (not a Play permission, 811.1.c.1) — Hide action and permission consumer"
);

