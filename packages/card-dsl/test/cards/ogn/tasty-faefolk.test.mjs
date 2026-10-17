import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program, { deathknellBody } from "../../../dist/cards/ogn/tasty-faefolk.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";


test("ogn-075-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-bcc76f0b1b3b8dafd184b4a3307e12e03a80d4c9902254de9e30a4f6b0f1aba2");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /payload|trigger.leave/);
  assert.match(program.judgeReason, /RIFT-/);
  assert.equal(program.sourceText, "[Accelerate] (You may pay :rb_energy_1::rb_rune_calm: as an additional cost to have me enter ready.)\n[Deathknell] — Channel 2 runes exhausted and draw 1. (When I die, get the effect.)");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

const [accelerate, deathknell] = program.abilities;
const [channelRunes, drawCard] = deathknellBody;

test("Tasty Faefolk: declare Accelerate/Deathknell without duplicating the death trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(program.abilities.some(ability => ability.kind === "triggered"), false);
  assert.equal(deathknellBody.length, 2);
  assert.match(program.judgeReason, /唯一绑定契约/);
});

test("Tasty Faefolk: channel two exhausted runes, then independent Draw 1", () => {
  assert.deepEqual(deathknellBody.map(instruction => instruction.op), ["effect.channel", "effect.draw"]);
  assert.deepEqual(channelRunes.args, { amount: { kind: "constant", value: 2 }, exhausted: { kind: "constant", value: true } });
  assert.deepEqual(drawCard.args, { amount: { kind: "constant", value: 1 } });
  for (const instruction of deathknellBody) {
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.condition, undefined);
  }
});

test.todo("Tasty Faefolk golden: channel the actual top two Rune Deck cards exhausted (RIFT-46 kernel ignores channel-rune.exhausted)", () => {
  const kernel = world().unit("faefolk", { might: 6, energy: 7, power: null }).rune(["rune-1", "rune-2", "rune-3"]).build();
  const run = runInstruction(channel, channelRunes.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 2);
  for (const id of ["rune-1", "rune-2"]) {
    assert.equal(kernel.getObject(id).zone, "rune-zone");
    assert.equal(kernel.getObject(id).exhausted, true);
  }
  assert.equal(kernel.getObject("rune-3").zone, "rune-deck");
  assert.equal(kernel.getObject("faefolk").power, null);
  assert.ok(run.events.length > 0);
  assert.ok(run.events.every(event => event.action === "channel-rune"));
});

test.todo("Tasty Faefolk golden: an undersized Rune Deck channels as many as possible EXHAUSTED (RIFT-46 kernel ignores exhausted)", () => {
  const kernel = world().unit("faefolk", { might: 6, power: null }).rune("last-rune").build();
  const run = runInstruction(channel, channelRunes.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.getObject("last-rune").zone, "rune-zone");
  assert.equal(kernel.getObject("last-rune").exhausted, true);
});

test("Tasty Faefolk golden subeffect: Draw 1 moves the actual top Main Deck card", () => {
  const kernel = world().unit("faefolk", { might: 6, power: null }).deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, drawCard.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.getObject("top-card").zone, "hand");
  assert.equal(kernel.getObject("next-card").zone, "deck");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test.todo("Tasty Faefolk: bind the payload to exactly one Deathknell expansion, preserve LKI and suppress replaced deaths (CR 808; RIFT-1/82/120)");
test.todo("Tasty Faefolk: original ordered channel/draw body through interpreter, including negated channel followed by independent draw (RIFT-1/120 Expr schema alignment)");
test.todo("Tasty Faefolk: actual optional Accelerate 1 energy + matching Calm power cost and enter-ready replacement without object-readied (CR 805; RIFT-89/120)");

// Keep the exhausted-entry assertions above intact: they expose an upstream
// reference-kernel bug. Do not pre-exhaust Rune Deck cards or exhaust afterward.
test("Tasty Faefolk golden subeffect: empty Rune Deck channels zero without negating", () => {
  const kernel = world().unit("faefolk", { might: 6, power: null }).build();
  const run = runInstruction(channel, channelRunes.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.deepEqual(run.events.map(event => event.action), ["channel-rune"]);
  assert.ok(run.events.every(event => event.type === "task-resolved"));
});
