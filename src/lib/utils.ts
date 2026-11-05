import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Tokens de color admitidos en los catálogos (ver globals.css). */
export const TONES = [
  'slate', 'sky', 'cyan', 'blue', 'violet', 'amber',
  'orange', 'emerald', 'green', 'red', 'pink', 'teal',
] as const

export type Tone = (typeof TONES)[number]

export function toneClass(tone: string | null | undefined) {
  const t = (tone ?? 'slate') as Tone
  return TONES.includes(t) ? `tone-${t}` : 'tone-slate'
}
