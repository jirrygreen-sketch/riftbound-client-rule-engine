import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/wrath-of-the-freljord.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

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
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /Unavailable characteristic: designation/);
  // README section 2: the reason names merged code that fails, never a task id.
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
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

test("rad-077-167 Wrath of the Freljord: the production Shield gate stays false while the combatRole twin evaluates (814.1.d)", () => {
  // The gap is the property name, not the layer pipeline: the real static binder
  // registers the expansion's continuous.might, but its `designation` condition
  // throws MissingInformation against a defender snapshot and the binder's catch
  // makes it permanently false. The equivalent combatRole reading resolves.
  const kernel = world().player("A").player("B")
    .unit("wrath", {
      controller: "A", owner: "A", might: 7, combatRole: "defender", zone: "board",
      location: { type: "battlefield", id: "bf-1" }, keywords: [{ id: "Shield", value: 3 }]
    })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const snapshot = { ...kernel.getObject("wrath"), cardId: CARD_ID };
  const [expansion] = shield.expand({ host: { canonicalCardId: CARD_ID }, value: 3 });
  const handle = bindStaticAbility(createEngineStaticBinder(engine), expansion, snapshot);
  engine.layers.setObjects(kernel.objects);
  assert.deepEqual(engine.layers.registry.list().map(entry => entry.effect.effect.kind), ["continuous.might"]);
  assert.equal(engine.layers.evaluate(snapshot.ref).might, 7, "the defender gate never opens");
  handle.unbind();

  // The condition itself is unevaluable through the default expression path...
  const context = bindResolveContext(kernel, { source: snapshot, controller: "A", timingPoint: "chain-item-resolve" });
  const environment = {
    context, host: snapshot.ref, linked: () => undefined, canLookBack: () => true, isIgnored: () => false
  };
  assert.throws(
    () => evaluateCondition(expansion.condition, environment),
    /Unavailable characteristic: designation/
  );
  // ...while the same comparison over ObjectSnapshot.combatRole returns true.
  assert.equal(
    evaluateCondition({
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "combatRole" },
      operator: "eq",
      right: { kind: "constant", value: "defender" }
    }, environment),
    true
  );
  const combatRolePredicate = runAbilityBody([{
    id: "wrath.combat-role-gate",
    op: "condition.predicate",
    args: {
      condition: {
        kind: "constant",
        value: {
          kind: "compare",
          left: { kind: "object-property", object: "self", property: "combatRole" },
          operator: "eq",
          right: { kind: "constant", value: "defender" }
        }
      }
    }
  }], kernel, undefined, { host: kernel.ref("wrath") });
  assert.equal(combatRolePredicate.results[0].result.linkedValues.value, true);
});
