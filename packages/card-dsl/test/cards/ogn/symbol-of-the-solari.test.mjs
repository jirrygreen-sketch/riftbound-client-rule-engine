import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/symbol-of-the-solari.js";
import moveDefinition from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { planReplacementBody } from "../../../../engine-core/dist/replacement/index.js";

const [ability] = program.abilities;
const [recall] = ability.with;

function battlefieldWorld() {
  return world()
    .base("symbol-of-the-solari", { types: ["gear"], energy: 1, power: null, might: null })
    .battlefield("attacker", { location: { type: "battlefield", id: "battlefield-1" } })
    .battlefield("defender", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
}

test("symbol-of-the-solari: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("symbol-of-the-solari: identity, ruleset, status, judgeReason and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-a16ac42e7e64f8cc856cd0d66e484b3c448476bae90001b4b613fd8d2a1fddde"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The Recall mode of effect.move is the fail-closed refusal (457-460).
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /457-460/);
  assert.match(program.judgeReason, /BlockedReplacementError/);
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /tie/);
  assert.match(program.judgeReason, /attacker/);
  assert.match(program.judgeReason, /该战场双方单位/);
  assert.match(program.judgeReason, /460\.1/);
  assert.match(program.judgeReason, /3d/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.equal(
    program.sourceText,
    "If a combat where you are the attacker ends in a tie, recall ALL units instead. " +
      "(Send them to base. This isn't a move. Ties are calculated after combat damage is dealt.)"
  );
});

test("symbol-of-the-solari: one replacement ability over the combat result, not a trigger", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "replacement");
  // 380.1 / "instead": the effect replaces part of the combat Resolution Step
  // (468.1.a.2 inserts the 3d Recall), so it is a replacement and not a trigger.
  assert.deepEqual(ability.replaces, { event: "combat-result", filter: { player: "self" } });
  assert.equal(ability.condition, undefined);
  assert.equal(ability.with.length, 1);
});

test("symbol-of-the-solari: the replacement body names ALL units and asks for a Recall", () => {
  assert.equal(recall.id, "symbol-of-the-solari.recall-all-units");
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.targets, undefined);
  assert.equal(recall.picks, undefined);
  assert.equal(recall.linkedTo, undefined);

  // The blocked declaration records a non-target set (355.5.a). Its missing
  // combat battlefield anchor must narrow this broad board filter before use.
  assert.deepEqual(recall.args.objects, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "symbol-of-the-solari.all-units",
      filter: { type: "unit", zone: "board" },
      min: 0
    }
  });
  assert.deepEqual(recall.args.amount, {
    kind: "count",
    subject: "units",
    filter: { type: "unit", zone: "board" }
  });
  // "Send them to base": each recalled permanent goes to its own controller's
  // base (457 / 458.2), which is effect.move's controller-base destination.
  assert.deepEqual(recall.args.to, { kind: "constant", value: "controller-base" });
  // "recall", not an ordinary Move (457-458: a Recall is not a Move).
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });
});

test("symbol-of-the-solari golden: the merged Recall mode fails closed without moving anything", () => {
  const kernel = battlefieldWorld();
  // effect.move's arguments are evaluated values (objects / to / amount / mode),
  // not Expr nodes: the card IR keeps the contract-3.2 Expr spelling and the
  // caller evaluates it. The primitive is driven directly with those evaluated
  // values, exactly as a ResolveContext caller does.
  const run = runInstruction(
    moveDefinition,
    {
      objects: { kind: "constant", value: {
        kind: "choose",
        id: "symbol-of-the-solari.all-units",
        filter: { type: "unit", zone: "board" },
        min: 0
      } },
      amount: { kind: "constant", value: 2 },
      to: { kind: "constant", value: "controller-base" },
      mode: { kind: "constant", value: "recall" }
    },
    { world: kernel }
  );

  // effect.move documents Recall as explicitly blocked ("Recall requires an
  // action distinct from Move (CR v1.5 457-460)"): it returns negated/impossible
  // with a blockedReason and submits no substitute Move, so no unit changes
  // location and no Move trigger can fire.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  // A negated result carries no linkedValues, but the primitive still writes its
  // receipt to the link scope: the Recall was refused, not performed.
  assert.equal(run.linked.moved.blockedReason, "Recall requires an action distinct from Move (CR v1.5 457-460)");
  assert.equal(run.linked.moved.count, 0);
  assert.deepEqual(run.linked.moved.movements, []);

  // Both units are still at the battlefield: nothing was moved instead.
  assert.deepEqual(kernel.getObject("attacker").location, { type: "battlefield", id: "battlefield-1" });
  assert.deepEqual(kernel.getObject("defender").location, { type: "battlefield", id: "battlefield-1" });
  // A Recall is not a Move (458.1), so the refused instruction must not emit a
  // move-location action either.
  assert.deepEqual(run.events.map((event) => event.action).filter(Boolean), []);
});

test("symbol-of-the-solari: the merged replacement planner also refuses the Recall body", () => {
  // The merged planner plans a replacement body into closed GameActions; a
  // `mode: recall` effect.move throws BlockedReplacementError there too, so a
  // card-program replacement binding cannot smuggle the Recall past the
  // primitive's refusal either.
  const kernel = battlefieldWorld();
  const planner = {
    host: {
      object: ref => kernel.getObject(ref.id),
      objects: () => kernel.objects,
      context: () => kernel
    },
    controller: "A",
    evaluate: expr => kernel.evaluate(expr)
  };
  assert.throws(
    () => planReplacementBody(
      [recall],
      { hostRef: kernel.ref("symbol-of-the-solari"), replacedObject: kernel.ref("attacker"), usedWindow: false },
      planner
    ),
    /mode 'recall' is blocked/
  );
});

test.todo(
  "symbol-of-the-solari: the Recall action itself (457-460: relocates to base, is not a Move, fires no " +
    "Move triggers, ignores movement restrictions and preserves damage/statuses), needed to replace " +
    "the 468.1.a.2 Recall Attackers step with ALL units"
);

test.todo(
  "symbol-of-the-solari: the 3d Combat Special Cleanup insertion point (468.1.a.2) and the tie " +
    "condition (740.3.a: units controlled by different players at the battlefield during step 3d, " +
    "i.e. after combat damage) as a replaceable combat procedure; the closed timing-point enum has " +
    "no tie / combat-cleanup-3d point and EventPattern cannot name a procedure insertion"
);
