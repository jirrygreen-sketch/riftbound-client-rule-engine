import type { Ability, CardProgram, CostSpec, PlayAbility, ActivatedAbility } from '@riftbound/card-dsl';
import type { ObjectSnapshot } from '../../effects/contract.js';
import type { BaseCostModification, CostComponentInput, CostPlanInput, OptionalCostInput } from '../../cost/plan-types.js';
import { judgeRequired } from '../errors.js';

type AnyRecord = Record<string, unknown>;
type CostMode = 'play' | 'activate';
type CostAbility = PlayAbility | ActivatedAbility;
type KeywordCostKind = 'accelerate' | 'repeat';

export interface ProgramCostBindingInput {
  readonly program: CardProgram;
  readonly source: ObjectSnapshot;
  readonly mode: CostMode;
  readonly id: string;
  readonly ability?: CostAbility;
  readonly abilities?: readonly Ability[];
}

export interface ProgramCostBinding {
  readonly plan: Omit<CostPlanInput, 'id'>;
  readonly additionalIds: readonly string[];
}

const ADDITIONAL_KINDS = new Set(['additional', 'additional-cost', 'cost.additional']);
const BASE_KINDS = new Set(['printed', 'cost.printed', 'activated', 'cost.activated', 'explicit']);
const COMPONENT_METADATA = new Set(['id', 'optional', 'stage', 'keyword', 'appliesTo', 'when', 'fromZone']);

function record(value: unknown): AnyRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function normalizedKind(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.startsWith('cost.') ? value.slice(5) : value;
}

function stableId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function collectCostLinks(value: unknown, ids = new Set<string>(), choices = new Set<string>()): { ids: Set<string>; choices: Set<string> } {
  if (typeof value !== 'object' || value === null) return { ids, choices };
  if (Array.isArray(value)) {
    for (const item of value) collectCostLinks(item, ids, choices);
    return { ids, choices };
  }
  const item = value as AnyRecord;
  if (item.kind === 'result' && typeof item.result === 'string' &&
    /(?:^|\.)(?:additional|optional-additional|additional-cost)(?:\.|-|$)/.test(item.result) && typeof item.id === 'string') {
    ids.add(item.id);
  }
  if (typeof item.id === 'string' &&
    (record(item.filter) !== undefined || item.zone !== undefined || item.type !== undefined || item.controller !== undefined) &&
    Array.isArray(item.options)) choices.add(item.id);
  for (const child of Object.values(item)) collectCostLinks(child, ids, choices);
  return { ids, choices };
}

function deriveComponentId(raw: AnyRecord, program: CardProgram, fallback: string): string {
  if (typeof raw.id === 'string' && raw.id.length > 0) return raw.id;
  const directChoice = collectCostLinks(raw).choices;
  if (directChoice.size === 1) return [...directChoice][0]!;
  const referenced = collectCostLinks(program.abilities).ids;
  if (referenced.size === 1) return [...referenced][0]!;
  return fallback;
}

function stripPaymentMetadata(payment: unknown, keyword: string | undefined): AnyRecord {
  const source = record(payment);
  if (!source) judgeRequired('Additional costs require payment objects');
  const output: AnyRecord = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'keyword') {
      if (keyword === undefined || value !== keyword) judgeRequired(`Unsupported payment keyword ${String(value)}`);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function componentCost(raw: AnyRecord, keyword: string | undefined, direct = false): CostSpec {
  const output: AnyRecord = {};
  const hasPayments = Array.isArray(raw.payments) && raw.payments.length > 0;
  const domains = raw.power === undefined ? undefined : (() => {
    const value = record(raw.power);
    return Array.isArray(raw.power) ? raw.power : value?.value;
  })();
  for (const [key, value] of Object.entries(raw)) {
    if (COMPONENT_METADATA.has(key) || ADDITIONAL_KINDS.has(normalizedKind(key) ?? '')) continue;
    if (key === 'kind' && ADDITIONAL_KINDS.has(normalizedKind(value) ?? '')) continue;
    if (key === 'costs' || key === 'discount') judgeRequired(`Unsupported additional cost field ${key}`);
    if (direct && Array.isArray(raw.payments) && ['energy', 'power', 'rune', 'discard'].includes(key)) continue;
    if (!direct && !hasPayments && key === 'power') {
      if (!Array.isArray(domains)) judgeRequired('Additional Power costs require a domain list');
      output.payments = domains.map(domain => ({ kind: 'power', amount: { kind: 'constant', value: 1 }, allowedDomains: [domain] }));
      continue;
    }
    if (direct && key === 'power' && !hasPayments) {
      if (!Array.isArray(domains)) judgeRequired('Additional Power costs require a domain list');
      output.payments = domains.map(domain => ({ kind: 'power', amount: { kind: 'constant', value: 1 }, allowedDomains: [domain] }));
      continue;
    }
    if (key === 'payments' && Array.isArray(value)) {
      output.payments = value.map(payment => stripPaymentMetadata(payment, keyword));
    } else {
      output[key] = value;
    }
  }
  return output as CostSpec;
}

function sourceSaysMay(sourceText: string): boolean | undefined {
  const text = sourceText.replace(/\s+/g, ' ').toLowerCase();
  const pattern = /\b(?:as (?:an|my) additional cost|as you play (?:me|this))\b/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const clauseStart = Math.max(text.lastIndexOf('.', start), text.lastIndexOf('\n', start), text.lastIndexOf(';', start)) + 1;
    const after = text.slice(start, Math.min(text.length, start + 220));
    const clause = text.slice(clauseStart, start + (after.split(/[.;]/)[0]?.length ?? 0));
    if (/\bmay\b/.test(clause)) return true;
  }
  return text.includes('additional cost') ? false : undefined;
}

function optionalDecision(raw: AnyRecord, program: CardProgram, keyword: string | undefined, label: string): boolean {
  const declared = raw.optional;
  if (declared !== undefined && typeof declared !== 'boolean') judgeRequired(`${label} optional must be boolean`);
  const stage = raw.stage;
  if (stage !== undefined && stage !== 'optional-additional' && stage !== 'mandatory-additional') {
    judgeRequired(`${label} has unsupported stage ${String(stage)}`);
  }
  const stageOptional = stage === undefined ? undefined : stage === 'optional-additional';
  if (declared !== undefined && stageOptional !== undefined && declared !== stageOptional) {
    judgeRequired(`${label} optional flag conflicts with its stage`);
  }
  const keywordOptional = keyword === 'accelerate' || keyword === 'repeat' ? true : undefined;
  if (keywordOptional === true && declared === false) judgeRequired(`${label} keyword cost cannot be mandatory`);
  const sourceOptional = sourceSaysMay(program.sourceText);
  const values = [declared, stageOptional, keywordOptional, sourceOptional].filter((value): value is boolean => typeof value === 'boolean');
  if (values.length === 0) judgeRequired(`${label} does not say whether the additional cost is optional`);
  if (new Set(values).size !== 1) judgeRequired(`${label} has conflicting optional-cost evidence`);
  return values[0]!;
}

function keywordFor(raw: AnyRecord, label: string): KeywordCostKind | undefined {
  const keyword = raw.keyword;
  if (keyword === undefined) return undefined;
  if (keyword !== 'accelerate' && keyword !== 'repeat') judgeRequired(`${label} has unsupported keyword cost ${String(keyword)}`);
  return keyword;
}

function component(
  raw: AnyRecord,
  program: CardProgram,
  fallbackId: string,
  direct = false,
): { readonly optional?: OptionalCostInput; readonly mandatory?: CostComponentInput; readonly id: string } {
  const keyword = keywordFor(raw, fallbackId);
  const id = deriveComponentId(raw, program, fallbackId);
  const selected = optionalDecision(raw, program, keyword, id);
  const cost = componentCost(raw, keyword, direct);
  const kind: OptionalCostInput['kind'] = keyword ?? 'additional';
  if (selected) return { id, optional: { id, kind, cost } };
  return { id, mandatory: { id, cost } };
}

function appendComponents(
  raw: AnyRecord,
  program: CardProgram,
  fallbackId: string,
  add: (id: string, optional?: OptionalCostInput, mandatory?: CostComponentInput) => void,
  direct = false,
): void {
  const costs = raw.costs;
  if (costs !== undefined) {
    if (!Array.isArray(costs) || costs.length === 0) judgeRequired(`${fallbackId} costs must be a non-empty array`);
    if (keywordFor(raw, fallbackId) !== 'repeat') judgeRequired(`${fallbackId} has multiple costs without Repeat`);
    costs.forEach((entry, index) => {
      const value = record(entry);
      if (!value) judgeRequired(`${fallbackId} cost ${index} must be an object`);
      const nested = component({ ...value, keyword: 'repeat', optional: true }, program, `${fallbackId}:${index}`);
      if (!nested.optional) judgeRequired(`${fallbackId} Repeat instance ${index} must be optional`);
      add(nested.id, nested.optional);
    });
    return;
  }
  const value = component(raw, program, fallbackId, direct);
  add(value.id, value.optional, value.mandatory);
}

function normalizeBaseCost(raw: AnyRecord, id: string, mode: CostMode): CostPlanInput['cost'] {
  const kind = normalizedKind(raw.kind);
  if (kind !== undefined && !BASE_KINDS.has(kind)) judgeRequired(`Unsupported ${mode} base cost kind ${String(raw.kind)} on ${id}`);
  const base: AnyRecord = { ...raw };
  delete base.optional;
  delete base.keyword;
  delete base.additional;
  delete base['additional-cost'];
  delete base.costs;
  delete base.discount;
  delete base.id;
  delete base.stage;
  delete base.appliesTo;
  delete base.when;
  delete base.fromZone;
  if (kind === 'printed' && Object.keys(base).some(key => key !== 'kind')) {
    delete base.kind;
    return { kind: 'explicit', ...base } as CostPlanInput['cost'];
  }
  if (kind === undefined) return base as CostPlanInput['cost'];
  return { ...base, kind } as CostPlanInput['cost'];
}

function printedBaseCost(raw: AnyRecord): CostPlanInput['cost'] {
  const base: AnyRecord = { kind: 'printed' };
  for (const key of ['energy', 'power']) {
    if (raw[key] !== undefined) base[key] = raw[key];
  }
  return base as CostPlanInput['cost'];
}

function directAdditional(raw: AnyRecord): boolean {
  const kind = normalizedKind(raw.kind);
  return ADDITIONAL_KINDS.has(kind ?? '') || raw.additional !== undefined || raw['additional-cost'] !== undefined ||
    raw.costs !== undefined || raw.keyword === 'repeat' || raw.keyword === 'accelerate' || raw.optional !== undefined;
}

function directBaseCost(raw: AnyRecord, _program: CardProgram): CostPlanInput['cost'] | undefined {
  const hasDeclarationBase = raw.energy !== undefined || raw.power !== undefined || raw.rune !== undefined || raw.discard !== undefined;
  if (Array.isArray(raw.payments)) {
    const base: AnyRecord = { kind: 'printed' };
    for (const key of ['energy', 'power', 'rune', 'discard']) {
      if (raw[key] !== undefined) base[key] = raw[key];
    }
    if (Object.keys(base).length > 1) return base as CostPlanInput['cost'];
    return hasDeclarationBase ? { kind: 'printed' } : printedBaseCost(raw);
  }
  return hasDeclarationBase ? { kind: 'printed' } : printedBaseCost(raw);
}

function staticAdditional(
  ability: Ability,
  program: CardProgram,
  index: number,
): AnyRecord | undefined {
  if (ability.kind !== 'static') return undefined;
  const effect = record(ability.effect);
  if (effect?.kind !== 'cost.additional') return undefined;
  if (effect.appliesTo !== undefined && effect.appliesTo !== 'self') {
    judgeRequired(`Static additional cost ${String(effect.id ?? index)} only supports appliesTo self`);
  }
  if (ability.condition !== undefined && ability.condition.kind !== 'always') {
    judgeRequired(`Static additional cost ${String(effect.id ?? index)} has an unevaluated condition`);
  }
  if (effect.when !== undefined || effect.fromZone !== undefined || effect.filter !== undefined) {
    judgeRequired(`Static additional cost ${String(effect.id ?? index)} requires a dynamic applicability adapter`);
  }
  return effect;
}

function keywordCost(
  ability: Ability,
  program: CardProgram,
  index: number,
): { readonly optional?: OptionalCostInput; readonly modification?: BaseCostModification } | undefined {
  if (ability.kind !== 'static') return undefined;
  const effect = record(ability.effect);
  if (!effect) return undefined;
  const kind = effect?.kind;
  if (kind !== 'accelerate.cost' && kind !== 'repeat.cost' && kind !== 'flow.cost') return undefined;
  if (effect.appliesTo !== undefined && effect.appliesTo !== 'self' && effect.host !== 'self') {
    judgeRequired(`${String(kind)} ${String(effect.instanceId ?? index)} only supports the source host`);
  }
  const instance = stableId(effect.instanceId, `${program.canonicalCardId}:${String(kind)}:${index}`);
  const rawCost = effect.cost === undefined ? undefined : record(effect.cost);
  if (effect.cost !== undefined && rawCost === undefined) judgeRequired(`${String(kind)} ${instance} has an invalid cost`);
  const keyword = kind === 'accelerate.cost' ? 'accelerate' : kind === 'repeat.cost' ? 'repeat' : undefined;
  const cost = rawCost === undefined ? undefined : componentCost(rawCost, keyword);
  if (kind === 'accelerate.cost') {
    return { optional: { id: instance, kind: 'accelerate', ...(cost === undefined ? {} : { cost }), selected: undefined } };
  }
  if (kind === 'repeat.cost') {
    if (cost === undefined || normalizedKind(cost.kind) === 'repeat') {
      judgeRequired(`Repeat ${instance} has no printed cost; it cannot become free`);
    }
    return { optional: { id: instance, kind: 'repeat', cost } };
  }
  if (cost === undefined) judgeRequired(`Flow ${instance} has no printed cost`);
  return { modification: { kind: 'flow', id: instance, cost } };
}

/** Translate only the base CostSpec. Additional-cost declarations use bindProgramCost. */
export function translateCost(cost: CostSpec | undefined, id: string, mode: CostMode): CostPlanInput['cost'] | undefined {
  if (cost === undefined) return mode === 'activate' ? {} : undefined;
  const raw = record(cost);
  if (!raw) judgeRequired(`Invalid ${mode} cost on ${id}`);
  if (directAdditional(raw)) judgeRequired(`Additional costs require the program cost adapter on ${id}`);
  return normalizeBaseCost(raw, id, mode);
}

/** Build the complete Finalize input from a card's original program and source snapshot. */
export function bindProgramCost(input: ProgramCostBindingInput): ProgramCostBinding | undefined {
  const { program, source, mode, id, ability, abilities = [] } = input;
  const rawCost = ability?.cost === undefined ? undefined : record(ability.cost);
  if (ability?.cost !== undefined && rawCost === undefined) judgeRequired(`Invalid ${mode} cost on ${id}`);
  const optionalAdditional: OptionalCostInput[] = [];
  const mandatoryAdditional: CostComponentInput[] = [];
  const baseModifications: BaseCostModification[] = [];
  const seen = new Set<string>();

  const add = (componentId: string, optional?: OptionalCostInput, mandatory?: CostComponentInput): void => {
    if (seen.has(componentId)) judgeRequired(`Duplicate additional cost id ${componentId}`);
    seen.add(componentId);
    if (optional) optionalAdditional.push(optional);
    if (mandatory) mandatoryAdditional.push(mandatory);
  };

  let base: CostPlanInput['cost'] | undefined;
  if (rawCost && directAdditional(rawCost)) {
    base = directBaseCost(rawCost, program) ?? { kind: 'printed' };
    const nested = rawCost.additional ?? rawCost['additional-cost'];
    if (nested !== undefined) {
      const entries = Array.isArray(nested) ? nested : [nested];
      entries.forEach((entry, index) => {
        const value = record(entry);
        if (!value) judgeRequired(`${id} additional cost ${index} must be an object`);
        const merged = { ...rawCost, ...value, kind: value.kind ?? rawCost.kind };
        appendComponents(merged, program, `${id}:additional:${index}`, add, true);
      });
    } else {
      appendComponents(rawCost, program, `${program.canonicalCardId}:${mode}:additional`, add, true);
    }
  } else if (rawCost) {
    base = normalizeBaseCost(rawCost, id, mode);
  } else if (mode === 'play') {
    base = { kind: 'printed' };
  }

  if (mode === 'play') {
    abilities.forEach((expanded, index) => {
      const declaration = staticAdditional(expanded, program, index);
      if (declaration) {
        appendComponents(declaration, program, `${program.canonicalCardId}:additional:${index}`, add);
      }
      const keyword = keywordCost(expanded, program, index);
      if (keyword?.optional) add(keyword.optional.id, keyword.optional);
      if (keyword?.modification) {
        if (source.zone === 'trash') baseModifications.push(keyword.modification);
      }
    });
  }

  if (base === undefined && optionalAdditional.length === 0 && mandatoryAdditional.length === 0 && baseModifications.length === 0) return undefined;
  if (baseModifications.length > 1) judgeRequired(`${id} has multiple applicable Flow costs`);
  return {
    plan: {
      cost: base ?? { kind: 'printed' },
      domains: source.power ?? [],
      ...(optionalAdditional.length ? { optionalAdditional } : {}),
      ...(mandatoryAdditional.length ? { mandatoryAdditional } : {}),
      ...(baseModifications.length ? { baseModifications } : {}),
    },
    additionalIds: [...optionalAdditional.map(item => item.id), ...mandatoryAdditional.map(item => item.id)],
  };
}
