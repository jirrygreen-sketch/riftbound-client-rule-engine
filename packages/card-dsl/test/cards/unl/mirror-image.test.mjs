import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mirror-image.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import copy from "../../../../engine-core/dist/effects/instructions/effect.copy.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-1624e5bc418da476f531d04662765fc6e20f06c4b970aa940a696af64789318b";
const SOURCE_TEXT =
  "Choose a unit. Play a ready Reflection unit token to your base. It becomes a copy of that unit. " +
  "Give it [Temporary]. (Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [play] = program.abilities;
const [playReflection, copyUnit, grantTemporary] = play.body;

test("unl-200-219 Mirror Image: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-200-219 Mirror Image: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The remaining gaps are the Copy layer, Temporary expansion, and ready
  // entry override.
  assert.match(program.judgeReason, /446\.1/);
  assert.match(program.judgeReason, /479\.1/);
  assert.match(program.judgeReason, /copy-layer-traits-exceptions-and-attachment-duration-unavailable/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /143\.4/);
});

test("unl-200-219 Mirror Image: one play ability with the token, the copy and the keyword grant in printed order", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // No printed [Action]/[Reaction] line: spells default to Action timing
  // (159.2.a), so no speed keyword is declared.
  assert.equal(program.abilities.some((ability) => ability.kind === "keyword"), false);
  assert.equal(play.cost, undefined);
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["mirror-image.play-reflection", "mirror-image.copy-unit", "mirror-image.grant-temporary"]
  );
});

test("unl-200-219 Mirror Image: the Reflection token is played to the controller's base", () => {
  // 187.6: Reflection is a 0-Might domainless unit token, and the merged
  // effect.token definition table carries "reflection". "Play" goes through
  // the chain-creation + play handoff (440.2.c / 185.2.a); "to your base" is a
  // legal default destination (355.2.a).
  assert.equal(playReflection.op, "effect.token");
  assert.deepEqual(playReflection.args.token, { kind: "constant", value: "reflection" });
  assert.deepEqual(playReflection.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playReflection.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playReflection.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playReflection.args.linkKey, { kind: "constant", value: "reflectionToken" });
  // The printed "ready" is an entry-state override (184.1); it must not be
  // approximated with a later ready action, and no invented argument key is
  // added for it.
  assert.equal(playReflection.args.entersReady, undefined);
  assert.equal(playReflection.args.exhausted, undefined);
  assert.equal(playReflection.targets, undefined);
});

test("unl-200-219 Mirror Image: the copy reads the chosen unit and targets the new token; the grant is linked", () => {
  // "Choose a unit" is a specific choice, so the unit is a target
  // (355.5 / 355.10 example); "It becomes a copy of that unit" uses the Copy
  // layer (446.1/446.2, 479.1) whose merged effect mode is blocked.
  assert.equal(copyUnit.op, "effect.copy");
  assert.equal(copyUnit.linkedTo, "mirror-image.play-reflection");
  assert.deepEqual(copyUnit.args.source, {
    kind: "constant",
    value: { target: "mirror-image.unit" }
  });
  assert.deepEqual(copyUnit.args.mode, { kind: "constant", value: "effect" });
  // "It" is the token created by the previous instruction. Contract 3.6's
  // ObjectSelector has no receipt-field form, so the symbolic {linked: id}
  // selector names that instruction (124 makes the created object a new
  // identity; no identity is guessed or synthesized).
  assert.deepEqual(copyUnit.args.onto, {
    kind: "constant",
    value: { linked: "mirror-image.play-reflection" }
  });
  assert.deepEqual(copyUnit.args.duration, { kind: "constant", value: "permanent" });
  assert.deepEqual(copyUnit.targets, [
    {
      id: "mirror-image.unit",
      filter: { type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "Give it [Temporary]" (816) is a keyword grant with a duration; the
  // consumer is the judged layer gap.
  assert.equal(grantTemporary.op, "continuous.grant-keyword");
  assert.equal(grantTemporary.linkedTo, "mirror-image.copy-unit");
  assert.deepEqual(grantTemporary.args.keyword, { kind: "constant", value: "Temporary" });
  assert.deepEqual(grantTemporary.args.duration, { kind: "constant", value: "permanent" });
  assert.deepEqual(grantTemporary.args.objects, {
    kind: "constant",
    value: { linked: "mirror-image.play-reflection" }
  });
  assert.equal(grantTemporary.targets, undefined);
});

test("unl-200-219 Mirror Image golden: the Reflection token really reaches the controller's base", () => {
  const kernel = world().player("A").build();
  const run = runInstruction(
    token,
    {
      token: playReflection.args.token,
      amount: playReflection.args.amount,
      mode: playReflection.args.mode,
      // "your base" resolves to the controller's base during production
      // finalization; the reference kernel resolves bases by player id.
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: playReflection.args.linkKey
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["reflectionToken.amount"], 1);
  const created = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.length, 1);
  // 187.6 the printed definition: a 0-Might, domainless Reflection unit token.
  assert.equal(created[0].name, "Reflection");
  assert.equal(created[0].might, 0);
  assert.deepEqual(created[0].tags, []);
  assert.deepEqual(created[0].location, { type: "base", player: "A" });
  assert.equal(created[0].controller, "A");
  assert.equal(created[0].owner, "A");
  // 185.3.a.1: tokens have no costs; "cost 0" is not printed on them.
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play"]);
});

test("unl-200-219 Mirror Image golden: the linked copy reference names the created token, and effect.copy's effect mode is blocked", () => {
  const kernel = world()
    .unit("mirror-target", { owner: "B", might: 4 })
    .build();
  const tokenRun = runInstruction(
    token,
    {
      token: playReflection.args.token,
      amount: playReflection.args.amount,
      mode: playReflection.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: playReflection.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(tokenRun.result.status, "executed");
  const createdRef = tokenRun.linked["reflectionToken.objects"][0];
  assert.equal(createdRef.id, kernel.query({ zone: "board" }).find((object) => object.isToken).ref.id);

  const copyRun = runInstruction(
    copy,
    {
      source: copyUnit.args.source,
      mode: copyUnit.args.mode,
      onto: copyUnit.args.onto
    },
    {
      world: kernel,
      targets: { "mirror-image.unit": [kernel.ref("mirror-target")] },
      // The {linked: id} selector reads the instruction's captured result, so
      // the harness supplies that receipt under the instruction id.
      linked: { "mirror-image.play-reflection": [createdRef] }
    }
  );

  // 446 / 479.1: the merged copy primitive cannot transform an existing object,
  // and it reports that as a blocked receipt instead of creating a new object.
  assert.deepEqual(copyRun.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(
    copyRun.linked.copied.blockedReason,
    "copy-layer-traits-exceptions-and-attachment-duration-unavailable"
  );
  assert.equal(copyRun.linked.copied.amount, 0);
  // No substitute object was created: the Board still holds only the original
  // unit and the Reflection token.
  assert.deepEqual(
    kernel.query({ zone: "board" }).map((object) => object.ref.id).sort(),
    ["mirror-target", createdRef.id].sort()
  );
});

test("unl-200-219 Mirror Image golden: the token half runs for real and the blocked copy submits no substitute", () => {
  // This scenario drives the merged token step and the explicitly blocked copy
  // step through the real interpreter.
  const kernel = world().unit("mirror-target", { owner: "B", might: 4 }).build();
  kernel.setTargets("mirror-image.unit", [kernel.ref("mirror-target")]);
  const { targets: _omittedPlaySpec, ...playWithoutSpec } = playReflection;
  const { targets: _omittedCopySpec, ...copyWithoutSpec } = copyUnit;
  const outcome = resolveChainBody(
    [
      { ...playWithoutSpec, args: { ...playReflection.args, location: { kind: "constant", value: { type: "base", player: "A" } } } },
      copyWithoutSpec
    ],
    kernel
  );

  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["mirror-image.play-reflection", "executed"],
    ["mirror-image.copy-unit", "negated"]
  ]);
  assert.deepEqual(kernel.events.map((event) => event.action), ["create-token", "play"]);
});

test("unl-200-219 Mirror Image golden: Temporary already expands to a real beginning-start kill body", () => {
  const temporary = keywordDefinitionsById.get(grantTemporary.args.keyword.value);
  assert.ok(temporary);
  const [trigger] = temporary.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(trigger.trigger.at, "beginning-start");
  assert.deepEqual(trigger.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(trigger.optional, false);
  const kernel = world().unit("reflection", {
    owner: "B", might: 0, isToken: true, keywords: [{ id: "Temporary" }], energy: null, power: null
  }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("reflection"), controller: "B" });
  const result = resolveChainBody(trigger.body, context);
  assert.equal(result.status, "executed");
  assert.equal(context.getObject("reflection").zone, "trash");
  assert.equal(context.getObject("reflection").energy, null);
  assert.equal(context.getObject("reflection").power, null);
  assert.deepEqual(context.events.map(event => event.action), ["kill"]);
});

test.todo(
  "unl-200-219 Mirror Image: apply \"It becomes a copy of that unit\" through the Copy layer so the created token takes the chosen unit's copyable printed traits without a new object (CR 446.1/446.2/446.3, 479.1.a-479.1.d; effect.copy's effect mode and the layers copy work are still blocked)"
);
test.todo(
  "unl-200-219 Mirror Image: refresh a newly granted Temporary's beginning-start subscription before scoring (CR 816.1.b/816.1.c, 816.2.a; KeywordDef and general trigger binding exist, dynamic grant lifecycle is missing)"
);
test.todo(
  "unl-200-219 Mirror Image: let the played token enter ready as an entry-state override (CR 143.4/184.1/185.2.d; create-token supports no entry state, and a later ready action would emit a wrong becomes-ready event - token entry work)"
);
