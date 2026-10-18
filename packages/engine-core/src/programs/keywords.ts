import { validateCardProgram, type Ability, type CardProgram } from '@riftbound/card-dsl';
import type { ObjectSnapshot } from '../effects/contract.js';
import { keywordDefinitionsById } from '../effects/keywords/registry.generated.js';
import type { KeywordDef } from '../effects/keyword-contract.js';
import { ProgramBindingError } from './errors.js';

type KeywordParams = NonNullable<Extract<Ability, { kind: 'keyword' }>['params']>;

interface KeywordEntry {
  readonly keyword: string;
  readonly value?: number;
  readonly params?: KeywordParams;
}

function paramsOf(value: unknown): KeywordParams | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as KeywordParams;
}

function withInstanceId(params: KeywordParams | undefined, instanceId: string | undefined): KeywordParams | undefined {
  if (params?.instanceId !== undefined || instanceId === undefined) return params;
  return { ...(params ?? {}), instanceId } as KeywordParams;
}

function normalizeKeywordId(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '-');
}

export interface ExpandedProgram {
  readonly declared: readonly Ability[];
  readonly expanded: readonly Ability[];
  readonly abilities: readonly Ability[];
}

function definitionFor(keyword: string): KeywordDef {
  const wanted = normalizeKeywordId(keyword);
  const found = [...keywordDefinitionsById.entries()].find(([id, def]) => normalizeKeywordId(id) === wanted || normalizeKeywordId(def.keyword) === wanted);
  if (!found) throw new ProgramBindingError('judge-required', `Keyword ${keyword} has no executable KeywordDef`);
  return found[1] as KeywordDef;
}

export function expandProgram(program: CardProgram, source: ObjectSnapshot): ExpandedProgram {
  const declared = [...program.abilities];
  // ObjectSnapshot predates the additive keyword-parameter contract. Read the
  // optional field structurally so old projections and replay logs remain
  // valid while newer projections can carry printed costs and正文 metadata.
  const printed = source.keywords.map(keyword => {
    const entry = keyword as typeof keyword & { readonly params?: unknown };
    return { keyword: entry.id, value: entry.value, params: paramsOf(entry.params) };
  });
  const declaredKeywords = declared.filter((ability): ability is Extract<Ability, { kind: 'keyword' }> => ability.kind === 'keyword');
  const entries: KeywordEntry[] = [
    ...declaredKeywords.map(ability => ({ keyword: ability.keyword, value: ability.value, params: ability.params })),
    ...printed
  ];
  const grouped = new Map<string, { keyword: string; entries: KeywordEntry[] }>();
  for (const entry of entries) {
    const key = normalizeKeywordId(entry.keyword);
    const current = grouped.get(key) ?? { keyword: entry.keyword, entries: [] };
    current.entries.push(entry);
    grouped.set(key, current);
  }
  const expanded: Ability[] = [];
  for (const group of grouped.values()) {
    const def = definitionFor(group.keyword);
    const values = group.entries.map(entry => entry.value);
    const host = { canonicalCardId: source.cardId ?? program.canonicalCardId };
    // Preserve the legacy ids for a lone keyword instance.  Additive instance
    // ids are needed only when separate instances would otherwise share body,
    // target, or link ids; this keeps old snapshots and direct production
    // answers addressable while making repeated printed keywords independent.
    const instanceIdFor = def.stacking === 'separate' && group.entries.length > 1
      ? (index: number) => `keyword:${normalizeKeywordId(group.keyword)}:${host.canonicalCardId}:${index}`
      : () => undefined;
    const expandOne = (entry: KeywordEntry, index: number): readonly Ability[] => def.expand({
      value: def.valued ? entry.value : undefined,
      host,
      // Production expansion supplies a stable instance id so separate
      // keyword copies cannot share links or instruction ids. Direct
      // KeywordDef callers retain their historical ids because this field is
      // injected only at the program boundary.
      params: withInstanceId(
        entry.params,
        instanceIdFor(index)
      )
    });
    if (def.stacking === 'sum') {
      const value = values.reduce<number>((sum, item) => sum + (item ?? (def.valued ? 1 : 0)), 0);
      const entry = group.entries.find(candidate => candidate.params !== undefined) ?? group.entries[0];
      expanded.push(...def.expand({
        value: def.valued ? value : undefined,
        host,
        params: withInstanceId(
          entry?.params,
          instanceIdFor(0)
        )
      }));
    } else if (def.stacking === 'single') {
      const entry = group.entries[0];
      if (entry === undefined) throw new ProgramBindingError('judge-required', `Keyword ${group.keyword} has no instances`);
      expanded.push(...expandOne(entry, 0));
    } else {
      group.entries.forEach((entry, index) => expanded.push(...expandOne(entry, index)));
    }
  }
  if (expanded.length) {
    const result = validateCardProgram({
      canonicalCardId: program.canonicalCardId,
      rulesetVersion: program.rulesetVersion,
      status: 'executable',
      sourceText: '[keyword expansion]',
      abilities: expanded
    });
    if (!result.ok) throw new ProgramBindingError('judge-required', `Keyword expansion for ${program.canonicalCardId} is not executable`, result.issues);
  }
  return { declared, expanded, abilities: [...declared, ...expanded] };
}

export function abilitySpeed(abilities: readonly Ability[], source: ObjectSnapshot): 'normal' | 'action' | 'reaction' {
  const names = new Set<string>();
  for (const ability of abilities) if (ability.kind === 'keyword') names.add(normalizeKeywordId(ability.keyword));
  for (const keyword of source.keywords) names.add(normalizeKeywordId(keyword.id));
  if (names.has('reaction')) return 'reaction';
  if (names.has('action')) return 'action';
  return 'normal';
}
