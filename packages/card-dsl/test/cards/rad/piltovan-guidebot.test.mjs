import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/piltovan-guidebot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { registryById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-615e60700f249a984f869bffcbf2ce12e1b4090a85115e2a97fc5432e1df1fc0";
const SOURCE_TEXT =
  "When you play a card, you may have my base Might become equal to that card's Energy cost this turn.";

const [triggered] = program.abilities;
const [optional] = triggered.body;
const [setBaseMight] = optional.args.body.value;

test("rad-057-167 Piltovan Guidebot: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-057-167 Piltovan Guidebot: identity, ruleset, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Base Might/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /Energy cost/);
  assert.equal(program.judgeReason.includes("trait 层"), true);
  assert.equal(program.judgeReason.includes("RIFT-120"), false);
  // The card-played registration path is merged; the reason must say so and
  // must name the two real remaining gaps instead of merged-task numbers.
  assert.equal(program.judgeReason.includes("card-played 触发注册路径已合入"), true);
  assert.match(program.judgeReason, /continuous\.base-might/);
  assert.match(program.judgeReason, /appliesTo self/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-057-167 Piltovan Guidebot: 'when you play a card' subscribes card-played for the controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  // "打出任意一张牌"都触发：不加 self 过滤，只限定玩家（能力控制者）。
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { player: "controller" }
  });
  // 触发本身是强制的；"you may" 由 choice.optional 承担（契约 3.9）。
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
});

test("rad-057-167 Piltovan Guidebot: 'you may' wraps the base-Might set in a choice.optional body (contract 3.9)", () => {
  assert.equal(optional.id, "piltovan-guidebot.may-set-base-might");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(
    optional.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [["piltovan-guidebot.set-base-might", "continuous.base-might"]]
  );
  // 契约 3.9：不要写成 choice + 后续指令 linkedTo。
  assert.equal(optional.linkedTo, undefined);
  assert.equal(setBaseMight.linkedTo, undefined);
});

test("rad-057-167 Piltovan Guidebot: the base-Might set is authored as a trait-layer set with end-of-turn duration", () => {
  assert.deepEqual(setBaseMight.args.mode, { kind: "constant", value: "set" });
  // CR 143.2.a："Its base Might becomes 5 this turn" 是 Trait-Altering 层的设值。
  assert.deepEqual(setBaseMight.args.layer, { kind: "constant", value: "trait" });
  assert.deepEqual(setBaseMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(setBaseMight.args.source, { kind: "constant", value: "played-card-energy-cost" });
  // 2026-10-17 IR rewrite: "me" is the ability host, so the instruction uses the
  // contract's canonical appliesTo "self" binding. The previous hand-made target
  // ({ type: "unit", object: "self" }) is rejected by the production target
  // translator, and chain Finalize refuses nested target surfaces.
  assert.deepEqual(setBaseMight.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(setBaseMight.targets, undefined);
});

test("rad-057-167 Piltovan Guidebot: the authored trigger filter really binds in the production translator (420.4.a)", () => {
  // The merged card-played adapter must subscribe the controller's plays and
  // must not treat this as an ability on the played card.
  assert.deepEqual(translateTriggerFilter(triggered.trigger.filter, "guidebot", triggered.trigger.at), {
    event: "card-played",
    player: "self"
  });

  const source = {
    ref: { id: "guidebot", zoneEntryId: 1 },
    cardId: CANONICAL,
    name: "Piltovan Guidebot",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 3,
    energy: 4,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const registered = [];
  const ids = binding.registerProgramTriggers(
    { pipeline: { registerTrigger: registration => registered.push(registration), unregisterTrigger: () => {} } },
    source
  );
  assert.deepEqual(ids, ["program:guidebot:1:0"]);
  assert.deepEqual(registered[0].spec.filter, { event: "card-played", player: "self" });
  // 420.4.a: \"When you play a card\" is the controller's trigger on any play.
  assert.equal(registered[0].spec.at, "card-played");
});

test("rad-057-167 Piltovan Guidebot: neither the trait-layer op nor a keyword-value set-might is merged", () => {
  // (1) The merged continuous.might really is arithmetic-only (478.1.a): it
  // rejects a trait-layer declaration, so the printed base-Might set has no op.
  assert.equal(registryById.has("continuous.base-might"), false);
  const continuousMight = registryById.get("continuous.might");
  assert.ok(continuousMight);
  assert.throws(
    () => continuousMight.argsSchema.parse({
      mode: "set", layer: "trait", appliesTo: "self",
      amount: { kind: "constant", value: 5 }
    }),
    /Invalid continuous\.might argument: layer/
  );
  // The arithmetic spelling that *is* accepted registers inside applyArithmetic,
  // not the Trait-Altering layer (CR 143.2.a / 475).
  const accepted = continuousMight.argsSchema.parse({ mode: "set", appliesTo: "self", amount: { kind: "constant", value: 5 } });
  assert.equal(accepted.mode, "set");
  assert.equal(Object.hasOwn(accepted, "layer"), false);
});

test("rad-057-167 Piltovan Guidebot: 'that card's Energy cost' still has no event-object read path (420.4.a)", () => {
  // The instruction's own op is unregistered, and the trigger's object
  // selector vocabulary (self/source/target/pick/linked) has no member that
  // reaches the played card carried by the card-played event.
  assert.equal(registryById.has(setBaseMight.op), false);
  assert.deepEqual(setBaseMight.args.source, { kind: "constant", value: "played-card-energy-cost" });
  const selectors = ["self", "source"];
  assert.equal(selectors.includes(setBaseMight.args.source.value), false,
    "a real selector would reach the played card, but the descriptor string does not");
  // Structurally the body cannot even be bound: the nested body is a literal
  // array whose instructions carry no targets, so binding succeeds but the only
  // object it affects is the ability host. The printed "that card's Energy
  // cost" read therefore has to come from the event payload (420.4.a).
  const base = world().unit("guidebot", { types: ["unit"] }).build();
  const source = base.getObject("guidebot");
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const ids = binding.registerProgramTriggers(
    { pipeline: { registerTrigger: () => {}, unregisterTrigger: () => {} } },
    { ...source, cardId: CANONICAL, name: "Piltovan Guidebot" }
  );
  assert.equal(ids.length, 1, "the trigger itself binds; the gap is the event-object read, not registration");
  assert.equal(Object.hasOwn(setBaseMight.args, "event"), false,
    "no merged argument reads the triggering event object");
});

test.todo(
  "rad-057-167 Piltovan Guidebot: set the Base Might in the trait-altering layer (CR 143.2.a/475-478) — the merged " +
    "continuous.might only offers the arithmetic layer (mode set -> set-might inside applyArithmetic), so a trait-layer " +
    "set primitive is still unregistered (no continuous.base-might op; layer: \"trait\" is rejected by the argsSchema)"
);

test.todo(
  "rad-057-167 Piltovan Guidebot: read 'that card's Energy cost' from the triggering card-played event — the " +
    "ResolveContext has no trigger-event object selector and no expression reads another object's printed cost"
);

test.todo(
  "rad-057-167 Piltovan Guidebot: consume the card-played trigger's event object in the real flow (CR 420.4.a)"
);
