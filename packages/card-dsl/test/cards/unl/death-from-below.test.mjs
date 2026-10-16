import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/death-from-below.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-332b81818b3c3740ca27663743bcff94806548a92b2601eea3956bec3778f6ac";
const SOURCE_TEXT =
  "Kill a unit at a battlefield. Then, if it had 3 :rb_might: or less, you may " +
  "play this from your trash for :rb_rune_rainbow:.";

const [playAbility] = program.abilities;
const [killInstruction, mayPlayFromTrash] = playAbility.body;
const [optionalPlay] = mayPlayFromTrash.args.body.value;
const [playFromTrash] = optionalPlay.args.body.value;
const trashTargetSpec = playFromTrash.targets[0];

// The reference kernel compares filter values literally, so both the kill
// target and the nested Trash self-reference are locked by the harness
// (production locks them through the target pipeline, which the structural
// assertions above cover). The strip therefore walks control bodies too.
function withoutTargetSpecs(body) {
  return body.map(({ targets, args, ...instruction }) => ({
    ...instruction,
    args: Object.fromEntries(
      Object.entries(args).map(([key, expression]) => {
        if (key === "body" && expression.kind === "constant" && Array.isArray(expression.value)) {
          return [key, { ...expression, value: withoutTargetSpecs(expression.value) }];
        }
        return [key, expression];
      })
    )
  }));
}
const bodyWithoutTargetSpecs = withoutTargetSpecs(playAbility.body);

test("unl-186-219 Death from Below: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-186-219 Death from Below: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The reason cites the official reflexive-trigger example itself, the missing
  // trash self-reference, the for-cost replacement and the may-scope question.
  assert.match(program.judgeReason, /388\.4/);
  assert.match(program.judgeReason, /389/);
  assert.match(program.judgeReason, /356\.1\.a/);
  assert.match(program.judgeReason, /FinalizedCostPlan/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("unl-186-219 Death from Below: one targeted battlefield kill plus a guarded, optional trash play", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playAbility.kind, "play");
  // Printed cost (4 Energy + 1 Power) is bound from the card identity at
  // Finalize, so the program declares no CostSpec.
  assert.equal(playAbility.cost, undefined);
  assert.deepEqual(
    playAbility.body.map((instruction) => instruction.id),
    ["death-from-below.kill", "death-from-below.may-play-from-trash"]
  );

  // The kill is an Active Kill (429.1.a.1.a / 429.6); the unit is the target and
  // at-a-battlefield only restricts legality (355.9.a.1 / 355.10.b).
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, {
    kind: "constant",
    value: "death-from-below.battlefield-unit"
  });
  assert.deepEqual(killInstruction.targets[0], {
    id: "death-from-below.battlefield-unit",
    filter: { type: "unit", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(killInstruction.linkedTo, undefined);
});

test("unl-186-219 Death from Below: the Might gate reads the killed unit's last known information", () => {
  // 359.3.e.12-359.3.e.13: the referent reads the killed unit's last known
  // information, so the condition anchors on the kill instruction's linked set.
  assert.equal(mayPlayFromTrash.op, "sequence");
  assert.equal(mayPlayFromTrash.linkedTo, undefined);
  assert.deepEqual(mayPlayFromTrash.condition, {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { linked: "death-from-below.kill" },
      property: "might"
    },
    operator: "lte",
    right: { kind: "constant", value: 3 }
  });

  // The may is the contract-3.9 choice.optional wrapper around the chosen
  // instruction, and the for-rainbow-rune cost is a descriptor (356.1.a).
  assert.equal(optionalPlay.op, "choice.optional");
  assert.equal(optionalPlay.linkedTo, undefined);
  assert.equal(playFromTrash.op, "effect.play");
  assert.equal(playFromTrash.linkedTo, undefined);
  assert.deepEqual(playFromTrash.args.cost, {
    kind: "constant",
    value: {
      kind: "cost.modify",
      base: "printed",
      replace: { power: ["rainbow"] },
      finalized: false
    }
  });
  assert.equal(playFromTrash.args.cost.value.energy, undefined);
  // The card itself is the Trash reference (the judged self-in-zone gap).
  assert.deepEqual(trashTargetSpec, {
    id: "death-from-below.self-in-trash",
    filter: { source: "self", zone: "trash" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-186-219 Death from Below golden: effect.kill sends the battlefield unit to the trash and links it", () => {
  const kernel = world()
    .unit("bf-unit", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .base("base-unit", { owner: "B", might: 2 })
    .build();
  const run = runInstruction(
    kill,
    { target: "death-from-below.battlefield-unit" },
    { world: kernel, targets: { "death-from-below.battlefield-unit": [kernel.ref("bf-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("bf-unit").zone, "trash");
  assert.equal(kernel.getObject("base-unit").zone, "board");
  assert.deepEqual(run.linked.killed.map((ref) => ref.id), ["bf-unit"]);
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
});

test("unl-186-219 Death from Below golden: a 2-Might victim passes the gate, and the trash play then fails closed", () => {
  // The whole body runs through the real interpreter. The kill moved the unit
  // to Trash, so the gate reads its last known Might (359.3.e.13) and passes;
  // the optional play itself fails closed because no finalized
  // replacement-cost plan exists (judgeReason point 3).
  const kernel = world()
    .unit("bf-unit", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const ctx = kernel.clone();
  ctx.setTargets("death-from-below.battlefield-unit", [ctx.ref("bf-unit")]);
  // Choice request ids are the URI-encoded execution path (interpreter
  // README), so the nested optional request is scoped by its containers.
  ctx.setAnswers({
    "death-from-below.may-play-from-trash/death-from-below.optional-play/optional": true
  });

  // resolveChainBody is the production entry point: it re-wraps each
  // instruction's Expr arguments so the registered primitives validate and
  // evaluate them exactly as the engine does (runAbilityBody would pre-evaluate
  // the cost descriptor and fail schema validation).
  const outcome = resolveChainBody(bodyWithoutTargetSpecs, ctx);

  assert.equal(ctx.getObject("bf-unit").zone, "trash");
  const killResult = outcome.results.find((result) => result.id === "death-from-below.kill");
  assert.equal(killResult.result.status, "executed");
  // The gate passed (the optional instruction ran instead of being skipped) and
  // the play instruction is the one that fails.
  assert.equal(
    outcome.results.some((result) => result.id === "death-from-below.play-from-trash"),
    true
  );
  const playResult = outcome.results.find((result) => result.id === "death-from-below.play-from-trash");
  assert.equal(playResult.result.status, "negated");
  assert.equal(ctx.getObject("bf-unit").zone, "trash");
});

test("unl-186-219 Death from Below golden: a 4-Might victim fails the gate so the trash play is skipped", () => {
  const kernel = world()
    .unit("big-unit", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const ctx = kernel.clone();
  ctx.setTargets("death-from-below.battlefield-unit", [ctx.ref("big-unit")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, ctx);

  assert.equal(ctx.getObject("big-unit").zone, "trash");
  const branch = outcome.results.find((result) => result.id === "death-from-below.may-play-from-trash");
  assert.equal(branch.result.status, "negated");
  assert.equal(branch.result.reason, "skipped");
  assert.equal(
    outcome.results.some((result) => result.id === "death-from-below.play-from-trash"),
    false,
    "the guarded branch must not run its body"
  );
});

test("unl-186-219 Death from Below golden: the printed for-rainbow-rune cost is never rewritten to energy 0", () => {
  // Red line: energy: null / power: null mean no printed value and are not 0;
  // the replacement-cost descriptor must not materialize a chargeable plan.
  assert.equal(playFromTrash.args.cost.value.finalized, false);
  assert.equal(playFromTrash.args.cost.value.energy, undefined);
  const kernel = world()
    .object("death-from-below", {
      zone: "trash",
      types: ["spell"],
      owner: "A",
      controller: "A",
      energy: 4,
      power: ["Fury"]
    })
    .build();
  const run = runInstruction(
    play,
    {
      target: "death-from-below.self-in-trash",
      cost: playFromTrash.args.cost
    },
    { world: kernel, targets: { "death-from-below.self-in-trash": [kernel.ref("death-from-below")] } }
  );
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("death-from-below").zone, "trash");
});

test.todo(
  "unl-186-219 Death from Below: add the reflexive triggered ability to the chain as its own pending item when the condition holds (CR 388 / 388.4 - this card is the official example - and 389 / 389.1; the six Ability forms cannot add a chain item at resolution)"
);
test.todo(
  "unl-186-219 Death from Below: resolve this as the card's current reference in Trash after it changed zones (CR 124 / 420.3; ObjectSelector has no self-in-zone form - engine batch 4 source/link references)"
);
test.todo(
  "unl-186-219 Death from Below: charge the for-rainbow-rune replacement cost through a finalized cost plan (CR 356.1.a; effect.play requires a FinalizedCostPlan - RIFT-89)"
);
test.todo(
  "unl-186-219 Death from Below: decide the reflexive trigger's may during that trigger's finalization per CR 388.4 instead of an instruction-scoped choice.optional (may-scope ruling)"
);
