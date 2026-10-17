import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/kayn-unleashed.js";

import { createProgramBinding, createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-1958207f0c4a0be000a8fb2e9fefe3b7deac31092670ca1484b69d633b7df9b7";
const [ganking, replacement] = program.abilities;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /moved twice/);
  assert.equal(
    program.sourceText,
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "If I have moved twice this turn, I don't take damage."
  );
});

test("[Ganking] is declared as a keyword ability only (810; expansion belongs to the keyword registry)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(ganking.value, undefined);
});

test("damage immunity records the intended twice-moved condition and a prevention replacement", () => {
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, { event: "damage", filter: { target: "self" } });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "moves-this-turn",
      filter: { object: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 2 }
  });
  // "I don't take damage" prevents the damage event (438.1/438.7); an empty
  // replacement body is the prevention shape consumed by the merged RIFT-260
  // pipeline; the card stays judge-required because the "moved twice"
  // condition cannot be evaluated from event history (see judgeReason).
  assert.deepEqual(replacement.with, []);
});

test("Kayn supported Ganking expansion registers the original static rule on its host", () => {
  const f = fixture({ cards: [{ id: "kayn", cardId: CANONICAL, types: ["unit"] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("kayn"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  f.engine.advance();
  const source = f.kernel.getObject("kayn");
  const binding = createProgramBinding({ cardPrograms: [program] });
  const ability = binding.inspect(source).abilities.find(item => item.kind === "static");
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);
  const [entry] = f.engine.layers.registry.list();
  assert.equal(entry.effect.layer, "ability");
  assert.equal(entry.effect.effect.kind, "continuous.movement");
  assert.equal(entry.effect.effect.permission, "battlefield-to-battlefield");
  assert.equal(entry.effect.filter.objectId, "kayn");
  assert.equal(entry.effect.filter.zoneEntryId, source.ref.zoneEntryId);
  handle.unbind();
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test.todo(
  "Kayn Ganking: adapt Ganking string permission to movement rule-query permission.routes, then execute a battlefield-to-battlefield Standard Move (810.1.b)"
);
test.todo(
  "Kayn: replacement matching counts this incarnation's Move events in the current turn before preventing damage (438.7; RIFT-359)"
);
