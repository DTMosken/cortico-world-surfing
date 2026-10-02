import type { WorldDefinition } from 'cortico/world.ts';
import { SURFING_DEFAULTS, validateConfig, type SurfingConfigSection } from './config.ts';
import { SurfingWorld } from './world.ts';

export const SURFING: WorldDefinition<SurfingConfigSection> = {
  id: 'surfing', label: 'Surfing · 网页与视频阅读',
  defaults: () => structuredClone(SURFING_DEFAULTS),
  preflight: ctx => validateConfig(ctx.cfg),
  create: ctx => new SurfingWorld(ctx),
};
