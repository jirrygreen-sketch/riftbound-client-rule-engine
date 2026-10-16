import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shadows-call.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-20160abc2cd3adac87c1b0f03192e12ab9103b22ffbd5a8468e4072e00264025";
const SOURCE_TEXT =
  "Choose a friendly unit without [Temporary]. Give it [Temporary]. Draw 2. " +
  "(Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [play] = program.abilities;
const [grantTemporary, drawInstruction] = play.body;
const executableDraw = (() => {
  const { targets, ...rest } = drawInstruction;
  return rest;
})();

test("unl-165-219 Shadow's Call: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.match(program.judgeReason, /816\.3/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-165-219 Shadow's Call: printed 2 energy, no printed power, and one chosen friendly unit", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  // 355.5 / 355.7: "Choose a friendly unit" is a targeting choice; the
  // "without [Temporary]" restriction (816.3) stays descriptive (judgeReason).
  assert.equal(grantTemporary.op, "continuous.grant-keyword");
  assert.deepEqual(grantTemporary.args.keyword, { kind: "constant", value: "Temporary" });
  assert.deepEqual(grantTemporary.targets, [
    {
      id: "shadows-call.friendly-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "controller",
        withoutKeyword: "Temporary"
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(grantTemporary.linkedTo, undefined);
});

test("unl-165-219 Shadow's Call: the Draw 2 sentence is independent of the keyword grant", () => {
  assert.equal(drawInstruction.id, "shadows-call.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
  // Two printed sentences: linking them would let an impossible grant suppress
  // the draw (055 / 359.3.e.11).
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
});

test("unl-165-219 Shadow's Call golden: the merged Draw 2 half draws two cards", () => {
  const kernel = world().deck(["top", "second", "third"]).build();
  const outcome = resolveChainBody([executableDraw], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["shadows-call.draw.drawn"], 2);
  assert.equal(outcome.linkedValues["shadows-call.draw.drawnTo"], "A");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top", "second"]);
});

test("unl-165-219 Shadow's Call golden: a short deck draws as much as possible (414.4)", () => {
  const kernel = world().deck("only-card").build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

test.todo(
  "unl-165-219 Shadow's Call: grant [Temporary] to the chosen unit (CR 816.1.a: a characteristic of the permanent, " +
    "816.3 referenceable) — needs the unmerged Temporary KeywordDef (RIFT-83) and a merged grant-keyword " +
    "continuous effect consumed by the layers engine (RIFT-91); the card must not restate the keyword expansion"
);

test.todo(
  "unl-165-219 Shadow's Call: the Temporary trigger — kill the permanent at the start of its controller's Beginning " +
    "Phase, before scoring (CR 816.1.b/816.1.c) — needs the keyword's delayed trigger registration at beginning-start"
);

test.todo(
  "unl-165-219 Shadow's Call: enforce 'without [Temporary]' as a targeting restriction (CR 355.9.b, 816.3) once the " +
    "filter vocabulary can read keyword characteristics"
);

