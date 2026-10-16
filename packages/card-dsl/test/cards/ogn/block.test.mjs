import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import block from "../../../dist/cards/ogn/block.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-211d0bb8cf4f5b5202c2a9b7996e483898644aa24714b1e10edd80a54ba4b560";

const [hidden, action, play] = block.abilities;
const [grantInstruction] = play.body;

test("Block program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(block);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Block identity, ruleset, status and printed text", () => {
  assert.equal(block.canonicalCardId, CANONICAL);
  assert.equal(block.rulesetVersion, "core-1.5");
  assert.equal(block.status, "judge-required");
  assert.match(block.judgeReason, /Tank/);
  assert.match(block.judgeReason, /815/);
  assert.equal(cardRegistryById.get(block.canonicalCardId), block);
  assert.equal(
    block.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Give a unit [Shield 3] and [Tank] this turn. (+3 :rb_might: while it's a defender. " +
      "It must be assigned combat damage first.)"
  );
});

test("Block declares the printed [Hidden] and [Action] keywords (CR 811 / 806)", () => {
  assert.equal(block.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
});

test("Block body: one duration-bound [Shield 3] + [Tank] grant over a unit target", () => {
  assert.equal(play.body.length, 1);
  assert.equal(grantInstruction.id, "grant-shield-3-and-tank");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args.keywords, {
    kind: "constant",
    value: ["Shield", "Tank"]
  });
  assert.deepEqual(grantInstruction.args.value, { kind: "constant", value: 3 });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(grantInstruction.picks, undefined);
  assert.equal(grantInstruction.linkedTo, undefined);
  // "a unit" — any one unit, targeted (355.7 / 355.9.a.1).
  assert.deepEqual(grantInstruction.targets, [
    {
      id: "granted-unit",
      filter: { type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("Block dependencies are genuinely unmerged: no Tank KeywordDef and no grant opcode", () => {
  // CR 815 Tank has no keyword implementation in the merged registry.
  assert.equal(keywordDefinitionsById.has("Tank"), false);
  // Shield's KeywordDef does exist (814), which is why the judgeReason names
  // Tank, the timed grant and the Defender designation rather than Shield.
  assert.ok(keywordDefinitionsById.has("Shield"));
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), false);
});

test("Block: Shield's merged expansion is defender-conditional, not a flat +3 Might (CR 814.1.c)", () => {
  const shield = keywordDefinitionsById.get("Shield");
  const [expansion] = shield.expand({ value: 3, host: { cardId: "block", source: { id: "block", zoneEntryId: 1 } } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.equal(expansion.effect.mode, "add");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 3 });
  // The +3 Might applies only while the host holds the Defender designation,
  // which Combat assigns (814.1.d / 466.2.c.3) — never unconditionally.
  assert.equal(expansion.condition.kind, "compare");
  assert.equal(expansion.condition.left.property, "designation");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "defender" });
  // Shield values from multiple sources sum (814.2; the keyword is stacking "sum").
  assert.equal(shield.stacking, "sum");
});

test.todo(
  "Block: give a unit [Shield 3] for this turn, summing with an existing Shield (CR 814.2 / 814.1.c: +3 Might " +
    "only while it is a defender) - needs a duration-bound keyword grant and the Combat Defender designation (466.2.c.3)"
);

test.todo(
  "Block: give that unit [Tank] for this turn so it must be assigned lethal combat damage first (CR 815.1.b / " +
    "815.1.c.2) - needs the kw-tank keyword implementation (RIFT-83 keyword scope) plus the combat damage step"
);

test.todo(
  "Block [Hidden]: hide for [A] and play from the facedown zone for [0] (CR 811.1.b / 811.1.c.2) - " +
    "needs the Hidden cost/zone workstream (RIFT-84)"
);
