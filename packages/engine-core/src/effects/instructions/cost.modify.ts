/**
 * cost.modify -- lock a final CR v1.5 356-357 cost plan for this source.
 *
 * The planner already applies the full ordered modification pipeline: base,
 * alternate/ignore modifications (356.1), optional additional costs including
 * Accelerate (356.2, 805), mandatory additional costs (356.2.a), increases
 * (356.3), component discounts (356.4.c), total discounts (356.4.d), per-
 * discount minima (356.4.e), the zero floor (356.4.f / 356.6), variable
 * discounts checked at Finalize (356.4.g), and explicit total rewrites
 * (356.5). This primitive never re-implements order arithmetic: it evaluates
 * the requested discount/increase expressions, feeds them to `buildCostPlan`,
 * and links the frozen plan.
 *
 * args:
 * - id: stable plan id (required except for the Weaponmaster source form).
 * - source: accepts Weaponmaster's target selector; resolves its exact current
 *   identity and reads the authoritative Equip CostSpec carried by its printed
 *   keyword parameters. No play cost or keyword value is used as a fallback.
 * - cost: `CostSpec` for the base cost; defaults to the printed cost.
 * - printed: optional trusted catalog projection.
 * - domains: optional source domains; an empty array explicitly means the
 *   universal six-domain Power (`[A]`).
 * - baseChoices / baseChoice / baseModifications / optionalAdditional /
 *   mandatoryAdditional: existing `CostPlanInput` vocabulary.
 * - modifier / modifiers: `{ kind: 'reduce' | 'increase' |
 *   'reduce-equip-cost', resource: 'energy' | 'power', amount, minimum?,
 *   domains?, powerOrder?, component?, grantedBy?, id? }`. `grantedBy` gates a
 *   discount on a selected additional-cost component (356.4.f.1). Increases are appended in CR
 *   356 order. `reduce-equip-cost` is valid only on the Weaponmaster source
 *   form and only reduces an Equip CostSpec that explicitly records universal
 *   Power provenance (821.1.c.3). Never treat six named domains as that proof.
 *   Each other modifier is one discount instance with its own
 *   minimum (356.4.e); explicit `discountOrder` stays available.
 * - ignoreAllCosts: 356.5 total rewrite.
 * - linkKey: link key for the frozen plan, default `cost` (Weaponmaster links
 *   `cost.pay` to this instruction and reads `cost`).
 *
 * Unknown modifier shapes are `judge-required`: they are never approximated
 * and never become zero costs. The plan is only a linked value; wiring it
 * into the production Finalize play pipeline is the parent-owned contract
 * integration requested in `src/cost/kinds/README.md`.
 */
import type { CostSpec } from "@riftbound/card-dsl";
import type {
  Domain,
  Expr,
  InstructionDef,
  InstructionResult,
  ObjectSnapshot,
  ResolveContext,
  Value
} from "../contract.js";
import { CostPlanError, type CostPlanInput } from "../../cost/plan-types.js";
import { buildCostPlan } from "../../cost/cost-plan.js";
import { decorateCostPlan } from "../../cost/discounts/collect.js";
import { DUEL_DOMAINS } from "../../cost/resources.js";

export interface CostModifierInput {
  readonly kind: "reduce" | "increase" | "reduce-equip-cost";
  readonly resource: "energy" | "power";
  readonly amount: Expr;
  readonly minimum?: Expr;
  readonly domains?: readonly Domain[];
  readonly powerOrder?: readonly number[];
  readonly component?: string;
  /** Apply this modifier only when the named optional additional cost was selected. */
  readonly grantedBy?: string;
  readonly id?: string;
}

export interface CostModifyArgs {
  readonly id?: string;
  readonly source?: Expr | { readonly kind: "target"; readonly id: string };
  readonly cost?: CostPlanInput["cost"];
  readonly printed?: CostPlanInput["printed"];
  readonly domains?: readonly Domain[];
  readonly baseChoices?: CostPlanInput["baseChoices"];
  readonly baseChoice?: string;
  readonly baseModifications?: CostPlanInput["baseModifications"];
  readonly optionalAdditional?: CostPlanInput["optionalAdditional"];
  readonly mandatoryAdditional?: CostPlanInput["mandatoryAdditional"];
  readonly discountOrder?: readonly string[];
  readonly modifier?: CostModifierInput;
  readonly modifiers?: readonly CostModifierInput[];
  readonly ignoreAllCosts?: boolean;
  readonly linkKey?: string;
}

const MODIFIER_KEYS = new Set([
  "kind",
  "resource",
  "domain",
  "amount",
  "minimum",
  "domains",
  "powerOrder",
  "component",
  "grantedBy",
  "id"
]);

const ARGS_KEYS = new Set([
  "id",
  "source",
  "cost",
  "printed",
  "domains",
  "baseChoices",
  "baseChoice",
  "baseModifications",
  "optionalAdditional",
  "mandatoryAdditional",
  "discountOrder",
  "modifier",
  "modifiers",
  "ignoreAllCosts",
  "linkKey"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

function parseModifier(value: unknown, label: string): CostModifierInput {
  if (!isRecord(value)) throw new TypeError(`cost.modify ${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!MODIFIER_KEYS.has(key)) throw new TypeError(`Invalid cost.modify ${label} argument: ${key}`);
  }
  if (value.kind !== "reduce" && value.kind !== "increase" && value.kind !== "reduce-equip-cost") {
    throw new TypeError("cost.modify modifier.kind must be reduce, increase, or reduce-equip-cost");
  }
  if (value.resource !== "energy" && value.resource !== "power") {
    throw new TypeError("cost.modify modifier.resource must be energy or power");
  }
  const amount = value.kind === "reduce-equip-cost" && typeof value.amount === "number"
    && Number.isSafeInteger(value.amount) && value.amount >= 0
    ? { kind: "constant" as const, value: value.amount } : value.amount;
  if (!isExpr(amount)) throw new TypeError("cost.modify modifier.amount must be an Expr");
  if (value.kind === "reduce-equip-cost" && value.resource !== "power") {
    throw new TypeError("reduce-equip-cost requires Power");
  }
  if (value.domain !== undefined && (value.kind !== "reduce-equip-cost" || value.domain !== "any")) {
    throw new TypeError("Only reduce-equip-cost accepts domain: any");
  }
  if (value.minimum !== undefined && !isExpr(value.minimum)) {
    throw new TypeError("cost.modify modifier.minimum must be an Expr");
  }
  if (value.domains !== undefined && (!Array.isArray(value.domains) || value.domains.some(domain => typeof domain !== "string"))) {
    throw new TypeError("cost.modify modifier.domains must be a domain list");
  }
  if (value.powerOrder !== undefined && (!Array.isArray(value.powerOrder) || value.powerOrder.some(entry => !Number.isSafeInteger(entry)))) {
    throw new TypeError("cost.modify modifier.powerOrder must be an integer permutation");
  }
  if (value.component !== undefined && (typeof value.component !== "string" || !value.component.length)) {
    throw new TypeError("cost.modify modifier.component must be a non-empty string");
  }
  if (value.grantedBy !== undefined && (typeof value.grantedBy !== "string" || !value.grantedBy.length)) {
    throw new TypeError("cost.modify modifier.grantedBy must be a non-empty additional cost id");
  }
  if (value.id !== undefined && (typeof value.id !== "string" || !value.id.length)) {
    throw new TypeError("cost.modify modifier.id must be a non-empty string");
  }
  const { domain: _legacyDomain, ...normalized } = value;
  return { ...normalized, amount } as unknown as CostModifierInput;
}

export function parseCostModifyArgs(value: unknown): CostModifyArgs {
  if (!isRecord(value)) throw new TypeError("cost.modify args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARGS_KEYS.has(key)) throw new TypeError(`Invalid cost.modify argument: ${key}`);
  }
  if (value.id === undefined ? value.source === undefined : typeof value.id !== "string" || !value.id.length) {
    throw new TypeError("cost.modify id must be a non-empty string (or supply source)");
  }
  if (value.source !== undefined) {
    const source = value.source;
    const valid = isRecord(source) && (source.kind === "target"
      ? typeof source.id === "string" && source.id.length > 0 : isExpr(source));
    if (!valid) throw new TypeError("cost.modify source must be an Expr or target selector");
  }
  if (value.cost !== undefined && !isRecord(value.cost)) {
    throw new TypeError("cost.modify cost must be a CostSpec object");
  }
  if (value.modifier !== undefined && value.modifiers !== undefined) {
    throw new TypeError("cost.modify accepts either modifier or modifiers, not both");
  }
  const modifier = value.modifier === undefined ? undefined : parseModifier(value.modifier, "modifier");
  if (value.modifiers !== undefined) {
    if (!Array.isArray(value.modifiers)) throw new TypeError("cost.modify modifiers must be an array");
  }
  if (value.linkKey !== undefined && (typeof value.linkKey !== "string" || !value.linkKey.length)) {
    throw new TypeError("cost.modify linkKey must be a non-empty string");
  }
  if (value.ignoreAllCosts !== undefined && typeof value.ignoreAllCosts !== "boolean") {
    throw new TypeError("cost.modify ignoreAllCosts must be a boolean");
  }
  if (value.discountOrder !== undefined && (!Array.isArray(value.discountOrder) || value.discountOrder.some(id => typeof id !== "string"))) {
    throw new TypeError("cost.modify discountOrder must be a list of discount IDs");
  }
  return {
    ...value,
    ...(modifier === undefined ? {} : { modifier }),
    ...(value.modifiers === undefined ? {} : {
      modifiers: (value.modifiers as unknown[]).map((entry, index) => parseModifier(entry, `modifiers[${index}]`))
    })
  } as unknown as CostModifyArgs;
}

export class CostFailure extends CostPlanError {
  constructor(reason: CostPlanError["reason"], detail?: string) {
    super(reason, `cost.modify failed: ${reason}${detail ? `: ${detail}` : ""}`);
    this.name = "CostFailure";
  }
}

function modifiersToCostPlanInput(
  args: CostModifyArgs & { readonly id: string },
  allowAuthoritativeEquipDiscount = false
): CostPlanInput {
  const modifiers = [...(args.modifier === undefined ? [] : [args.modifier]), ...(args.modifiers ?? [])];
  const discounts: { id: string; component?: string; resource: "energy" | "power"; amount: Expr; minimum?: Expr; domains?: readonly Domain[]; powerOrder?: readonly number[]; grantedBy?: string }[] = [];
  const increases: { id: string; cost: { energy?: Expr; power?: Expr } }[] = [];
  for (const [index, modifier] of modifiers.entries()) {
    const id = modifier.id ?? `${args.id}:modifier:${index}`;
    if (modifier.kind === "reduce-equip-cost" && !allowAuthoritativeEquipDiscount) {
      throw new CostPlanError("judge-required", "821.1.c.3: Equip discounts require original [A] symbols; allowedDomains cannot distinguish [A] from [C]");
    }
    if (modifier.kind === "increase") {
      if (modifier.grantedBy !== undefined) {
        throw new CostPlanError("judge-required", "grantedBy is only supported for discounts");
      }
      increases.push({ id, cost: { [modifier.resource]: modifier.amount } });
      continue;
    }
    if (modifier.grantedBy !== undefined) {
      const optional = args.optionalAdditional?.find(component => component.id === modifier.grantedBy);
      const mandatory = args.mandatoryAdditional?.some(component => component.id === modifier.grantedBy);
      if (optional === undefined && !mandatory) {
        throw new CostPlanError("judge-required", `grantedBy refers to unknown additional cost ${modifier.grantedBy}`);
      }
      if (optional !== undefined && optional.selected !== true) continue;
    }
    discounts.push({
      id,
      resource: modifier.resource,
      amount: modifier.amount,
      ...(modifier.minimum !== undefined ? { minimum: modifier.minimum } : {}),
      ...(modifier.domains !== undefined ? { domains: modifier.domains } : {}),
      ...(modifier.powerOrder !== undefined ? { powerOrder: modifier.powerOrder } : {}),
      ...(modifier.component !== undefined ? { component: modifier.component } : {}),
      ...(modifier.grantedBy !== undefined ? { grantedBy: modifier.grantedBy } : {})
    });
  }
  return {
    id: args.id,
    ...(args.cost !== undefined ? { cost: args.cost } : { cost: { kind: "printed" as const } }),
    ...(args.printed !== undefined ? { printed: args.printed } : {}),
    ...(args.domains !== undefined ? { domains: args.domains } : {}),
    ...(args.baseChoices !== undefined ? { baseChoices: args.baseChoices } : {}),
    ...(args.baseChoice !== undefined ? { baseChoice: args.baseChoice } : {}),
    ...(args.baseModifications !== undefined ? { baseModifications: args.baseModifications } : {}),
    ...(args.optionalAdditional !== undefined ? { optionalAdditional: args.optionalAdditional } : {}),
    ...(args.mandatoryAdditional !== undefined ? { mandatoryAdditional: args.mandatoryAdditional } : {}),
    ...(args.discountOrder !== undefined ? { discountOrder: args.discountOrder } : {}),
    ...(discounts.length ? { discounts } : {}),
    ...(increases.length ? { increases } : {}),
    ...(args.ignoreAllCosts === true ? { ignoreAllCosts: true } : {})
  };
}

type ObjectKeyword = ObjectSnapshot["keywords"][number] & {
  readonly params?: Readonly<Record<string, unknown>>;
};

function keywordId(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "-");
}

function sameRef(left: ObjectSnapshot["ref"], right: ObjectSnapshot["ref"]): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function unsupportedEquipCost(detail: string): never {
  throw new CostPlanError("judge-required", `821.1.c.2: unsupported authoritative Equip cost: ${detail}`);
}

function onlyEquipKeys(value: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown !== undefined) unsupportedEquipCost(`${label} field ${unknown}`);
}

const EQUIP_COST_KEYS = new Set(["kind", "payments", "energy", "power", "discard", "universal"]);
const EQUIP_PAYMENT_KEYS = new Set([
  "kind", "id", "amount", "value", "choice", "object", "allowedDomains", "source", "universal"
]);

interface EquipPowerRequirement {
  readonly id?: string;
  readonly amount: number;
  readonly allowedDomains: readonly string[];
  readonly universal: boolean;
}

interface NormalizedEquipCost {
  readonly cost: CostSpec;
  readonly powerOrder: readonly number[];
  readonly hasUniversalPower: boolean;
}

interface IndexedEquipPowerRequirement extends EquipPowerRequirement {
  readonly index: number;
}

interface NormalizedEquipPayment {
  readonly payment: NonNullable<CostSpec["payments"]>[number];
  readonly order: number | null;
}

function isPowerRequirement(value: unknown): value is IndexedEquipPowerRequirement {
  return isRecord(value) && Array.isArray(value.allowedDomains) && typeof value.universal === "boolean" &&
    typeof value.amount === "number" && typeof value.index === "number";
}

function isNormalizedEquipPayment(value: unknown): value is NormalizedEquipPayment {
  return isRecord(value) && "payment" in value && (typeof value.order === "number" || value.order === null);
}

function expressionValue(value: unknown): unknown {
  return isRecord(value) && (value.kind === "constant" || value.kind === "literal") ? value.value : undefined;
}

function listIsUniversal(value: readonly unknown[]): boolean {
  return value.length === 1 && value[0] === "any";
}

function listIsAmbiguousAllDomains(value: readonly unknown[]): boolean {
  return value.length === DUEL_DOMAINS.length && DUEL_DOMAINS.every(domain => value.includes(domain));
}

function namedPowerDomains(value: readonly unknown[]): readonly string[] {
  if (value.length === 0 || listIsAmbiguousAllDomains(value) ||
      value.some(item => !DUEL_DOMAINS.includes(item as typeof DUEL_DOMAINS[number]))) {
    unsupportedEquipCost("ambiguous named Power domains");
  }
  return value as readonly string[];
}

function powerAmount(value: unknown, globalUniversal: boolean): EquipPowerRequirement {
  const raw = expressionValue(value);
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) unsupportedEquipCost("Power count");
    if (!globalUniversal) unsupportedEquipCost("numeric Power count without [A] provenance");
    return { amount: raw, allowedDomains: [...DUEL_DOMAINS], universal: raw > 0 };
  }
  if (!Array.isArray(raw) || raw.length === 0) unsupportedEquipCost("Power symbol list");
  if (listIsUniversal(raw)) return { amount: 1, allowedDomains: [...DUEL_DOMAINS], universal: true };
  if (globalUniversal) unsupportedEquipCost("Universal marker conflicting with named Power symbols");
  return { amount: raw.length, allowedDomains: namedPowerDomains(raw), universal: false };
}

function paymentPower(payment: NonNullable<CostSpec["payments"]>[number], globalUniversal: boolean): EquipPowerRequirement {
  if (payment.source !== undefined && !["any", "universal", "universal-power"].includes(payment.source)) {
    unsupportedEquipCost(`payment source ${payment.source}`);
  }
  const sourceUniversal = payment.universal === true || payment.source === "any" ||
    payment.source === "universal" || payment.source === "universal-power";
  if (payment.allowedDomains !== undefined) {
    if (listIsUniversal(payment.allowedDomains)) {
      const amount = expressionValue(payment.amount ?? payment.value);
      if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) unsupportedEquipCost("payment amount");
      return { ...(payment.id === undefined ? {} : { id: payment.id }), amount, allowedDomains: [...DUEL_DOMAINS], universal: amount > 0 };
    }
    if (globalUniversal || sourceUniversal) unsupportedEquipCost("Universal marker conflicting with named Power domains");
    const domains = namedPowerDomains(payment.allowedDomains);
    const amount = expressionValue(payment.amount ?? payment.value);
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) unsupportedEquipCost("payment amount");
    return { ...(payment.id === undefined ? {} : { id: payment.id }), amount, allowedDomains: domains, universal: false };
  }
  return { ...(payment.id === undefined ? {} : { id: payment.id }), ...powerAmount(payment.amount ?? payment.value, globalUniversal || sourceUniversal) };
}

function normalizedNonPowerPayment(payment: NonNullable<CostSpec["payments"]>[number]): NonNullable<CostSpec["payments"]>[number] {
  onlyEquipKeys(payment as unknown as Readonly<Record<string, unknown>>, EQUIP_PAYMENT_KEYS, "payment");
  if (payment.universal !== undefined || payment.allowedDomains !== undefined) unsupportedEquipCost("Power provenance on non-Power payment");
  if (payment.source !== undefined && payment.source !== payment.kind &&
      !(payment.kind === "xp" && payment.source === "xp") &&
      !(payment.kind === "energy" && payment.source === "energy")) unsupportedEquipCost(`non-Power payment source ${payment.source}`);
  return {
    kind: payment.kind,
    ...(payment.id === undefined ? {} : { id: payment.id }),
    ...(payment.amount === undefined ? {} : { amount: payment.amount }),
    ...(payment.value === undefined ? {} : { value: payment.value }),
    ...(payment.choice === undefined ? {} : { choice: payment.choice }),
    ...(payment.object === undefined ? {} : { object: payment.object }),
    ...(payment.objects === undefined ? {} : { objects: payment.objects })
  };
}

function normalizedEquipCost(cost: CostSpec): NormalizedEquipCost {
  onlyEquipKeys(cost as unknown as Readonly<Record<string, unknown>>, EQUIP_COST_KEYS, "cost");
  if (cost.universal !== undefined && typeof cost.universal !== "boolean") unsupportedEquipCost("Universal marker");
  const globalUniversal = cost.universal === true;
  const rawPayments: Array<IndexedEquipPowerRequirement | NonNullable<CostSpec["payments"]>[number]> = [
    ...(cost.power === undefined ? [] : [{ ...powerAmount(cost.power, globalUniversal), index: 0 }]),
    ...(cost.payments ?? []).map((payment, index): IndexedEquipPowerRequirement | NonNullable<CostSpec["payments"]>[number] => payment.kind === "power"
      ? { ...paymentPower(payment, globalUniversal), index: index + (cost.power === undefined ? 0 : 1) }
      : normalizedNonPowerPayment(payment))
  ];
  const power = rawPayments.flatMap((payment) =>
    isPowerRequirement(payment) ? [payment] : []);
  const orderedPower = [...power.filter(entry => entry.universal), ...power.filter(entry => !entry.universal)];
  const payments = rawPayments.map((payment): NormalizedEquipPayment => {
    if (!isPowerRequirement(payment)) return { payment, order: null };
    const order = orderedPower.findIndex(entry => entry.index === payment.index);
    if (order < 0) throw new Error("Normalized Power requirement lost its payment position");
    return { payment: {
      kind: "power",
      ...(payment.id === undefined ? {} : { id: payment.id }),
      amount: { kind: "constant" as const, value: payment.amount },
      allowedDomains: payment.allowedDomains
    }, order };
  });
  return {
    cost: {
      ...(cost.kind === undefined ? {} : { kind: cost.kind }),
      ...(cost.energy === undefined ? {} : { energy: cost.energy }),
      ...(cost.discard === undefined ? {} : { discard: cost.discard }),
      payments: payments.map(entry => entry.payment)
    },
    powerOrder: payments.flatMap(entry => entry.order === null ? [] : [entry.order]),
    hasUniversalPower: power.some(entry => entry.universal && entry.amount > 0)
  };
}

function authoritativeEquipCost(equipment: ObjectSnapshot): CostSpec {
  const entries = (equipment.keywords as readonly ObjectKeyword[])
    .filter(keyword => keywordId(keyword.id) === "equip");
  const costs = entries.flatMap(keyword => {
    const params = keyword.params;
    return params !== undefined && isRecord(params.cost) ? [params.cost as CostSpec] : [];
  });
  if (costs.length === 0) {
    throw new CostPlanError("judge-required", `821.1.c.2: missing authoritative Equip-cost binding for ${equipment.ref.id}; original [A]/[C] symbols required`);
  }
  if (costs.length !== entries.length || costs.length !== 1) {
    throw new CostPlanError("judge-required", `821.1.c.2: ${equipment.ref.id} has an ambiguous or unbound Equip cost`);
  }
  return costs[0]!;
}

const execute: InstructionDef<CostModifyArgs>["execute"] = (ctx, args): InstructionResult => {
  try {
    if (args.source !== undefined) {
      const selection = args.source.kind === "target" ? args.source : ctx.evaluate(args.source as Expr);
      if (!isRecord(selection) || selection.kind !== "target" || typeof selection.id !== "string") {
        throw new CostPlanError("invalid-cost-plan", "Weaponmaster source must select an Equipment target");
      }
      const refs = ctx.targets(selection.id);
      const equipment = refs.length === 1 ? ctx.object(refs[0]!) : null;
      if (!equipment || equipment.controller !== ctx.controller || equipment.zone !== "board"
        || !equipment.types.includes("gear") || !equipment.tags.includes("Equipment")
        || sameRef(equipment.ref, ctx.source.ref)) {
        throw new CostPlanError("cannot-pay-cost", "Weaponmaster requires one current controlled Equipment target");
      }
      const equipCost = normalizedEquipCost(authoritativeEquipCost(equipment));
      if (!equipCost.hasUniversalPower) {
        throw new CostPlanError("cannot-pay-cost", `821.1.c.3: the Equip cost for ${equipment.ref.id} has no [A] to reduce`);
      }
      const requestedModifiers = [...(args.modifier === undefined ? [] : [args.modifier]), ...(args.modifiers ?? [])];
      if (requestedModifiers.length !== 1 || requestedModifiers[0]?.kind !== "reduce-equip-cost") {
        throw new CostPlanError("invalid-cost-plan", "Weaponmaster source requires one reduce-equip-cost modifier");
      }
      const id = args.id ?? `weaponmaster:${ctx.source.ref.id}:${ctx.source.ref.zoneEntryId}:${equipment.ref.id}:${equipment.ref.zoneEntryId}:equip-cost`;
      const normalized = modifiersToCostPlanInput({
        ...args,
        id,
        modifier: requestedModifiers[0],
        modifiers: undefined,
        domains: undefined,
        cost: equipCost.cost,
        discountOrder: [requestedModifiers[0].id ?? `${id}:modifier:0`]
      }, true);
      const plan = buildCostPlan(ctx, {
        ...normalized,
        discounts: normalized.discounts?.map(discount => ({
          ...discount,
          powerOrder: equipCost.powerOrder
        }))
      });
      const key = args.linkKey ?? "cost";
      ctx.link(key, plan as unknown as Value);
      return { status: "executed", events: [], linkedValues: { [key]: plan as unknown as Value } };
    }
    const requestedModifiers = [...(args.modifier === undefined ? [] : [args.modifier]), ...(args.modifiers ?? [])];
    const grantIds = new Set(requestedModifiers.flatMap(modifier => modifier.grantedBy === undefined ? [] : [modifier.grantedBy]));
    const optionalAdditional = args.optionalAdditional?.map(component => grantIds.has(component.id) && component.selected === undefined
      ? { ...component, selected: ctx.choose<boolean>({ id: `${args.id}:optional:${component.id}`, type: 'optional', chooser: ctx.controller, visibility: 'public' }) }
      : component);
    const normalized = modifiersToCostPlanInput({ ...args, ...(optionalAdditional === undefined ? {} : { optionalAdditional }), id: args.id! });
    const modifierList = requestedModifiers;
    const grantedBy = Object.fromEntries(modifierList.flatMap((modifier, index) => {
      if (modifier.grantedBy === undefined || modifier.kind === 'increase') return [];
      const id = modifier.id ?? `${args.id}:modifier:${index}`;
      return [[id, modifier.grantedBy]];
    }));
    const plan = decorateCostPlan(buildCostPlan(ctx, normalized), { additional: {}, grantedBy });
    const key = args.linkKey ?? "cost";
    ctx.link(key, plan as unknown as Value);
    return { status: "executed", events: [], linkedValues: { [key]: plan as unknown as Value } };
  } catch (error) {
    if (!(error instanceof CostPlanError)) throw error;
    throw new CostFailure(error.reason, error.message);
  }
};

export default {
  op: "cost.modify",
  argsSchema: { parse: parseCostModifyArgs },
  execute
} satisfies InstructionDef<CostModifyArgs>;
