import type {
  Expr,
  GameEvent,
  InstructionDef,
  InstructionResult,
  ObjectRef,
  PlayerId,
  ResolveContext,
  Value
} from "../contract.js";

/**
 * effect.buff - add or spend Buff counters (Buff 标记的添加 / 消耗).
 *
 * Rules evidence (Core Rules v1.5):
 * - 702: Buffs are counters placed on Units.
 * - 702.2.a: To Buff a Unit, a player chooses a Unit and places a buff on it;
 *   that Unit is Buffed for as long as the buff remains on it.
 * - 702.2.b: Spending a Buff removes a single Buff counter from a Unit.
 * - 702.2.b.1: A buff cannot be spent from a Unit that does not have a buff.
 * - 702.2.b.2: A player can only spend buffs on units they control.
 * - 702.3 / 702.3.a: There can only be one Buff on a Unit at a time; adding to
 *   a Unit that already has one is a no-op, unless another effect grants
 *   permission to be Buffed multiple times (427.1.b.2).
 * - 427.1.c and 427.3: Units that already have a Buff can still be chosen for a
 *   Buff action; they simply are not Buffed, and follow-ups keyed on
 *   "was buffed" must look at the actual per-unit result.
 *
 * Boundary with neighboring primitives: this primitive only places or removes
 * Buff counters through the closed "buff" / "spend-buff" GameActions. The +1
 * Might each Buff contributes (703) is derived by the layers system from the
 * counter count; temporary Might modifications ("gets +1 [M] this turn")
 * belong to continuous.might, never to this primitive.
 *
 * Args (value fields are card-dsl Exprs evaluated via ctx.evaluate):
 * - mode: "buff" (add) or "spend" (spend/remove).
 * - target: TargetSpec id; the objects are read with ctx.targets(target).
 *   If the spec resolved to no still-legal objects, the instruction is
 *   ignored with reason "mistargeted" (contract primitive rule 2).
 * - amount: Buff counters per object. Defaults to literal 1 (one Buff per
 *   Buff/spend wording, 702.2.a / 702.2.b). Amounts above 1 require a
 *   multiple-Buff permission granted by another effect (427.1.b.2).
 * - chooser: PlayerId of the player who spends (spend mode only; default is
 *   ctx.controller). Enforces 702.2.b.2 by skipping units the spender does
 *   not control.
 * - chooseUpTo: when true and more than one legal target remains, the
 *   chooser picks up to that many of them with ctx.choose() ("buff up to
 *   two other friendly units", e.g. ogn-141-298 Kinkou Monk). Choosing none
 *   yields negated with reason "skipped".
 *
 * Per-unit results are written to ctx.link under the keys "buffed" and
 * "spent" (arrays of ObjectRefs plus the counts "buffedCount" / "spentCount")
 * so "if you do" / "if it was buffed this way" follow-ups read the actual
 * result (427.1.c).
 */

export interface EffectBuffArgs {
  readonly mode: "buff" | "spend";
  readonly target: string;
  readonly amount?: Expr;
  readonly chooser?: PlayerId;
  readonly chooseUpTo?: boolean;
}

type ParseResult =
  | { readonly ok: true; readonly args: EffectBuffArgs }
  | { readonly ok: false; readonly reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const EXPR_KINDS: ReadonlySet<string> = new Set([
  "constant",
  "literal",
  "object-property",
  "object-attribute",
  "linked-value",
  "linked",
  "count"
]);

const isExpr = (value: unknown): value is Expr =>
  isRecord(value) && typeof value.kind === "string" && EXPR_KINDS.has(value.kind);

function parseArgs(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, reason: "args must be an object" };
  if (value.mode !== "buff" && value.mode !== "spend") return { ok: false, reason: "mode must be buff or spend" };
  if (typeof value.target !== "string" || value.target.length === 0) {
    return { ok: false, reason: "target must be a non-empty TargetSpec id" };
  }
  if (value.amount !== undefined && !isExpr(value.amount)) return { ok: false, reason: "amount must be an Expr" };
  if (value.chooser !== undefined && typeof value.chooser !== "string") return { ok: false, reason: "chooser must be a PlayerId string" };
  if (value.chooseUpTo !== undefined && typeof value.chooseUpTo !== "boolean") return { ok: false, reason: "chooseUpTo must be a boolean" };
  return {
    ok: true,
    args: {
      mode: value.mode,
      target: value.target,
      ...(value.amount === undefined ? {} : { amount: value.amount }),
      ...(value.chooser === undefined ? {} : { chooser: value.chooser }),
      ...(value.chooseUpTo === undefined ? {} : { chooseUpTo: value.chooseUpTo })
    }
  };
}

const LITERAL_ONE: Expr = { kind: "literal", value: 1 };

const refValue = (ref: ObjectRef): Value => ({ id: ref.id, zoneEntryId: ref.zoneEntryId });
const refKey = (ref: ObjectRef): string => ref.id + ":" + String(ref.zoneEntryId);

function asObjectRef(value: unknown): ObjectRef | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.zoneEntryId !== "number") return null;
  return { id: value.id, zoneEntryId: value.zoneEntryId };
}

// Note: scripts/gen-registries.mjs statically scans for the op literal after
// the "const <name> =" declaration, so this definition cannot carry a type
// annotation between the name and the initializer.
const effectBuff = {
  op: "effect.buff",
  argsSchema: {
    parse(value) {
      const parsed = parseArgs(value);
      if (!parsed.ok) throw new Error("effect.buff args: " + parsed.reason);
      return parsed.args;
    },
    safeParse(value) {
      const parsed = parseArgs(value);
      return parsed.ok
        ? { success: true, data: parsed.args }
        : { success: false, error: new Error("effect.buff args: " + parsed.reason) };
    }
  },
  execute
} satisfies InstructionDef<EffectBuffArgs>;

export default effectBuff;

function negated(reason: "replaced" | "impossible", events: readonly GameEvent[]): InstructionResult {
  return { status: "negated", reason, events: [...events] };
}

function execute(ctx: ResolveContext, args: EffectBuffArgs): InstructionResult {
  const evaluated = ctx.evaluate(args.amount ?? LITERAL_ONE);
  if (typeof evaluated !== "number" || !Number.isInteger(evaluated) || evaluated < 0) {
    throw new Error("effect.buff args: amount must evaluate to a non-negative integer, got " + JSON.stringify(evaluated));
  }
  const amount = evaluated;
  const chooser = args.chooser ?? ctx.controller;

  // 427.1.c: units that already have a Buff remain legal choices, so validity
  // here is only "the object is still where the target spec left it".
  const legal = ctx.targets(args.target).filter(ref => ctx.object(ref) !== null);
  if (legal.length === 0) return { status: "ignored", reason: "mistargeted" };

  let planned = legal;
  if (args.chooseUpTo === true && legal.length > 1) {
    const chosen = ctx.choose<readonly ObjectRef[]>({
      id: args.target + ":buff-targets",
      type: "select-objects",
      options: legal,
      min: 0,
      max: legal.length,
      chooser,
      visibility: "public"
    });
    const legalKeys = new Set(legal.map(refKey));
    planned = (Array.isArray(chosen) ? chosen : [])
      .map(asObjectRef)
      .filter((ref): ref is ObjectRef => ref !== null && legalKeys.has(refKey(ref)));
  }

  const events: GameEvent[] = [];
  const buffed: ObjectRef[] = [];
  const spent: ObjectRef[] = [];

  for (const ref of planned) {
    const snapshot = ctx.object(ref);
    if (snapshot === null) continue; // left its zone after the choice; skip it
    if (amount === 0) continue;
    if (args.mode === "buff") {
      // 702.3 / 702.3.a: a second Buff is simply not placed.
      if (snapshot.buffs > 0) continue;
      const outcome = ctx.perform({ type: "buff", object: ref, amount });
      if (outcome.status !== "done") {
        return negated(outcome.status === "replaced" ? "replaced" : "impossible", [...events, ...outcome.events]);
      }
      events.push(...outcome.events);
      buffed.push(ref);
    } else {
      // 702.2.b.2: buffs can only be spent on units the spender controls.
      if (snapshot.controller !== chooser) continue;
      const spendable = Math.min(amount, snapshot.buffs); // 702.2.b.1
      if (spendable === 0) continue;
      const outcome = ctx.perform({ type: "spend-buff", object: ref, amount: spendable });
      if (outcome.status !== "done") {
        return negated(outcome.status === "replaced" ? "replaced" : "impossible", [...events, ...outcome.events]);
      }
      events.push(...outcome.events);
      spent.push(ref);
    }
  }

  const linkedValues: Record<string, Value> = {
    buffed: buffed.map(refValue),
    spent: spent.map(refValue),
    buffedCount: buffed.length,
    spentCount: spent.length
  };
  for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);

  if (planned.length > 0 && buffed.length + spent.length === 0) {
    // Every candidate was already buffed / had nothing spendable, or an
    // optional selection picked nothing: nothing was done (702.3.a, 427.1.c).
    return { status: "negated", reason: "skipped", events };
  }
  return { status: "executed", events, linkedValues };
}

