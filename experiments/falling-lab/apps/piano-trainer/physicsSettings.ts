import { configuration } from '../../core/physics.ts';

export type PhysicsSettings = { fallingSpeed: number; rewardStrength: number; unlockThreshold: number; completionThreshold: number };
export const DEFAULT_PHYSICS_SETTINGS: PhysicsSettings = { fallingSpeed: 1, rewardStrength: 25, unlockThreshold: 50, completionThreshold: 90 };
const key = 'piano-trainer.physics-settings';

export function physicsPatch(settings: PhysicsSettings) {
  return { motion: { topFallingSpeed: settings.fallingSpeed, kickHeightPercent: settings.rewardStrength }, unlock: { threshold: settings.unlockThreshold }, finish: { threshold: settings.completionThreshold } };
}
export function validPhysicsSettings(value: unknown): value is PhysicsSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as PhysicsSettings;
  if (![candidate.fallingSpeed, candidate.rewardStrength, candidate.unlockThreshold, candidate.completionThreshold].every(n => typeof n === 'number' && Number.isFinite(n))) return false;
  try { configuration(physicsPatch(candidate)); return true; } catch { return false; }
}
export function loadPhysicsSettings(): PhysicsSettings {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) || 'null'); if (validPhysicsSettings(value)) return value; } catch { /* Use defaults. */ }
  return { ...DEFAULT_PHYSICS_SETTINGS };
}
export function savePhysicsSettings(settings: PhysicsSettings) { try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Keep the session setting. */ } }
