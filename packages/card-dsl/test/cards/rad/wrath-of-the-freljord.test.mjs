import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/wrath-of-the-freljord.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-fc7374c39848c88e67ed66b36519a4f64f748f14266f0341692d6f5db092e3e4";

const [enterReady, shieldKeyword] = program.abilities;
const [readyInstruction] = enterReady.with;

test("rad-077-167 Wrath of the Freljord: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /syntheticEnter/);
  assert.match(program.judgeReason, /designation/);
});

test("rad-077-167 Wrath of the Freljord: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "I enter ready.\n[Shield 3] (+3 :rb_might: while I'm a defender.)"
  );
});

test("rad-077-167 Wrath of the Freljord: 'I enter ready' is a board-entry replacement, not a resolving ready (143.4 / 369.3)", () => {
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(enterReady.with.length, 1);
  assert.equal(readyInstruction.id, "wrath-of-the-freljord.enter-ready");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
  // 369.3 / 805.6.a: the unit never enters exhausted first, so no object-readied timing fires.
  assert.equal(enterReady.replaces.filter.exhausted, true);
  assert.equal(enterReady.condition, undefined);
});

test("rad-077-167 Wrath of the Freljord: [Shield 3] keeps the printed value (814.1.b.1)", () => {
  assert.deepEqual(shieldKeyword, { kind: "keyword", keyword: "shield", value: 3 });
});

test("rad-077-167 Wrath of the Freljord: the Shield expansion ties +3 Might to the defender designation (814.1.c / 814.1.d)", () => {
  const registered = keywordDefinitionsById.get("Shield");
  assert.ok(registered, "Shield is registered in the generated keyword registry");
  const [expansion] = shield.expand({ host: { canonicalCardId: CARD_ID }, value: 3 });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.equal(expansion.effect.mode, "add");
  assert.equal(expansion.effect.layer, "arithmetic");
  assert.equal(expansion.effect.appliesTo, "self");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 3 });
  // 814.1.d: the bonus only applies while the unit holds the Defender designation.
  assert.deepEqual(expansion.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "defender" }
  });
});

test("rad-077-167 Wrath of the Freljord: the enter-ready replacement body really readies the source (evidence for the merged replacement primitive)", () => {
  const kernel = world().unit("wrath", { exhausted: true, might: 7 }).build();
  const ref = kernel.ref("wrath");
  // The replacement body targets the source object; the kernel needs its snapshot as source.
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("wrath") });
  const run = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "source" } } },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(scoped.getObject("wrath").exhausted, false);
  assert.deepEqual(run.linked.readied.objects, [ref]);
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
});

test("rad-077-167 Wrath of the Freljord: an already-ready unit produces no ready action (416.1.b)", () => {
  // A sanity check on the primitive used by the replacement: it cannot be used to fake a
  // second "becomes ready" event (369.3's no-ready-trigger claim).
  const kernel = world().unit("wrath", { exhausted: false, might: 7 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("wrath") });
  const run = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "source" } } },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.equal(run.events.length, 0);
});

test.todo(
  "rad-077-167 Wrath of the Freljord: [Shield 3] while defending — the expansion emits " +
    "continuous.might gated on the Defender designation, but that designation is not an " +
    "ObjectSnapshot characteristic (contract 3.8 adds only combatRole); the continuous.might " +
    "layer operation is already merged; bindStaticToLayers " +
    "therefore catches MissingInformation and evaluates the condition to false, so the bonus " +
    "cannot be claimed executable until the designation feature is added."
);
