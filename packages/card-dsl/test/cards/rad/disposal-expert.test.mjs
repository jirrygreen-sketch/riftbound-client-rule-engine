import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/disposal-expert.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CARD_ID = "card.hash-b23b662b4d812531660baae2b9e4fc78660d2955cd85f9595e0a61e14f5ea7a0";
const SOURCE_TEXT =
  "I enter ready if you control no other units.\n" +
  "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)";

test("rad-093-167 Disposal Expert: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.match(program.judgeReason, /\[Disarm 2\]|831/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-093-167 Disposal Expert: enter-ready replacement plus the Disarm 2 keyword", () => {
  assert.equal(program.abilities.length, 2);

  const replacement = program.abilities[0];
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.deepEqual(replacement.with.map(instruction => instruction.id), ["disposal-expert.enter-ready"]);
  assert.equal(replacement.with[0].op, "effect.ready");
  assert.deepEqual(replacement.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });

  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "disarm", value: 2 });
});

test("rad-093-167 Disposal Expert: the entering gate is 'you control no other units'", () => {
  const [replacement] = program.abilities;
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "unit",
      filter: { type: "unit", controller: "controller", zone: "board", other: true }
    },
    operator: "eq",
    right: { kind: "constant", value: 0 }
  });
});

test("rad-093-167 Disposal Expert: the replacement body readies the entering unit through effect.ready", () => {
  const [replacement] = program.abilities;
  const kernel = world()
    .unit("disposal-expert", {
      zone: "board",
      exhausted: true,
      location: { type: "base", player: "A" }
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("disposal-expert") });
  const outcome = runAbilityBody(replacement.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("disposal-expert").exhausted, false);
  assert.equal(outcome.events[0].action, "ready");
});

test("rad-093-167 Disposal Expert: entering ready is not a post-hoc ready of an already entered unit", () => {
  // 359.2.c / 416.1.b: a unit that is already ready is unaffected, and the
  // primitive links a zero count instead of emitting a phantom ready event.
  const [replacement] = program.abilities;
  const kernel = world()
    .unit("disposal-expert", { zone: "board", exhausted: false, location: { type: "base", player: "A" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("disposal-expert") });
  const run = runInstruction(ready, replacement.with[0].args, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test.todo(
  "disposal-expert: board-entry replacement execution (replacement.enter family) that replaces the exhausted" +
    " entry with a ready entry when 'you control no other units' (CR v1.5 359.2.c)"
);
test.todo(
  "disposal-expert: [Disarm 2] expansion (CR 831.1.d attack trigger + -2 Might this turn to an enemy unit here," +
    " with the minimum clamp of 122.5.b) needs a Disarm KeywordDef and the layers continuous.might consumer" +
    " (RIFT-81 / RIFT-91)"
);
