import type { ScenePlan } from '../protocol/plan';
import { REFERENCE_SCENE_SOURCES } from './generated';

/** A hand-written, reviewed scene: the gold standard for one concept. */
export interface ReferenceScene {
  readonly id: string;
  readonly html: string;
  readonly css: string;
  readonly js: string;
  readonly plan: ScenePlan;
}

export const REFERENCE_SCENES: Readonly<Record<string, ReferenceScene>> = REFERENCE_SCENE_SOURCES;

export function referenceScene(id: string): ReferenceScene | undefined {
  return Object.hasOwn(REFERENCE_SCENES, id) ? REFERENCE_SCENES[id] : undefined;
}

export function referenceSceneIds(): string[] {
  return Object.keys(REFERENCE_SCENES).sort();
}
