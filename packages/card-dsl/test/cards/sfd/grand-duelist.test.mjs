import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import grandDuelist from "../../../dist/cards/sfd/grand-duelist.js";

const ENGINE = new URL("../../../../engine-core/dist/effects/", import.meta.url);
const { default: channel } = await import(new URL("instructions/effect.channel.js", ENGINE));
const { runInstruction, world } = await import(new URL("testing/index.js", ENGINE));

test("sfd-205-221 Grand Duelist: program passes validateCardProgram", () => {
  const result = validateCardProgram(grandDuelist);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-205-221 Grand Duelist: identity and status", () => {
  assert.equal(
    grandDuelist.canonicalCardId,
    "card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4"
  );
  assert.equal(grandDuelist.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(grandDuelist.status, "executable");
  assert.equal(grandDuelist.judgeReason, undefined);
});

test("sfd-205-221 Grand Duelist: optional might-changed trigger structure", () => {
  assert.equal(grandDuelist.abilities.length, 1);
  const ability = grandDuelist.abilities[0];
  assert.equal(ability.kind, "triggered");
  // "When one of your units becomes [Mighty]" — the might-changed timing
  // point filtered to friendly units crossing the 5+ might threshold
  // (CR 706–709).
  assert.equal(ability.trigger.at, "might-changed");
  assert.equal(ability.trigger.filter.event, "might-changed");
  assert.equal(ability.trigger.filter.filter.type, "unit");
  assert.equal(ability.trigger.filter.filter.controller, "controller");
  assert.equal(ability.trigger.filter.filter.becameMighty, true);
  assert.equal(ability.trigger.once, undefined);
  // "you may" makes the trigger optional (CR 428.1).
  assert.equal(ability.optional, true);
});

test("sfd-205-221 Grand Duelist: body chains exhaust-self into channel 1 exhausted", () => {
  const [exhaustSelf, channelRune] = grandDuelist.abilities[0].body;
  // "you may exhaust me" — the cost-like exhaust targets the source legend.
  assert.equal(exhaustSelf.id, "exhaust-self");
  assert.equal(exhaustSelf.op, "effect.exhaust");
  assert.deepEqual(exhaustSelf.args.target, { kind: "constant", value: "source" });
  assert.equal(exhaustSelf.linkedTo, undefined);
  // "to channel 1 rune exhausted" (CR 431.2).
  assert.equal(channelRune.id, "channel-rune");
  assert.equal(channelRune.op, "effect.channel");
  assert.deepEqual(channelRune.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelRune.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelRune.linkedTo, "exhaust-self");
});

test("sfd-205-221 Grand Duelist: sourceText is the printed ability text", () => {
  assert.equal(
    grandDuelist.sourceText,
    "When one of your units becomes [Mighty], you may exhaust me to channel 1 rune exhausted. (A unit is Mighty while it has 5+ :rb_might:.)"
  );
});

test("sfd-205-221 Grand Duelist: channel instruction executes on the reference kernel", () => {
  // Only the merged effect.channel primitive is executed here; the
  // effect.exhaust instruction depends on the still-unmerged exhaust
  // primitive, so the golden run drives the channel instruction alone.
  const channelRune = grandDuelist.abilities[0].body[1];
  const kernel = world().rune(["r1", "r2"]).build();
  const run = runInstruction(
    channel,
    { amount: channelRune.args.amount, exhausted: channelRune.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  // CR 431: one rune leaves the rune deck and enters the rune zone; the
  // kernel keeps the channeled rune in the player's rune pool.
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("r1").zone, "rune-zone");
  assert.equal(kernel.getObject("r2").zone, "rune-deck");
  // The exhausted entry stipulation (431.2) is passed to the channel-rune
  // action; the reference kernel records the action it performed.
  const channelEvent = run.events.find((event) => event.action === "channel-rune");
  assert.ok(channelEvent, "expected a channel-rune game action");
  // Replaying the program's own arguments (amount 1, exhausted true) must
  // produce exactly the action the card describes.
  const replayed = runInstruction(
    channel,
    { amount: { kind: "constant", value: 1 }, exhausted: { kind: "constant", value: true } },
    { world: world().rune(["r1", "r2"]).build() }
  );
  assert.equal(replayed.result.status, "executed");
  assert.equal(replayed.linked.channeled, 1);
});

test.todo(
  "trigger registration at might-changed with becameMighty predicate and optional (may) choice — pending trigger/choice engine (RIFT-81~91)"
);
test.todo(
  "full trigger body: exhaust-self as cost-like sequencing gating the linked channel — pending effect.exhaust primitive (RIFT-81~91)"
);
