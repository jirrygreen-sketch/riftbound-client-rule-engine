import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/last-stand.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-cfe83e821b0faa83120c2096c34d250fad91786b0aba091191591e6936237f0a";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Double a friendly unit's Might this turn. Give it [Temporary]. " +
  "(Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [actionKeyword, play] = program.abilities;
const [doubleMight, giveTemporary] = play.body;

test("ogn-069-298 Last Stand: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-069-298 Last Stand identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-069-298 Last Stand judgeReason names both missing producers", () => {
  assert.match(program.judgeReason, /433\.1/);
  assert.match(program.judgeReason, /continuous\.might|addContinuous/);
  assert.match(program.judgeReason, /816/);
  assert.match(program.judgeReason, /RIFT-83/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("ogn-069-298 Last Stand structure: [Action] keyword plus doubling then a linked Temporary grant", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "last-stand.double-might",
    "last-stand.give-temporary"
  ]);

  // "Double a friendly unit's Might this turn" (433.1/433.1.a): the amount is
  // the target's Might read at resolution, and the change lasts for the turn.
  assert.equal(doubleMight.op, "continuous.might");
  assert.deepEqual(doubleMight.args.amount, {
    kind: "object-property",
    object: { target: "last-stand.unit" },
    property: "might"
  });
  assert.deepEqual(doubleMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(doubleMight.targets, [
    {
      id: "last-stand.unit",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "Give it [Temporary]" — the same unit, so the grant is linked to the
  // doubling (359.3.e.14) and names the CR 816 keyword.
  assert.equal(giveTemporary.op, "continuous.grant-keyword");
  assert.equal(giveTemporary.linkedTo, "last-stand.double-might");
  assert.deepEqual(giveTemporary.args.keyword, { kind: "constant", value: "Temporary" });
  assert.deepEqual(giveTemporary.targets, doubleMight.targets);
});

test("ogn-069-298 Last Stand: the declared dependencies really are unregistered", () => {
  // Guards the judgeReason against drift: neither the Might-modification
  // instruction nor the Temporary keyword expansion exists in the merged
  // registries today.
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), false);
  assert.equal(keywordDefinitionsById.has("Temporary"), false);
  // The [Action] speed keyword, by contrast, is merged.
  assert.equal(keywordDefinitionsById.has("Action"), true);
});

test.todo(
  "Last Stand: doubling the target's current Might for the turn (433.1/433.1.a - the rule's own worked " +
    "example) needs the arithmetic-layer continuous.might instruction primitive; the layers evaluation side " +
    "merged with RIFT-91 but nothing registers a modification through ResolveContext.addContinuous"
);

test.todo(
  "Last Stand: granting [Temporary] (816.1.b: kill this at the start of its controller's Beginning Phase, " +
    "before scoring) needs the Temporary KeywordDef (RIFT-83 keyword scope) plus the beginning-start timing " +
    "consumer; 816.2 makes multiple instances redundant and 124.1 clears temporary modifications on zone change"
);

test.todo(
  "Last Stand: [Action] admission (806.1.b) and the linked-target re-verification for both instructions " +
    "(355.8/359.3.e.14) belong to the chain and target batches (RIFT-90/RIFT-120)"
);
