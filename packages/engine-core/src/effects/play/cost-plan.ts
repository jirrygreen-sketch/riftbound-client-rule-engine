import type { CardProgram, CostSpec, Expr, PlayAbility } from "@riftbound/card-dsl";
import { bindResolveContext } from "../../events/action-adapter.js";
import { CostPlanError, type CostDiscount, type CostPlan, type CostPlanInput } from "../../cost/plan-types.js";
import { buildCostPlan } from "../../cost/cost-plan.js";
import { freezeCost } from "../../cost/plan-values.js";
import { DUEL_DOMAINS } from "../../cost/resources.js";
import type {
  Domain,
  FinalizedCostPlan,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  ResolveContext,
  Value
} from "../contract.js";
import { cardProgramFor, playAbilityFor, playCostFor } from "./catalog.js";

export interface BuildEffectPlayPlanRequest {
  readonly object: ObjectRef;
  readonly player: PlayerId;
  readonly cost?: Value;
  readonly ignoreCost?: Value;
  readonly ignoreCosts?: Value;
}

type AnyRecord = Record<string, unknown>;

const DOMAIN_SET = new Set<string>(DUEL_DOMAINS);
const PLAYABLE_TYPES = new Set(["unit", "gear", "spell"]);

function record(value: unknown): AnyRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function isRef(value: unknown): value is ObjectRef {
  const item = record(value);
  return item !== null && typeof item.id === "string" && item.id.length > 0 &&
    Number.isSafeInteger(item.zoneEntryId) && Number(item.zoneEntryId) >= 0;
}

function copyRef(ref: ObjectRef): ObjectRef {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function literal(value: unknown): Expr {
  return { kind: "constant", value: value as Value };
}

function cardType(snapshot: ObjectSnapshot): string {
  const type = snapshot.types.find(value => PLAYABLE_TYPES.has(value.toLowerCase()));
  if (type === undefined) return snapshot.isToken ? "Token" : "Unknown";
  return `${type[0]!.toUpperCase()}${type.slice(1).toLowerCase()}`;
}

function domainsOf(snapshot: ObjectSnapshot): readonly Domain[] | undefined {
  if (snapshot.power === null) return undefined;
  return [...new Set(snapshot.power)];
}

function numericPower(snapshot: ObjectSnapshot, programCost: CostSpec | undefined): number | null {
  const explicit = programCost?.power;
  const constant = record(explicit);
  if (constant !== null && constant.kind === "constant" && typeof constant.value === "number") {
    return constant.value;
  }
  if (snapshot.power === null) return null;
  return snapshot.power.length;
}

function printedProjection(snapshot: ObjectSnapshot, programCost: CostSpec | undefined) {
  return {
    id: snapshot.cardId ?? snapshot.ref.id,
    cardType: cardType(snapshot),
    energy: snapshot.energy,
    power: numericPower(snapshot, programCost),
    domains: domainsOf(snapshot) ?? []
  };
}

function normalizedProgramCost(cost: CostSpec | undefined): CostPlanInput["cost"] | undefined {
  if (cost === undefined) return undefined;
  const raw = { ...cost };
  const kind = typeof raw.kind === "string" ? raw.kind : undefined;
  const normalized = kind?.startsWith("cost.") ? kind.slice(5) : kind;
  if (normalized === "printed" && Object.keys(raw).some(key => key !== "kind")) {
    delete raw.kind;
    return { kind: "explicit", ...raw };
  }
  return normalized === undefined ? raw : { ...raw, kind: normalized };
}

function planId(snapshot: ObjectSnapshot, player: PlayerId, suffix = "printed"): string {
  return `effect-play:${snapshot.ref.id}:${snapshot.ref.zoneEntryId}:${player}:${suffix}`;
}

function selectedContext(ctx: ResolveContext, snapshot: ObjectSnapshot, player: PlayerId): ResolveContext {
  return bindResolveContext(ctx, { source: snapshot, controller: player });
}

function zeroTokenPlan(ctx: ResolveContext, snapshot: ObjectSnapshot, player: PlayerId): CostPlan {
  return buildCostPlan(ctx, {
    id: planId(snapshot, player, "token"),
    cost: { kind: "explicit", energy: literal(0), power: literal([]) },
    printed: printedProjection(snapshot, undefined)
  });
}

function printedPlan(ctx: ResolveContext, snapshot: ObjectSnapshot, player: PlayerId, programCost: CostSpec | undefined): CostPlan {
  const domains = domainsOf(snapshot);
  const cost = normalizedProgramCost(programCost) ?? { kind: "printed" as const };
  return buildCostPlan(ctx, {
    id: planId(snapshot, player),
    cost,
    printed: printedProjection(snapshot, programCost),
    ...(domains === undefined ? {} : { domains })
  });
}

function ignoreValues(value: unknown): readonly string[] {
  if (value === undefined || value === null || value === false) return [];
  if (value === true || value === "printed" || value === "all") return ["resources"];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  const item = record(value);
  if (item === null) return [];
  if (item.ignore !== undefined) return ignoreValues(item.ignore);
  return [];
}

function ignoreModifications(...values: readonly unknown[]): CostPlanInput["baseModifications"] {
  const requested = new Set(ignoreValues(values.find(value => value !== undefined && value !== null && value !== false)));
  const all = values.flatMap(value => ignoreValues(value));
  for (const value of all) requested.add(value);
  const energy = requested.has("energy");
  const power = requested.has("power");
  const resources = requested.has("resources") || requested.has("any") || requested.has("all") || energy && power;
  if (requested.size > 0 && [...requested].some(value => !["energy", "power", "resources", "any", "all"].includes(value))) {
    throw new CostPlanError("judge-required", `Unsupported ignored-cost selector: ${[...requested].join(",")}`);
  }
  if (resources) return [{ kind: "ignore-base", ignore: "resources" }];
  if (energy) return [{ kind: "ignore-base", ignore: "energy" }];
  if (power) return [{ kind: "ignore-base", ignore: "power" }];
  return [];
}

function modifierDiscounts(value: unknown): CostDiscount[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const discounts: CostDiscount[] = [];
  for (const [index, raw] of list.entries()) {
    const modifier = record(raw);
    if (modifier === null || typeof modifier.kind !== "string") {
      throw new CostPlanError("judge-required", "Play cost modifier has no recognized kind");
    }
    if (modifier.kind !== "reduce") {
      throw new CostPlanError("judge-required", `Unsupported play cost modifier ${modifier.kind}`);
    }
    if (modifier.resource !== "energy" && modifier.resource !== "power") {
      throw new CostPlanError("invalid-cost-plan", "Play cost modifier resource must be energy or power");
    }
    const amount = record(modifier.amount)?.value ?? modifier.amount;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
      throw new CostPlanError("judge-required", "Play cost modifier requires a constant integer amount");
    }
    const minimum = record(modifier.minimum)?.value ?? modifier.minimum;
    if (minimum !== undefined && (typeof minimum !== "number" || !Number.isSafeInteger(minimum))) {
      throw new CostPlanError("invalid-cost-plan", "Play cost modifier minimum must be an integer");
    }
    discounts.push({
      id: typeof modifier.id === "string" && modifier.id.length > 0 ? modifier.id : `modifier:${index}`,
      resource: modifier.resource,
      amount: literal(Math.abs(amount)),
      ...(minimum === undefined ? {} : { minimum: literal(minimum) }),
      ...(typeof modifier.component === "string" ? { component: modifier.component } : {}),
      ...(Array.isArray(modifier.domains)
        ? { domains: modifier.domains.filter((domain): domain is Domain => typeof domain === "string" && DOMAIN_SET.has(domain)) }
        : {})
    });
  }
  return discounts;
}

function singleDiscount(value: unknown): CostDiscount | null {
  const discount = record(value);
  if (discount === null) return null;
  if (discount.resource !== "energy" && discount.resource !== "power") {
    throw new CostPlanError("invalid-cost-plan", "Play cost discount resource must be energy or power");
  }
  const rawAmount = record(discount.amount)?.value ?? discount.amount;
  if (typeof rawAmount !== "number" || !Number.isSafeInteger(rawAmount)) {
    throw new CostPlanError("judge-required", "Play cost discount requires a constant integer amount");
  }
  const rawMinimum = record(discount.minimum)?.value ?? discount.minimum;
  if (rawMinimum !== undefined && (typeof rawMinimum !== "number" || !Number.isSafeInteger(rawMinimum))) {
    throw new CostPlanError("invalid-cost-plan", "Play cost discount minimum must be an integer");
  }
  return {
    id: typeof discount.id === "string" && discount.id.length > 0 ? discount.id : "descriptor-discount",
    resource: discount.resource,
    amount: literal(Math.abs(rawAmount)),
    ...(rawMinimum === undefined ? {} : { minimum: literal(rawMinimum) }),
    ...(typeof discount.component === "string" ? { component: discount.component } : {}),
    ...(Array.isArray(discount.domains)
      ? { domains: discount.domains.filter((domain): domain is Domain => typeof domain === "string" && DOMAIN_SET.has(domain)) }
      : {})
  };
}

function componentList(value: unknown): CostPlanInput["mandatoryAdditional"] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CostPlanError("invalid-cost-plan", "Additional cost components must be an array");
  return value.map((raw, index) => {
    const item = record(raw);
    if (item === null || typeof item.id !== "string" || record(item.cost) === null) {
      throw new CostPlanError("invalid-cost-plan", "Each additional cost requires an id and CostSpec");
    }
    return { id: item.id.length > 0 ? item.id : `additional:${index}`, cost: item.cost as CostSpec };
  });
}

function descriptorPlan(ctx: ResolveContext, snapshot: ObjectSnapshot, player: PlayerId, descriptor: AnyRecord): CostPlan {
  if (descriptor.kind !== undefined && descriptor.kind !== "cost.modify" && descriptor.kind !== "cost.printed" && descriptor.kind !== "printed") {
    throw new CostPlanError("judge-required", `Unsupported play cost descriptor ${String(descriptor.kind)}`);
  }
  if (descriptor.replace !== undefined || descriptor.alternative !== undefined) {
    throw new CostPlanError("judge-required", "Alternate printed costs require an explicit CostSpec and domain provenance");
  }
  const programCost = playCostFor(cardProgramFor(snapshot.cardId));
  const discounts = [...modifierDiscounts(descriptor.modifiers ?? descriptor.modifier)];
  const direct = singleDiscount(descriptor.discount);
  if (direct !== null) discounts.push(direct);
  const rawAmount = record(descriptor.amount)?.value ?? descriptor.amount;
  if (rawAmount !== undefined) {
    if (descriptor.resource !== "energy" && descriptor.resource !== "power") {
      throw new CostPlanError("invalid-cost-plan", "A cost descriptor amount requires an Energy or Power resource");
    }
    if (typeof rawAmount !== "number" || !Number.isSafeInteger(rawAmount)) {
      throw new CostPlanError("judge-required", "A cost descriptor amount must be a constant integer");
    }
    if (rawAmount >= 0) {
      throw new CostPlanError("judge-required", "Positive descriptor amounts need an explicit increase component");
    }
    discounts.push({
      id: typeof descriptor.id === "string" && descriptor.id.length > 0 ? descriptor.id : "descriptor-amount",
      resource: descriptor.resource,
      amount: literal(-rawAmount),
      ...(typeof descriptor.minimum === "number" ? { minimum: literal(descriptor.minimum) } : {})
    });
  }
  const domains = domainsOf(snapshot);
  const cost = normalizedProgramCost(programCost) ?? { kind: "printed" as const };
  const ignored = ignoreModifications(descriptor.ignore) ?? [];
  return buildCostPlan(ctx, {
    id: planId(snapshot, player, typeof descriptor.id === "string" ? descriptor.id : "descriptor"),
    cost,
    printed: printedProjection(snapshot, programCost),
    ...(domains === undefined ? {} : { domains }),
    ...(ignored.length > 0 ? { baseModifications: ignored } : {}),
    ...(discounts.length > 0 ? { discounts } : {}),
    ...(Array.isArray(descriptor.optionalAdditional)
      ? { optionalAdditional: descriptor.optionalAdditional as NonNullable<CostPlanInput["optionalAdditional"]> }
      : {}),
    ...(Array.isArray(descriptor.mandatoryAdditional)
      ? { mandatoryAdditional: componentList(descriptor.mandatoryAdditional) }
      : {}),
    ...(Array.isArray(descriptor.increases)
      ? { increases: componentList(descriptor.increases) }
      : {}),
    ...(descriptor.ignoreAllCosts === true ? { ignoreAllCosts: true } : {})
  });
}

function directiveFlags(descriptor: AnyRecord): AnyRecord {
  const ignore = [
    descriptor.ignore,
    descriptor.ignoreCost,
    descriptor.ignoreCosts,
    descriptor.ignoreEnergyOnly === true ? "energy" : undefined,
    descriptor.ignoreEnergyOfSelectedCard === true ? "energy" : undefined
  ];
  return ignore.some(value => ignoreValues(value).length > 0)
    ? { ...descriptor, ignore: ignore.filter(value => value !== undefined) }
    : descriptor;
}

function exactPower(ctx: ResolveContext, player: PlayerId, plan: CostPlan): readonly Domain[] {
  const available = [...ctx.player(player).power];
  const exact: Domain[] = [];
  for (const requirement of plan.total.power) {
    const allowed = requirement.allowedDomains.filter(domain => DOMAIN_SET.has(domain));
    if (allowed.length === 0) throw new CostPlanError("invalid-cost-plan", "Cost requirement has no valid Power Domain");
    for (let index = 0; index < requirement.amount; index++) {
      const availableIndex = available.findIndex(domain => allowed.includes(domain));
      const domain = availableIndex >= 0 ? available.splice(availableIndex, 1)[0]! : allowed[0]!;
      exact.push(domain);
    }
  }
  return exact;
}

function valueRecord(value: unknown): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

/** Flatten the complete cost model without silently dropping later fees. */
export function flattenEffectPlayCostPlan(ctx: ResolveContext, plan: CostPlan): FinalizedCostPlan {
  const exhaust: ObjectRef[] = [];
  const recycle: ObjectRef[] = [];
  for (const action of plan.total.actions) {
    if (action.action.type === "exhaust") exhaust.push(copyRef(action.action.object));
    else if (action.action.type === "recycle") recycle.push(copyRef(action.action.object));
    else throw new CostPlanError("judge-required", `Nested Play cannot flatten nonstandard payment ${action.action.type}`);
  }
  const flat: FinalizedCostPlan = {
    finalized: true,
    planId: plan.id,
    energy: plan.total.energy,
    power: exactPower(ctx, plan.player, plan),
    ...(plan.total.xp === 0 ? {} : { xp: plan.total.xp }),
    ...(exhaust.length === 0 ? {} : { exhaust }),
    ...(recycle.length === 0 ? {} : { recycle }),
    parameters: {
      costPlan: valueRecord(plan),
      selectedAdditional: valueRecord(plan.selectedAdditional),
      declinedAdditional: valueRecord(plan.declinedAdditional),
      modifications: valueRecord(plan.modifications),
      discounts: valueRecord(plan.discounts)
    }
  };
  return freezeCost(flat);
}

function flatCost(ctx: ResolveContext, player: PlayerId, raw: AnyRecord): FinalizedCostPlan {
  if (raw.finalized !== true) throw new CostPlanError("judge-required", "Nested Play requires a finalized plan or recognized directive");
  if (record(raw.total) !== null) return flattenEffectPlayCostPlan(ctx, raw as unknown as CostPlan);
  const energy = raw.energy === undefined ? 0 : raw.energy;
  const power = raw.power === undefined ? [] : raw.power;
  const xp = raw.xp === undefined ? 0 : raw.xp;
  if (typeof energy !== "number" || !Number.isSafeInteger(energy) || energy < 0) {
    throw new CostPlanError("invalid-cost-plan", "Finalized Play Energy must be a non-negative safe integer");
  }
  if (!Array.isArray(power) || power.some(domain => typeof domain !== "string" || !DOMAIN_SET.has(domain))) {
    throw new CostPlanError("judge-required", "Finalized Play Power must name concrete Domains");
  }
  if (typeof xp !== "number" || !Number.isSafeInteger(xp) || xp < 0) {
    throw new CostPlanError("invalid-cost-plan", "Finalized Play XP must be a non-negative safe integer");
  }
  if (raw.universalPower !== undefined && raw.universalPower !== 0) {
    throw new CostPlanError("judge-required", "Universal Power cannot cross the current flat Play contract");
  }
  return freezeCost(structuredClone({
    ...raw,
    finalized: true as const,
    ...(typeof raw.planId === "string" ? { planId: raw.planId } : {}),
    energy,
    power,
    ...(xp === 0 ? {} : { xp })
  })) as FinalizedCostPlan;
}

/** Build the selected card's cost, or `undefined` for a legacy unknown directory entry. */
export function buildEffectPlayCostPlan(ctx: ResolveContext, request: BuildEffectPlayPlanRequest): FinalizedCostPlan | undefined {
  const snapshot = ctx.object(request.object);
  if (snapshot === null) return undefined;
  const bound = selectedContext(ctx, snapshot, request.player);
  const rawCost = record(request.cost);
  const argIgnore = request.ignoreCost ?? request.ignoreCosts;
  const ignore = ignoreModifications(argIgnore) ?? [];
  const program: CardProgram | undefined = cardProgramFor(snapshot.cardId);
  const ability: PlayAbility | undefined = playAbilityFor(program);
  const programCost = playCostFor(program);

  if (snapshot.isToken && (programCost === undefined || rawCost === null)) {
    return flattenEffectPlayCostPlan(bound, zeroTokenPlan(bound, snapshot, request.player));
  }

  if (rawCost === null) {
    if (ability === undefined && ignore.length === 0) return undefined;
    if (snapshot.energy === null) {
      throw new CostPlanError("missing-printed-cost", `Selected card ${snapshot.ref.id} has no printed Energy cost`);
    }
    const plan = printedPlan(bound, snapshot, request.player, programCost);
    return flattenEffectPlayCostPlan(bound, ignore.length === 0
      ? plan
      : buildCostPlan(bound, {
        id: plan.id,
        cost: normalizedProgramCost(programCost) ?? { kind: "printed" },
        printed: printedProjection(snapshot, programCost),
        ...(domainsOf(snapshot) === undefined ? {} : { domains: domainsOf(snapshot) }),
        baseModifications: ignore
      }));
  }

  const directive = directiveFlags(rawCost);
  const hasDirective = (ignoreModifications(directive.ignore) ?? []).length > 0 ||
    directive.discount !== undefined || directive.modifier !== undefined || directive.modifiers !== undefined ||
    directive.mandatoryAdditional !== undefined || directive.increases !== undefined || directive.ignoreAllCosts === true;
  if (rawCost.finalized === true && !hasDirective) return flatCost(bound, request.player, directive);
  if (snapshot.energy === null) {
    throw new CostPlanError("missing-printed-cost", `Selected card ${snapshot.ref.id} has no printed Energy cost`);
  }
  const plan = descriptorPlan(bound, snapshot, request.player, directive);
  return flattenEffectPlayCostPlan(bound, plan);
}
