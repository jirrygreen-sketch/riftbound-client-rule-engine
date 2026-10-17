import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/deadly-flourish.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import tokenPrimitive from "../../../../engine-core/dist/effects/instructions/effect.token.js";

const CANONICAL_ID =
  "card.hash-8d3c943cc6d7e5b38e8f84d12956e763e4a25f10bf52c0950221efe9a6381132";
const SOURCE_TEXT =
  "Deal 3 to an enemy unit. When it dies this turn, play a Gold gear token exhausted. " +
  "(It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")";

const [play] = program.abilities;
const [dealThree, delayed] = play.body;
const [playGold] = delayed.args.body.value;

test("unl-073-219 Deadly Flourish: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-073-219 Deadly Flourish: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /Unregistered instruction opcode/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /185\.2\.d|184\.1/);
  assert.match(program.judgeReason, /Invalid effect\.token argument: entersExhausted/);
  assert.match(program.judgeReason, /negated\/impossible/);
});

test("unl-073-219 Deadly Flourish: Deal 3 target plus the delayed Gold-token clause shape", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["deadly-flourish.deal-3", "effect.damage"],
      ["deadly-flourish.delayed-gold", "trigger.delayed"]
    ]
  );

  // 355.7 / 355.9.a.1: "an enemy unit" is a single chosen target.
  assert.deepEqual(dealThree.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(dealThree.targets, [
    {
      id: "deadly-flourish.enemy-unit",
      filter: { zone: "board", type: "unit", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // 390 / 391.2 / 392: a Delayed Triggered Ability with the object-killed
  // subscription, "it" bound to this card's own damage target (359.3.f.3) and
  // the 317.2.c this-turn window; the registering opcode is not merged.
  assert.equal(delayed.op, "trigger.delayed");
  assert.deepEqual(delayed.args.at, { kind: "constant", value: "object-killed" });
  assert.deepEqual(delayed.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(delayed.args.filter, {
    kind: "constant",
    value: {
      event: "object-killed",
      object: { target: "deadly-flourish.enemy-unit" }
    }
  });
  // The delayed trigger is a separate printed sentence: it is not chained to
  // the damage instruction with linkedTo (359.3.e.14 only covers instructions
  // that reference a prior instruction's result).
  assert.equal(delayed.linkedTo, undefined);

  // 187.5 Gold gear token; 440.2.c / 185.2.a chain-created then played;
  // 184.1 / 185.2.d printed exhausted entry state.
  assert.equal(playGold.op, "effect.token");
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
});

test("unl-073-219 Deadly Flourish golden: Deal 3 to the chosen enemy unit", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", might: 4 })
    .unit("other-enemy", { owner: "B", might: 4 })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealThree.args.amount, target: dealThree.args.target.value },
    { world: kernel, targets: { "deadly-flourish.enemy-unit": [kernel.ref("enemy-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 3);
  assert.equal(kernel.getObject("enemy-unit").damage, 3);
  assert.equal(kernel.getObject("other-enemy").damage, 0);
});

test("unl-073-219 Deadly Flourish golden: a stale target ignores the damage clause (359.3.e.6)", () => {
  const kernel = world().unit("enemy-unit", { owner: "B" }).build();
  const stale = kernel.ref("enemy-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealThree.args.amount, target: dealThree.args.target.value },
    { world: kernel, targets: { "deadly-flourish.enemy-unit": [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("unl-073-219 Deadly Flourish golden: the printed damage clause runs through the production interpreter", () => {
  // The damage clause and interpreter are merged, so this golden executes the
  // printed damage body through the production adapter.
  assert.equal(instructionDefinitionsById.has("effect.damage"), true);
  const kernel = world().unit("enemy-unit", { owner: "B", might: 4 }).build();
  const outcome = resolveChainBody(
    [
      {
        id: "deadly-flourish.deal-3",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 3 },
          target: { kind: "constant", value: "deadly-flourish.enemy-unit" }
        }
      }
    ],
    (() => {
      const context = kernel.clone({ source: kernel.ref("enemy-unit"), sourceSnapshot: kernel.getObject("enemy-unit") });
      context.setTargets("deadly-flourish.enemy-unit", [kernel.ref("enemy-unit")]);
      return context;
    })()
  );
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.dealt, 3);
});

test("unl-073-219 Deadly Flourish golden: the merged token primitive accepts the ability-free definitions the clause can use", () => {
  // effect.token is the merged creation path for the printed token clause. The
  // golden executes it with a supported ability-free definition; this card's
  // remaining gap is the Gold definition and exhausted entry override.
  const kernel = world().player("A").build();
  const run = runInstruction(
    tokenPrimitive,
    {
      token: { kind: "constant", value: "recruit" },
      amount: { kind: "constant", value: 1 },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "created" }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["created.amount"], 1);
  assert.deepEqual(run.linked["created.objects"], [{ id: "token-1", zoneEntryId: 1 }]);
  assert.equal(run.linked.created.objectsComplete, true);
  assert.equal(kernel.objects.some((object) => object.types.includes("unit")), true);
});

test("unl-073-219 Deadly Flourish: the delayed clause fails closed on its unbound it anchor", () => {
  // 390/391.2/392: the merged trigger.delayed op registers card-declared
  // delayed abilities, but this card's filter anchors "it" with an embedded
  // target selector that the frozen TriggerSpec schema does not describe. The
  // op fails closed (negated/impossible) instead of registering a wrong
  // trigger; the Gold definition and exhausted entry override remain gaps.
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), true);
  const kernel = world().player("A").unit("victim", { owner: "B", might: 5 }).build();
  const context = kernel.clone({ source: kernel.ref("victim"), sourceSnapshot: kernel.getObject("victim"), controller: "A" });
  context.setTargets("deadly-flourish.enemy-unit", [context.ref("victim")]);
  const fullBody = play.body.map(({ targets, ...instruction }) => instruction);
  const outcome = resolveChainBody(fullBody, context);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["deadly-flourish.deal-3", "executed", null],
      ["deadly-flourish.delayed-gold", "negated", "impossible"]
    ]
  );
  assert.equal(outcome.status, "partial");
  assert.equal(context.getObject("victim").damage, 3);
});

test("unl-073-219 Deadly Flourish: the Gold gear token is not in the merged token definition table", () => {
  // 187.5: Gold carries its own "[Reaction][>] Kill this, [E]: [Add] [A]"
  // ability, so effect.token deliberately excludes it. The primitive must
  // return negated/impossible rather than inventing an ability-free token.
  const kernel = world().player("A").build();
  const context = kernel.clone({ source: kernel.getObject("A:deck:1"), controller: "A" });
  const outcome = resolveChainBody(
    [{
      id: "play-gold",
      op: "effect.token",
      args: {
        token: { kind: "constant", value: "gold" },
        amount: { kind: "constant", value: 1 },
        mode: { kind: "constant", value: "play" },
        location: { kind: "constant", value: { type: "base", player: "A" } }
      }
    }],
    context
  );
  assert.deepEqual(
    outcome.results.map((entry) => [entry.result.status, entry.result.reason ?? null]),
    [["negated", "impossible"]]
  );
  assert.deepEqual(kernel.objectsInZone("A", "board"), []);
});

test("unl-073-219 Deadly Flourish: create-token rejects the 'exhausted' entry override", () => {
  // 143.4 / 184.1 / 185.2.d: entering exhausted is an entry stipulation. The
  // merged argsSchema has no override field, so the shape fails closed instead
  // of being approximated by a later effect.exhaust (a wrong became-exhausted
  // event).
  assert.throws(
    () => tokenPrimitive.argsSchema.parse({
      token: { kind: "constant", value: "recruit" },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      entersExhausted: { kind: "constant", value: true }
    }),
    (error) => /Invalid effect\.token argument: entersExhausted/.test(error.message)
  );
});
