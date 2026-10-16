import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/stormclaw-ursine.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: channel } = await import(new URL("effects/instructions/effect.channel.js", engineCore));
const { keywordRegistryById } = await import(new URL("effects/keywords/registry.generated.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-c18b4d77a6fdbfcd9607beb0b7cb54e7133f47d1442f38f5e6dc0c7c5b88a769";
const [tankKeyword, playedTrigger] = program.abilities;
const channelInstruction = playedTrigger.body[0];

test("Stormclaw Ursine program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /keywords\//);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\n" +
      "When you play me, channel 1 rune exhausted."
  );
});

test("structure: Tank keyword plus the played trigger that channels 1 exhausted rune", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(tankKeyword, { kind: "keyword", keyword: "tank" });

  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playedTrigger.optional, false);

  assert.equal(playedTrigger.body.length, 1);
  assert.equal(channelInstruction.id, "stormclaw.channel");
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args, {
    amount: { kind: "constant", value: 1 },
    exhausted: { kind: "constant", value: true }
  });
  // No target/pick/choice: the channeling player is the ability controller
  // (effect.channel defaults to ctx.controller).
  assert.equal(channelInstruction.targets, undefined);
  assert.equal(channelInstruction.picks, undefined);
  assert.equal(channelInstruction.linkedTo, undefined);
});

test("golden: 'channel 1 rune exhausted' resolves through effect.channel (CR 431.1/431.2)", () => {
  const kernel = world().rune(["r1", "r2"], { owner: "A" }).build();
  const run = runInstruction(channel, channelInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("r1").zone, "rune-zone");
  assert.equal(kernel.getObject("r2").zone, "rune-deck");
  const action = run.events.find(event => event.action === "channel-rune");
  assert.ok(action, "expected the channel-rune game action");
  // CR 431.2: the printed stipulation (one rune, exhausted) is exactly what the
  // card passes to the closed channel-rune action; the rune leaves the rune
  // deck and lands in the rune zone.
  assert.equal(action.action, "channel-rune");
  assert.deepEqual(kernel.objectsInZone("A", "rune-zone").map(ref => ref.id), ["r1"]);
});

test("golden: an empty rune deck channels as many as possible without negating (CR 431.3)", () => {
  const kernel = world().build();
  const run = runInstruction(channel, channelInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runePool.length, 0);
});

test("dependency evidence: no Tank KeywordDef is registered (CR 815 expansion missing)", () => {
  assert.equal(keywordRegistryById.has("Tank"), false);
  assert.equal(keywordRegistryById.has("tank"), false);
});

test.todo(
  "Stormclaw Ursine: [Tank] expansion (CR 815.1.b combat-damage assignment order) has no " +
    "effects/keywords/Tank.ts and nothing in combat/ reads it — combat/base-combat-allocation.ts " +
    "explicitly binds no Tank requirement (kw-tank batch / engine batch 5)"
);
test.todo(
  "Stormclaw Ursine: the played trigger only becomes reachable once the card-played timing emitted " +
    "by chain/engine.ts is wired through the server-facing runtime (engine batch 4)"
);
