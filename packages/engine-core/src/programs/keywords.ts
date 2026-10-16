import { validateCardProgram, type Ability, type CardProgram } from '@riftbound/card-dsl';
import type { ObjectSnapshot } from '../effects/contract.js';
import { keywordDefinitionsById } from '../effects/keywords/registry.generated.js';
import type { KeywordDef } from '../effects/keyword-contract.js';
import { ProgramBindingError } from './errors.js';

export interface ExpandedProgram {
  readonly declared: readonly Ability[];
  readonly expanded: readonly Ability[];
  readonly abilities: readonly Ability[];
}

function definitionFor(keyword: string): KeywordDef {
  const found = [...keywordDefinitionsById.entries()].find(([id, def]) => id.toLowerCase() === keyword.toLowerCase() || def.keyword.toLowerCase() === keyword.toLowerCase());
  if (!found) throw new ProgramBindingError('judge-required', `Keyword ${keyword} has no executable KeywordDef`);
  return found[1] as KeywordDef;
}

export function expandProgram(program: CardProgram, source: ObjectSnapshot): ExpandedProgram {
  const declared = [...program.abilities];
  const printed = source.keywords.map(keyword => ({ keyword: keyword.id, value: keyword.value }));
  const declaredKeywords = declared.filter((ability): ability is Extract<Ability, { kind: 'keyword' }> => ability.kind === 'keyword');
  const entries = [...declaredKeywords.map(ability => ({ keyword: ability.keyword, value: ability.value })), ...printed];
  const grouped = new Map<string, { keyword: string; values: (number | undefined)[] }>();
  for (const entry of entries) {
    const key = entry.keyword.toLowerCase();
    const current = grouped.get(key) ?? { keyword: entry.keyword, values: [] };
    current.values.push(entry.value);
    grouped.set(key, current);
  }
  const expanded: Ability[] = [];
  for (const group of grouped.values()) {
    const def = definitionFor(group.keyword);
    const values = group.values;
    if (def.stacking === 'sum') {
      const value = values.reduce<number>((sum, item) => sum + (item ?? (def.valued ? 1 : 0)), 0);
      expanded.push(...def.expand({ value: def.valued ? value : undefined, host: { canonicalCardId: source.cardId ?? program.canonicalCardId } }));
    } else if (def.stacking === 'single') {
      expanded.push(...def.expand({ value: values[0], host: { canonicalCardId: source.cardId ?? program.canonicalCardId } }));
    } else {
      for (const value of values) expanded.push(...def.expand({ value, host: { canonicalCardId: source.cardId ?? program.canonicalCardId } }));
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
  for (const ability of abilities) if (ability.kind === 'keyword') names.add(ability.keyword.toLowerCase());
  for (const keyword of source.keywords) names.add(keyword.id.toLowerCase());
  if (names.has('reaction')) return 'reaction';
  if (names.has('action')) return 'action';
  return 'normal';
}
