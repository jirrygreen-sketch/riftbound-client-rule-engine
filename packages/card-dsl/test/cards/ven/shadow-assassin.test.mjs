import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-assassin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

// Execution evidence for the supported replacement body lives in
// ../templates/replacement-effect-ready-655.test.mjs.
const CARD_ID =
  "card.hash-101dc13865ec4192cab5368a9a51d1582968c98f57b52ab293cd35e4c5313b0c";
const SOURCE_TEXT = "I enter ready if you have a card with my name in your trash.";

const [replacement] = program.abilities;
const [enterReady] = replacement.with;

/** The reference kernel binds "self" to the replacement host. */
function hostWorld(kernel, id) {
  return kernel.clone({ source: kernel.ref(id), sourceSnapshot: kernel.getObject(id) });
}

test("ven-013-166 Shadow Assassin: validates and is registered by canonical identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /matchesEnterAction/);
  assert.match(program.judgeReason, /132\.1\/132\.3\/132\.4/);
});

test("ven-013-166 Shadow Assassin: records the same-name Trash condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards",
      filter: { zone: "trash", owner: "self", sameNameAs: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(enterReady, {
    id: "shadow-assassin.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});

test("ven-013-166 Shadow Assassin golden: the supported replacement body readies an exhausted source", () => {
  const kernel = hostWorld(
    world().unit("shadow-assassin", { might: 5, exhausted: true }).build(),
    "shadow-assassin"
  );
  assert.equal(kernel.getObject("shadow-assassin").exhausted, true);

  const outcome = resolveChainBody(replacement.with, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["shadow-assassin.enter-ready", "executed"]
  ]);
  assert.equal(kernel.getObject("shadow-assassin").exhausted, false);
  assert.deepEqual(outcome.linkedValues["shadow-assassin.enter-ready.readied"], {
    count: 1,
    objects: [kernel.ref("shadow-assassin")]
  });
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("ven-013-166 Shadow Assassin golden: an already-ready source stays legal with zero readied", () => {
  const kernel = hostWorld(
    world().unit("shadow-assassin", { might: 5, exhausted: false }).build(),
    "shadow-assassin"
  );
  const outcome = resolveChainBody(replacement.with, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(outcome.linkedValues["shadow-assassin.enter-ready.readied"], {
    count: 0,
    objects: []
  });
});

test("ven-013-166 Shadow Assassin golden: bindReplacement changes only the bound entry orientation", () => {
  // The condition remains unsupported; this mechanism probe supplies only the
  // replacement body and compares a bound unit with an unbound control.
  const f = fixture({ cards: [
    { id: "bound-assassin", types: ["unit"] },
    { id: "unbound-assassin", types: ["unit"] }
  ] });
  bindReplacement(
    { replaces: replacement.replaces, with: replacement.with },
    f.kernel.ref("bound-assassin"),
    {
      host: {
        object: ref => f.kernel.object(ref),
        objects: () => f.kernel.objects,
        context: () => f.kernel
      },
      pipeline: f.engine.pipeline
    }
  );
  f.engine.execute(f.card("bound-assassin", { kind: "unit", body: [] }));
  f.engine.execute(f.card("unbound-assassin", { kind: "unit", body: [] }));
  resolveAll(f.engine);

  assert.equal(f.kernel.getObject("bound-assassin").zone, "board");
  assert.equal(f.kernel.getObject("bound-assassin").exhausted, false);
  assert.equal(f.kernel.getObject("unbound-assassin").zone, "board");
  assert.equal(f.kernel.getObject("unbound-assassin").exhausted, true);
});
