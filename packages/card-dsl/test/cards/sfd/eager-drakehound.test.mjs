import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/eager-drakehound.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll, createProgramBinding } from "../../../../engine-core/test/programs/helpers.mjs";

const ID = "card.hash-1497e682bf282da7f38e77af1bfab763e1be0d7a44c62995f1af09d4ba6b6281";
const replacement = program.abilities[0];
const enterReady = replacement.with[0];

test("sfd-006-221 Eager Drakehound: validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "I enter ready.");
});

test("sfd-006-221 Eager Drakehound: declares an exhausted-entry replacement", () => {
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, { event: "object-enters-board", filter: { source: "self", exhausted: true } });
  assert.deepEqual(enterReady, {
    id: "eager-drakehound.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});

test("sfd-006-221 Eager Drakehound: replacement body readies an exhausted unit", () => {
  const base = world().unit("drake", { exhausted: true }).build();
  const bound = base.clone({ source: base.ref("drake"), sourceSnapshot: base.getObject("drake") });
  const outcome = resolveChainBody([enterReady], bound);
  assert.equal(outcome.status, "executed");
  assert.equal(bound.getObject("drake").exhausted, false);
  assert.equal(outcome.results[0].result.status, "executed");
});

test("sfd-006-221 Eager Drakehound golden: the merged card program enters ready through the real play flow", () => {
  // 359.2.c / 369.3: the replacement is bound to the live engine before the
  // unit moves from the Chain zone to the Board, so the printed "I enter
  // ready." really changes the default exhausted entry orientation.
  const binding = createProgramBinding({ cardPrograms: [program] });
  const f = fixture({
    cards: [{ id: "drake", cardId: ID, types: ["unit"] }, { id: "extra", types: ["unit"] }],
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(f.engine);

  f.engine.commit({ type: "play", object: f.kernel.ref("drake"), player: "A", location: { type: "battlefield", id: "battlefield-1" } });
  f.engine.advance();
  resolveAll(f.engine);

  const landed = f.kernel.getObject("drake");
  assert.equal(landed.zone, "board");
  assert.equal(landed.exhausted, false);
  // 805.6.a: the orientation comes from the entry rewrite, so the permanent
  // never passes through a separate becomes-ready event.
  assert.equal(f.engine.pipeline.events.some((event) => event.timingPoint === "object-readied"), false);
});

