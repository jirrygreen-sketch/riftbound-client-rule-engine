import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/scrapheap.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("ogn-182-298 Scrapheap: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-182-298 Scrapheap: identity, version and verbatim source text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-d67f99047d4623fcb8c8cd0527b63550d8061a4b4f71c53edcf8fa25e239b8ee"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /423\.1\.b/);
  assert.match(program.judgeReason, /activeZones/);
  assert.match(program.judgeReason, /385/);
  assert.match(program.judgeReason, /pipeline-match/);
  assert.equal(program.sourceText, "When this is played, discarded, or killed, draw 1.");
});

test("ogn-182-298 Scrapheap: one independent draw-1 trigger per event (played / discarded / killed)", () => {
  assert.equal(program.abilities.length, 3);
  const [played, discarded, killed] = program.abilities;

  assert.equal(played.kind, "triggered");
  assert.equal(played.trigger.at, "card-played");
  assert.deepEqual(played.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.equal(played.optional, false);
  assert.equal(played.trigger.once, undefined);

  assert.equal(discarded.kind, "triggered");
  assert.equal(discarded.trigger.at, "card-discarded");
  assert.deepEqual(discarded.trigger.filter, {
    event: "card-discarded",
    filter: { role: "self" }
  });
  assert.equal(discarded.optional, false);

  assert.equal(killed.kind, "triggered");
  assert.equal(killed.trigger.at, "object-killed");
  assert.deepEqual(killed.trigger.filter, { event: "object-killed", filter: { role: "self" } });
  assert.equal(killed.optional, false);

  for (const ability of program.abilities) {
    assert.equal(ability.body.length, 1);
    const [instruction] = ability.body;
    assert.equal(instruction.op, "effect.draw");
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
  assert.deepEqual(
    program.abilities.map(ability => ability.body[0].id),
    ["scrapheap.draw-on-play", "scrapheap.draw-on-discard", "scrapheap.draw-on-kill"]
  );
});

test("ogn-182-298 Scrapheap: every draw-1 instruction executes through effect.draw", () => {
  for (const ability of program.abilities) {
    const [instruction] = ability.body;
    const kernel = world().deck(["top", "second"]).build();
    const run = runInstruction(draw, instruction.args, { world: kernel });
    assert.equal(run.result.status, "executed");
    assert.equal(run.linked.drawn, 1);
    assert.equal(kernel.player("A").handSize, 1);
    assert.equal(kernel.player("A").deckSize, 1);
    assert.deepEqual(run.events.map(event => event.action), ["draw"]);
  }
});

test.todo(
  "Scrapheap: production trigger registration for card-played / card-discarded / object-killed " +
    "with the card's own incarnation identity (card-program adapter / RIFT-120 integration)"
);
