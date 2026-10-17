import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/dunebreaker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";

const CARD_ID = "card.hash-85f0797777f47ae8cbaf1fc45bef08bec2cab5e31a48fa3cff8568018fc7ff8d";

const [enterReady, holdDraw] = program.abilities;
const [drawInstruction] = holdDraw.body;

test("sfd-027-221 Dunebreaker: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-027-221 Dunebreaker: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "If you have two or fewer cards in your hand, I enter ready.\nWhen I hold, draw 2."
  );
});

test("sfd-027-221 Dunebreaker: judgeReason names the replacement-enter and hand-size gaps", () => {
  assert.match(program.judgeReason, /RIFT-260/);
  assert.match(program.judgeReason, /matchesEnterAction/);
  assert.match(program.judgeReason, /condition/);
  assert.match(program.judgeReason, /383\.4\.d\.2\.a/);
  assert.match(program.judgeReason, /battlefieldId/);
});

test("sfd-027-221 Dunebreaker: enter-ready is a replacement, not a post-entry effect.ready", () => {
  // 359.2.c / 369.3: units enter exhausted by default and "I enter ready"
  // replaces that; effect.ready.ts states it does not participate in entry
  // replacement, so the ability must be shaped as a replacement.
  assert.equal(program.abilities.length, 2);
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.equal(enterReady.with.length, 1);
  assert.equal(enterReady.with[0].id, "dunebreaker.enter-ready");
  assert.equal(enterReady.with[0].op, "effect.ready");
  assert.deepEqual(enterReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });

  // "If you have two or fewer cards in your hand" is part of the replacement's
  // applicability (369.3), not a body instruction condition.
  assert.equal(enterReady.condition.kind, "compare");
  assert.equal(enterReady.condition.operator, "lte");
  assert.deepEqual(enterReady.condition.right, { kind: "constant", value: 2 });
  assert.equal(enterReady.condition.left.kind, "count");
  // 190.6.d: "you" is the ability controller; chain/engine.ts normalizes the
  // `self` PlayerSelector for owner/controller filters (merged behavior).
  assert.deepEqual(enterReady.condition.left.filter, { zone: "hand", owner: "self" });
});

test("sfd-027-221 Dunebreaker: the hold trigger draws 2 (383.4.d, 414.3)", () => {
  assert.equal(holdDraw.kind, "triggered");
  assert.equal(holdDraw.trigger.at, "hold");
  assert.deepEqual(holdDraw.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.equal(holdDraw.trigger.condition, undefined);
  assert.equal(holdDraw.trigger.once, undefined);
  assert.equal(holdDraw.optional, false);

  assert.equal(holdDraw.body.length, 1);
  assert.equal(drawInstruction.id, "dunebreaker.draw-2");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("sfd-027-221 Dunebreaker golden: the hold body draws 2 from the controller's Main Deck", () => {
  // An array adds a top-to-bottom block (effects/testing/README.md).
  const kernel = world().deck(["top-card", "second-card", "third-card"]).build();
  const outcome = resolveChainBody(holdDraw.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["dunebreaker.draw-2", "executed"]
  ]);
  // CR 414.1.a / 414.3: two cards come off the top of the controller's Main Deck.
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card", "second-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["third-card"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
});

test("sfd-027-221 Dunebreaker golden: a short deck draws as much as possible (CR 414.4)", () => {
  const kernel = world().deck("only-card").build();
  const outcome = resolveChainBody(holdDraw.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["only-card"]);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("sfd-027-221 Dunebreaker golden: the printed draw instruction runs on the merged primitive", () => {
  const kernel = world().deck(["alpha", "beta"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["alpha", "beta"]);
});

test("sfd-027-221 Dunebreaker golden: the merged replacement binding really rewrites the entry orientation", () => {
  const f = fixture({ cards: [{ id: "dunebreaker", types: ["unit"] }, { id: "extra", types: ["unit"] }] });
  const bound = bindReplacement(
    enterReady,
    f.kernel.ref("dunebreaker"),
    {
      host: {
        object: (ref) => f.kernel.object(ref),
        objects: () => f.kernel.objects,
        context: f.host.context
      },
      pipeline: f.engine.pipeline
    }
  );

  f.engine.execute(f.card("dunebreaker", { kind: "unit", body: [] }));
  resolveAll(f.engine);

  const landed = f.kernel.getObject("dunebreaker");
  assert.equal(landed.zone, "board");
  // 359.2.c / 369.3: the orientation comes from the entry rewrite itself, so
  // the permanent never passes through a separate "becomes ready" event.
  assert.equal(landed.exhausted, false);
  assert.equal(f.engine.pipeline.events.some((event) => event.timingPoint === "object-readied"), false);
  bound.cancel();
});

test.todo(
  "sfd-027-221 Dunebreaker: the entry-orientation matcher must evaluate the ability condition " +
    "(\"If you have two or fewer cards in your hand\", 369.3) before rewriting the entry state — " +
    "a 3-card hand must enter exhausted; replacement/bind.ts must include condition in matchesEnterAction (RIFT-260 follow-up)"
);

test.todo(
  "sfd-027-221 Dunebreaker: a real Beginning Hold must draw 2 only for this unit's held battlefield " +
    "(383.4.d.2.a); bind the hold player/battlefieldId to the unit's location instead of requiring event.object"
);
