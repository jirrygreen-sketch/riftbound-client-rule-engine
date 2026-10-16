import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/on-the-hunt.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-619e8c7224e121c07463a5df717ede038bc215b47679f537e42c290d78c92f07";
const SOURCE_TEXT = "Ready your units.";

const [play] = program.abilities;
const [readyUnits] = play.body;

/**
 * The reference kernel compares filter values literally, while the card layer
 * spells "your units" as controller: "self" and the chain's query path
 * (chain/engine.ts:242-248) normalizes "self"/"opponent" against the item's
 * controller. Reproduce that normalization here so the card's own query shape
 * is what executes; nothing else about the instruction is rewritten.
 */
function chainKernel(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              // The production matcher (layers/filter.ts) understands the
              // "opponent" selector; the reference kernel compares literally, so
              // the key is dropped here and applied as a filter below.
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-204-221 On the Hunt: program passes validateCardProgram as executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-204-221 On the Hunt: one non-target set instruction and no speed keyword", () => {
  // The printing has no [Action]/[Reaction] line, so spells default to Action
  // timing (159.2.a) and the program declares no keyword ability.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);

  assert.equal(readyUnits.id, "on-the-hunt.ready-units");
  assert.equal(readyUnits.op, "effect.ready");
  // 355.10.d / 355.10.g: "your units" is a programmatic set of the ability
  // controller's Board units, never a target or pick. No TargetSpec may stand
  // in for it (that would wrongly fire "becomes a target", 355.7 / 754).
  assert.equal(readyUnits.targets, undefined);
  assert.equal(readyUnits.picks, undefined);
  assert.equal(readyUnits.linkedTo, undefined);
  assert.equal(readyUnits.condition, undefined);
  assert.deepEqual(readyUnits.args, {
    objects: {
      kind: "constant",
      value: {
        kind: "query",
        filter: { type: "unit", zone: "board", controller: "self" }
      }
    },
    linkKey: { kind: "constant", value: "readied" }
  });
  // The declared primitive really is the merged registry entry.
  assert.equal(instructionDefinitionsById.get("effect.ready"), ready);
});

test("sfd-204-221 On the Hunt golden: the controller's exhausted units ready, others do not", () => {
  const kernel = world()
    .unit("friendly-exhausted", { owner: "A", controller: "A", exhausted: true })
    .unit("friendly-ready", { owner: "A", controller: "A", exhausted: false })
    .unit("enemy-exhausted", { owner: "B", controller: "B", exhausted: true })
    .build();

  const outcome = resolveChainBody(play.body, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["on-the-hunt.ready-units", "executed"]]
  );
  // 416.1.b / 416.1.c: an already-ready object is not readied again and produces
  // no event, so only the exhausted friendly unit is reported and only one ready
  // action is submitted.
  assert.deepEqual(outcome.linkedValues["on-the-hunt.ready-units.readied"], {
    count: 1,
    objects: [{ id: "friendly-exhausted", zoneEntryId: 1 }]
  });
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready"]);
  assert.equal(kernel.getObject("friendly-exhausted").exhausted, false);
  assert.equal(kernel.getObject("friendly-ready").exhausted, false);
  // "your units" is the ability controller's set: the opponent is untouched.
  assert.equal(kernel.getObject("enemy-exhausted").exhausted, true);
});

test("sfd-204-221 On the Hunt golden: an all-ready board readies nothing but still executes", () => {
  const kernel = world()
    .unit("friendly-ready", { owner: "A", controller: "A", exhausted: false })
    .build();

  const outcome = resolveChainBody(play.body, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["on-the-hunt.ready-units.readied"], { count: 0, objects: [] });
  assert.deepEqual(outcome.events, []);
});

test("sfd-204-221 On the Hunt golden: an empty set is not a mistarget", () => {
  // A set query with no members is not a lost target (contract 3.4: targets are
  // the only thing whose disappearance ignores an instruction), so the card
  // resolves with an empty receipt instead of being ignored.
  const kernel = world().unit("enemy-only", { owner: "B", controller: "B", exhausted: true }).build();

  const outcome = resolveChainBody(play.body, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => entry.result),
    [{ status: "executed", events: [], linkedValues: { readied: { count: 0, objects: [] } } }]
  );
  assert.equal(kernel.getObject("enemy-only").exhausted, true);
});

test("sfd-204-221 On the Hunt golden: a prevented ready negates the instruction without approximating", () => {
  const kernel = world()
    .unit("friendly-exhausted", { owner: "A", controller: "A", exhausted: true })
    .build();
  kernel.addReplacement((action) => (action.type === "ready" ? "prevented" : null));

  const outcome = resolveChainBody(play.body, chainKernel(kernel));

  // Contract 3.6 primitive rule 2 / 3.4: a replaced/prevented action negates the
  // instruction instead of claiming a ready that never happened.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["on-the-hunt.ready-units", "negated", "impossible"]]
  );
  assert.equal(kernel.getObject("friendly-exhausted").exhausted, true);
});

test("sfd-204-221 On the Hunt golden: the set query readies through the merged primitive", () => {
  // runInstruction clones the world, so the chain's controller normalization is
  // not re-applied inside the clone; hand the primitive the concrete controller
  // the chain produces from the card's "self" placeholder. The instruction
  // shape itself is asserted above, and the placeholder path is exercised by
  // the resolveChainBody goldens.
  const kernel = world()
    .unit("friendly-exhausted", { owner: "A", controller: "A", exhausted: true })
    .unit("enemy-exhausted", { owner: "B", controller: "B", exhausted: true })
    .build();
  const run = runInstruction(
    ready,
    {
      objects: {
        kind: "constant",
        value: { kind: "query", filter: { type: "unit", zone: "board", controller: "A" } }
      },
      linkKey: readyUnits.args.linkKey
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.readied, {
    count: 1,
    objects: [{ id: "friendly-exhausted", zoneEntryId: 1 }]
  });
  assert.deepEqual(run.events.map((event) => event.action), ["ready"]);
  assert.equal(kernel.getObject("friendly-exhausted").exhausted, false);
  assert.equal(kernel.getObject("enemy-exhausted").exhausted, true);
});
