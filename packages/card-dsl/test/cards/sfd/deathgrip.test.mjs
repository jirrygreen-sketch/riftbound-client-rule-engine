import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/deathgrip.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-1f41363528139c43d205b49bf3880604480befbe9f8d033db61f0618cecdf389";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Kill a friendly unit to give +:rb_might: equal to its Might to another friendly unit this turn. Draw 1.";

const [, play] = program.abilities;
const killInstruction = play.body[0];
const readInstruction = play.body[1];
const mightInstruction = play.body[2];
const drawInstruction = play.body[3];

/** The resolving effect's own registrations, shaped for the real layer engine. */
const registrations = (kernel) =>
  kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

/**
 * The reference kernel compares filter values literally, while the card layer
 * spells "friendly" as controller: "self" and the chain's query path
 * (chain/engine.ts) normalizes self/opponent against the ability controller.
 * Reproduce that normalization so the card's own filter shape executes
 * (same convention as the merged sfd/on-the-hunt golden).
 */
function chainKernel(kernel, controller = "A") {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") kernelFilter[playerKey] = controller;
            else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-163-221 Deathgrip: program is valid EffectIR v2 data and executable", () => {
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

test("sfd-163-221 Deathgrip structure: [Reaction], kill pick, linked Might read/grant, unlinked draw", () => {
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["deathgrip.kill", "effect.kill"],
      ["deathgrip.read-killed-might", "condition.value"],
      ["deathgrip.grant-might", "continuous.might"],
      ["deathgrip.draw", "effect.draw"]
    ]
  );

  // "Kill a friendly unit to ...": a cost inside the instruction
  // (355.10.c.1), so the killed unit is a non-target pick.
  assert.equal(killInstruction.targets, undefined);
  assert.deepEqual(killInstruction.args.picks, { kind: "constant", value: "deathgrip.fodder" });
  assert.equal(killInstruction.picks.length, 1);
  const [fodder] = killInstruction.picks;
  assert.equal(fodder.id, "deathgrip.fodder");
  assert.equal(fodder.selection, "one");
  assert.equal(fodder.min, 1);
  assert.equal(fodder.max, 1);
  assert.deepEqual(fodder.filter, { type: "unit", controller: "self" });

  // "... equal to its Might": the last-known Might of the killed unit is read
  // through the kill's linked `killed` reference (359.3.e.13) into a named
  // linked value, so the grant can consume it as an Expr.
  assert.equal(readInstruction.linkedTo, "deathgrip.kill");
  assert.deepEqual(readInstruction.args.value, {
    kind: "object-property",
    object: { linked: "deathgrip.kill" },
    property: "might"
  });
  assert.deepEqual(readInstruction.args.key, { kind: "constant", value: "killedMight" });

  // "give +[M] ... to another friendly unit this turn": a temporary Might
  // modification registered by the merged primitive; the granted unit is a
  // target that excludes the fodder pick.
  assert.equal(mightInstruction.linkedTo, "deathgrip.read-killed-might");
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "deathgrip.gifted-unit" }
  });
  assert.deepEqual(mightInstruction.args.amount, {
    kind: "linked-value",
    instructionId: "deathgrip.read-killed-might",
    key: "killedMight"
  });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.targets.length, 1);
  assert.equal(mightInstruction.targets[0].id, "deathgrip.gifted-unit");
  assert.deepEqual(mightInstruction.targets[0].filter, {
    type: "unit",
    controller: "self",
    exclude: { pick: "deathgrip.fodder" }
  });

  // "Draw 1." is a separate sentence and is NOT linked to the Might grant
  // (359.3.e.11: an impossible Might grant still draws).
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.targets, undefined);
});

test("sfd-163-221 Deathgrip golden: kill, look-back amount, Might grant and draw all execute", () => {
  const kernel = world()
    .unit("fodder", { owner: "A", controller: "A", might: 3 })
    .unit("ally", { owner: "A", controller: "A", might: 2 })
    .unit("enemy", { owner: "B", controller: "B", might: 2 })
    .deck("top-card")
    .build();
  kernel.setPicks("deathgrip.fodder", [kernel.ref("fodder")]);
  kernel.setTargets("deathgrip.gifted-unit", [kernel.ref("ally")]);

  const outcome = resolveChainBody(play.body, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["deathgrip.kill", "executed"],
      ["deathgrip.read-killed-might", "executed"],
      ["deathgrip.grant-might", "executed"],
      ["deathgrip.draw", "executed"]
    ]
  );
  // The kill cost happened; the fodder is in its owner's trash.
  assert.equal(kernel.getObject("fodder").zone, "trash");
  // 359.3.e.13: the last-known Might before dying is what was granted.
  assert.equal(outcome.linkedValues["deathgrip.read-killed-might.killedMight"], 3);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.deepEqual(registration.effect.filter.objectId, "ally");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(kernel, "ally"), 5);
  assert.equal(effectiveMight(kernel, "enemy"), 2);
  // The independent draw happened (414.1).
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill", "draw"]);
});

test("sfd-163-221 Deathgrip golden: the granted Might expires at cleanup (317.2.c)", () => {
  const kernel = world()
    .unit("fodder", { owner: "A", might: 3 })
    .unit("ally", { owner: "A", might: 2 })
    .build();
  kernel.setPicks("deathgrip.fodder", [kernel.ref("fodder")]);
  kernel.setTargets("deathgrip.gifted-unit", [kernel.ref("ally")]);
  resolveChainBody(play.body, chainKernel(kernel));

  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 5);
  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 2);
});

test("sfd-163-221 Deathgrip golden: the fodder itself is excluded from the grant (another friendly unit)", () => {
  // The only other friendly unit is the fodder; locking it as the gifted unit
  // fails the exclude anchor, so the grant is ignored while the draw still
  // resolves (359.3.e.11).
  const kernel = world()
    .unit("fodder", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 2 })
    .deck("top-card")
    .build();
  kernel.setPicks("deathgrip.fodder", [kernel.ref("fodder")]);
  kernel.setTargets("deathgrip.gifted-unit", [kernel.ref("fodder")]);

  const outcome = resolveChainBody(play.body, chainKernel(kernel));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["deathgrip.kill", "executed"],
      ["deathgrip.read-killed-might", "executed"],
      ["deathgrip.grant-might", "ignored"],
      ["deathgrip.draw", "executed"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.player("A").handSize, 1);
});

test("sfd-163-221 Deathgrip golden: a stale fodder pick fails the whole linked chain closed", () => {
  // The kill cost cannot be paid: its pick is a stale reference, so the kill
  // is ignored (359.3.e.6) and both linked instructions inherit the ignored
  // result (contract 3.4). Nothing is approximated.
  const kernel = world()
    .unit("fodder", { owner: "A", might: 3 })
    .unit("ally", { owner: "A", might: 2 })
    .build();
  const stale = kernel.ref("fodder");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setPicks("deathgrip.fodder", [stale]);
  kernel.setTargets("deathgrip.gifted-unit", [kernel.ref("ally")]);

  const outcome = resolveChainBody(play.body, chainKernel(kernel));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["deathgrip.kill", "ignored"],
      ["deathgrip.read-killed-might", "ignored"],
      ["deathgrip.grant-might", "ignored"],
      ["deathgrip.draw", "executed"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(effectiveMight(kernel, "ally"), 2);
});

test.todo(
  "sfd-163-221 Deathgrip: [Reaction] admission in a Closed State on another player's turn " +
    "(CR 813.1.b/813.1.c) belongs to the chain's canAct check plus the continuous.timing consumer " +
    "(contract 3.5 / RIFT-91) — a whole-card timing gap, not a card instruction; the card's own " +
    "instructions execute on merged primitives."
);
