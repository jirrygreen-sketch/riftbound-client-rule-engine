import type { InstructionDef, ResolveContext } from '../contract.js';
import { abilityArgsSchema, executeAbilityInstruction, type AbilityInstructionArgs } from '../../programs/ability-grants/instruction.js';

/** CR 765–767: scoped inactivity; never delete an ability from the object. */
const continuousIgnoreAbility = {
  op: 'continuous.ignore-ability',
  argsSchema: abilityArgsSchema('continuous.ignore-ability'),
  execute: (ctx: ResolveContext, args: AbilityInstructionArgs) => executeAbilityInstruction('continuous.ignore-ability', ctx, args),
} satisfies InstructionDef<AbilityInstructionArgs>;
export default continuousIgnoreAbility;
