import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/jaull-fish.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";

const CARD_ID = "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732";

const snapshot = () => ({
  ref: { id: "jaull", zoneEntryId: 1 },
  cardId: CARD_ID,
  name: "Jaull-Fish",
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "base", player: "A" },
  might: 3,
  energy: 2,
  power: [],
  exhausted: true,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost.modify/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /Mighty/);
  assert.ok(program.sourceText.includes("[Accelerate]"));
  assert.ok(program.sourceText.includes("cost :rb_energy_2: less for each of your [Mighty] units"));
});

test("abilities: exactly one unvalued Accelerate keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "accelerate");
  assert.equal(ability.value, undefined);
});

test("the merged Accelerate expansion resolves the declared keyword into cost + enter-ready abilities", () => {
  // 805.1/805.1.b: the optional additional cost [1][C]; 805.6: paying it replaces
  // the exhausted entry with a ready entry. The expansion is owned by
  // effects/keywords/Accelerate.ts and resolved by RIFT-257's expandProgram —
  // the card only declares the keyword (contract 3.7).
  const expanded = expandProgram(program, snapshot());
  assert.deepEqual(expanded.expanded.map((ability) => ability.kind), ["static", "replacement"]);
  assert.equal(expanded.expanded[0].effect.kind, "accelerate.cost");
  assert.equal(expanded.expanded[0].effect.appliesTo, "self");
  assert.equal(expanded.expanded[1].replaces.event, "object-enters-board");
  assert.deepEqual(expanded.expanded[1].with.map((instruction) => instruction.op), ["effect.ready"]);
});

test("golden: the expanded enter-ready replacement really readies the entering unit", () => {
  // 805.6: the paid replacement makes the unit enter ready instead of exhausted.
  const expansion = expandProgram(program, snapshot()).expanded.find((ability) => ability.kind === "replacement");
  const kernel = world()
    .unit("jaull", { cardId: CARD_ID, types: ["unit"], exhausted: true, location: { type: "base", player: "A" } })
    .build();
  const context = kernel.clone({ source: kernel.ref("jaull"), sourceSnapshot: kernel.getObject("jaull"), controller: "A" });
  const outcome = resolveChainBody(expansion.with, context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [["accelerate.enter-ready", "executed"]]);
  assert.equal(context.getObject("jaull").exhausted, false);
});

test.todo(
  "'I cost 2 less per Mighty unit' static cost reduction via cost.modify counting controller's " +
    "Mighty units (356.4/356.4.b; no cost.modify primitive and cost/cost-plan.ts reads only caller-supplied " +
    "discounts — RIFT-261 in flight; the Mighty count itself has no cost-side entry point)"
);
