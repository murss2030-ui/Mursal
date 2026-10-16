/**
 * Visual identity of the eight Clinical Modules. Each module has an icon and
 * a hue; the module title is always written beside them, so colour is never
 * the only cue. Text uses the 800 shade on the 50 background (contrast above 7:1).
 */
import type { ModuleId } from '../domain/workflow/catalogue';
import type { IconName } from './components/Icon';

export interface ModuleStyle {
  icon: IconName;
  text: string;
  soft: string;
  border: string;
  bar: string;
  ring: string;
  solid: string;
}

export const MODULE_STYLE: Record<ModuleId, ModuleStyle> = {
  collect: { icon: 'folder', text: 'text-sky-800', soft: 'bg-sky-50', border: 'border-sky-200', bar: 'bg-sky-600', ring: 'stroke-sky-600', solid: 'bg-sky-700' },
  review: { icon: 'pill', text: 'text-teal-800', soft: 'bg-teal-50', border: 'border-teal-200', bar: 'bg-teal-600', ring: 'stroke-teal-600', solid: 'bg-teal-700' },
  dosing: { icon: 'scale', text: 'text-indigo-800', soft: 'bg-indigo-50', border: 'border-indigo-200', bar: 'bg-indigo-600', ring: 'stroke-indigo-600', solid: 'bg-indigo-700' },
  safety: { icon: 'shield', text: 'text-rose-800', soft: 'bg-rose-50', border: 'border-rose-200', bar: 'bg-rose-600', ring: 'stroke-rose-600', solid: 'bg-rose-700' },
  plan: { icon: 'target', text: 'text-amber-800', soft: 'bg-amber-50', border: 'border-amber-200', bar: 'bg-amber-500', ring: 'stroke-amber-500', solid: 'bg-amber-700' },
  followup: { icon: 'activity', text: 'text-emerald-800', soft: 'bg-emerald-50', border: 'border-emerald-200', bar: 'bg-emerald-600', ring: 'stroke-emerald-600', solid: 'bg-emerald-700' },
  discharge: { icon: 'door', text: 'text-violet-800', soft: 'bg-violet-50', border: 'border-violet-200', bar: 'bg-violet-600', ring: 'stroke-violet-600', solid: 'bg-violet-700' },
  document: { icon: 'graduation', text: 'text-slate-800', soft: 'bg-slate-100', border: 'border-slate-300', bar: 'bg-slate-600', ring: 'stroke-slate-600', solid: 'bg-slate-700' },
};
