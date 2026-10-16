import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/corrupt-enforcer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6666f6b3e8f7bb7ccdcff09e4d51d69c2067503b913dd14022cb3d88f30b9476";
const SOURCE_TEXT = "When I move to a battlefield, discard 1.\nWhen I win a combat, draw 1.";

const [moveTrigger, combatTrigger] = program.abilities;
const [discardInstruction] = moveTrigger.body;
const [drawInstruction] = combatTrigger.body;

test("sfd-123-221 Corrupt Enforcer: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-123-221 Corrupt Enforcer: judgeReason names both unmerged trigger paths with rule refs", () => {
  assert.match(program.judgeReason, /toZone\/toKind/);
  assert.match(program.judgeReason, /449\.1\/449\.2/);
  assert.match(program.judgeReason, /458/);
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /468\.3/);
  assert.match(program.judgeReason, /423\.1/);
  assert.match(program.judgeReason, /414\.1/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-33/);
});

test("sfd-123-221 Corrupt Enforcer: 'when I move to a battlefield' subscribes to object-moved", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(moveTrigger.kind, "triggered");
  // 421.1 / 449.1-449.2 / 458: a successful Move (a Recall is not a Move).
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(moveTrigger.trigger.condition, undefined);
  assert.equal(moveTrigger.optional, false);

  // 423.1 / 423.1.a: discarding hands the card to its owner's Trash; the
  // secret choice needs a stable replay id and defaults to the controller.
  assert.equal(discardInstruction.id, "corrupt-enforcer.discard-1");
  assert.equal(discardInstruction.op, "effect.discard");
  assert.deepEqual(discardInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(discardInstruction.args.choiceId, {
    kind: "constant",
    value: "corrupt-enforcer.discard"
  });
  assert.equal(discardInstruction.args.player, undefined);
  assert.equal(discardInstruction.targets, undefined);
  assert.equal(discardInstruction.linkedTo, undefined);
});

test("sfd-123-221 Corrupt Enforcer: 'when I win a combat' subscribes to combat-result", () => {
  assert.equal(combatTrigger.kind, "triggered");
  // 468.3.a-d / 468.4: the winning player is determined after combat cleanup;
  // 383.x keeps it a triggered ability that goes on the Chain.
  assert.equal(combatTrigger.trigger.at, "combat-result");
  assert.deepEqual(combatTrigger.trigger.filter, { event: "combat-result", player: "self" });
  assert.equal(combatTrigger.optional, false);

  // 414.1 / 414.3: the implicit drawer is the ability's controller (190.6.d).
  assert.equal(drawInstruction.id, "corrupt-enforcer.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.args.player, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("sfd-123-221 Corrupt Enforcer golden: the discard clause discards exactly one card through the real kernel", () => {
  const kernel = world()
    .player("A")
    .hand("kept")
    .hand("pitched")
    .build();
  const pitchedRef = kernel.ref("pitched");
  // 423.1.a: the discarder chooses the card; the interpreter path scopes the
  // request id as <instruction path>/<choiceId>.
  kernel.setAnswers({ "corrupt-enforcer.discard-1/corrupt-enforcer.discard": [kernel.ref("pitched")] });

  const outcome = resolveChainBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("pitched").zone, "trash");
  assert.equal(kernel.getObject("kept").zone, "hand");
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["pitched"]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["discard"]);
  // The merged primitive links { count, player, objects } under its linkKey, so
  // the actual discarded count is read from the receipt (423.1/423.4). The
  // receipt keeps the pre-discard (last-known) references.
  assert.deepEqual(outcome.linkedValues["corrupt-enforcer.discard-1.discarded"], {
    count: 1,
    player: "A",
    objects: [pitchedRef]
  });
});

test("sfd-123-221 Corrupt Enforcer golden: an empty hand makes the discard impossible, not a silent no-op", () => {
  const kernel = world().player("A").build();
  const outcome = resolveChainBody(moveTrigger.body, kernel);
  // 423.4: an unmet positive count is negated (impossible); the card does not
  // pretend the discard happened.
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.deepEqual(kernel.events, []);
});

test("sfd-123-221 Corrupt Enforcer golden: the combat clause draws 1 through the real kernel", () => {
  const kernel = world().deck(["top", "second"]).build();
  const outcome = resolveChainBody(combatTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["corrupt-enforcer.draw-1.drawn"], 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
});

test("sfd-123-221 Corrupt Enforcer golden: an empty deck links 0 drawn and invents no card", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  // 414.4 / contract 3.6: the primitive links the actual count; the kernel owns
  // Burn Out, and no card is created from nothing.
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "sfd-123-221 Corrupt Enforcer: the object-moved timing point carries toZone/toKind so the " +
    "toZone: \"battlefield\" filter can hit, and the moved object's identity is exposed to the card " +
    "registration so source: \"self\" binds this unit (449.1/449.2; a Recall must stay excluded per 458) — RIFT-120"
);

test.todo(
  "sfd-123-221 Corrupt Enforcer: the combat-result timing point is emitted after combat cleanup " +
    "(468.3.a-d, 468.4) with the winning player bound so \"When I win a combat\" can subscribe — RIFT-33 / RIFT-124"
);
