import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/an-offer-you-cant-refuse.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const kill = (await import(new URL("effects/instructions/effect.kill.js", ENGINE))).default;

const CARD_ID = "card.hash-dec87fe514b3143f6b040acdcfc5e343b048ce4ac93600347243dd78304d770c";
const EXPECTED_SOURCE =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Kill a gear. Its controller plays a Gold gear token exhausted. " +
  "(It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")";

test("rad-101-167 An Offer You Can't Refuse: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /185\.2\.d/);
  assert.match(program.judgeReason, /Its controller/);
  assert.match(program.judgeReason, /argsSchema/);
  assert.doesNotMatch(program.judgeReason, /RIFT-261/);
});

test("rad-101-167 An Offer You Can't Refuse: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-101-167 An Offer You Can't Refuse: [Action] keyword plus one play ability", () => {
  assert.equal(program.abilities.length, 2);
  const [action, play] = program.abilities;
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Catalog printing: 2 energy, power null (no printed Power, never 0).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.deepEqual(play.body.map((step) => [step.id, step.op]), [
    ["an-offer.kill-gear", "effect.kill"],
    ["an-offer.play-gold-token", "effect.token"]
  ]);
});

test("rad-101-167 An Offer You Can't Refuse: the kill instruction targets one board gear (CR 429.6)", () => {
  const [instruction] = program.abilities[1].body;
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "chosen-gear" });
  assert.equal(instruction.linkedTo, undefined);
  assert.deepEqual(instruction.targets, [{
    id: "chosen-gear",
    filter: { type: "gear", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("rad-101-167 An Offer You Can't Refuse: the kill instruction really kills a gear in the reference kernel", () => {
  const [instruction] = program.abilities[1].body;
  const kernel = world()
    .unit("an-offer", { types: ["gear"], might: null, energy: 2, power: null, zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-gear", { owner: "B", types: ["gear"], might: null, energy: 1, power: null, zone: "board", location: { type: "base", player: "B" } })
    .build();
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { "chosen-gear": [kernel.ref("enemy-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
  assert.deepEqual(run.linked.killed.map((ref) => ref.id), ["enemy-gear"]);
});

test.todo("rad-101-167 An Offer You Can't Refuse: the Gold gear token definition (CR 187.5, with its own \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\" ability) must be added to the frozen token table before it can be created.");
test.todo("rad-101-167 An Offer You Can't Refuse: \"plays a Gold gear token exhausted\" needs the create-token entry-state override (CR 143.4 / 185.2.d); a follow-up effect.exhaust is not equivalent and is deliberately not used.");
test.todo("rad-101-167 An Offer You Can't Refuse: \"Its controller\" needs the killed gear's controller bound from the kill result as the token's player (no event-object ObjectSelector and no linked-object controller expression are merged).");
test.todo(
  "rad-101-167 An Offer You Can't Refuse: the production chain must consume the { type: \"play\" } action " +
    "(chain/engine.ts requires the caller's describePlay adapter; EngineRuntimeHost returns impossible " +
    "for play) before the Gold token can be created and played through the real chain"
);
