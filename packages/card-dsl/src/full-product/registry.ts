import type { FullProductEffectIr } from "./types.js";
import { validateFullProductEffectIr } from "./types.js";

export interface FullProductRegisteredEffect {
  readonly ir: FullProductEffectIr;
}

export class FullProductEffectRegistry {
  private readonly effects = new Map<string, FullProductRegisteredEffect>();

  register(input: unknown): FullProductRegisteredEffect {
    const result = validateFullProductEffectIr(input);
    if (!result.ok) {
      throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
    }
    if (this.effects.has(result.value.id)) {
      throw new Error(`Effect ${result.value.id} is already registered`);
    }
    const registered = { ir: result.value };
    this.effects.set(result.value.id, registered);
    return registered;
  }

  registerCardEffect(cardId: string, input: unknown): FullProductRegisteredEffect {
    const result = validateFullProductEffectIr(input);
    if (!result.ok) {
      throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
    }
    if (result.value.id !== cardId) {
      throw new Error(`Effect id ${result.value.id} does not match card id ${cardId}`);
    }
    return this.register(result.value);
  }

  has(cardId: string): boolean {
    return this.effects.has(cardId);
  }

  get(cardId: string): FullProductRegisteredEffect | undefined {
    return this.effects.get(cardId);
  }

  listCardIds(): readonly string[] {
    return [...this.effects.keys()].sort();
  }
}

export function createFullProductEffectRegistry(): FullProductEffectRegistry {
  return new FullProductEffectRegistry();
}
