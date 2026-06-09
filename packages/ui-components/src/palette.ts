/**
 * Shared color palette for entities and chapters.
 *
 * Token-based, not free-form hex — keeps the UI looking deliberate and lets us
 * swap Tailwind tints in one place.
 *
 * Note: avoids Tailwind families that this theme overrides in globals.css
 * (blue, purple, green, red) so palette colors stay distinct from primary UI accents.
 */

export const PALETTE_TOKENS = [
  'slate',
  'rose',
  'orange',
  'amber',
  'yellow',
  'lime',
  'emerald',
  'teal',
  'sky',
  'indigo',
  'violet',
  'fuchsia',
] as const

export type PaletteToken = (typeof PALETTE_TOKENS)[number]

export interface PaletteClasses {
  /** Solid background — used for the left stripe in nav rows and the editor top stripe. */
  stripe: string
  /** Text color — used to tint the chapter icon. */
  iconText: string
  /** Filled disc background — used for featured-character chips. */
  chipBg: string
  /** Border ring for chips and swatches. */
  chipBorder: string
  /** Top border for outline cards. */
  cardBorder: string
  /** Solid swatch background for color pickers. */
  swatchBg: string
  /** Human-readable label. */
  label: string
}

const TABLE: Record<PaletteToken, PaletteClasses> = {
  slate:   { stripe: 'bg-slate-400',   iconText: 'text-slate-500',   chipBg: 'bg-slate-400',   chipBorder: 'ring-slate-300',   cardBorder: 'border-t-slate-400',   swatchBg: 'bg-slate-400',   label: 'Slate'   },
  rose:    { stripe: 'bg-rose-500',    iconText: 'text-rose-500',    chipBg: 'bg-rose-500',    chipBorder: 'ring-rose-300',    cardBorder: 'border-t-rose-500',    swatchBg: 'bg-rose-500',    label: 'Rose'    },
  orange:  { stripe: 'bg-orange-500',  iconText: 'text-orange-600',  chipBg: 'bg-orange-500',  chipBorder: 'ring-orange-300',  cardBorder: 'border-t-orange-500',  swatchBg: 'bg-orange-500',  label: 'Orange'  },
  amber:   { stripe: 'bg-amber-500',   iconText: 'text-amber-600',   chipBg: 'bg-amber-500',   chipBorder: 'ring-amber-300',   cardBorder: 'border-t-amber-500',   swatchBg: 'bg-amber-500',   label: 'Amber'   },
  yellow:  { stripe: 'bg-yellow-400',  iconText: 'text-yellow-600',  chipBg: 'bg-yellow-400',  chipBorder: 'ring-yellow-300',  cardBorder: 'border-t-yellow-400',  swatchBg: 'bg-yellow-400',  label: 'Yellow'  },
  lime:    { stripe: 'bg-lime-500',    iconText: 'text-lime-600',    chipBg: 'bg-lime-500',    chipBorder: 'ring-lime-300',    cardBorder: 'border-t-lime-500',    swatchBg: 'bg-lime-500',    label: 'Lime'    },
  emerald: { stripe: 'bg-emerald-500', iconText: 'text-emerald-600', chipBg: 'bg-emerald-500', chipBorder: 'ring-emerald-300', cardBorder: 'border-t-emerald-500', swatchBg: 'bg-emerald-500', label: 'Emerald' },
  teal:    { stripe: 'bg-teal-500',    iconText: 'text-teal-600',    chipBg: 'bg-teal-500',    chipBorder: 'ring-teal-300',    cardBorder: 'border-t-teal-500',    swatchBg: 'bg-teal-500',    label: 'Teal'    },
  sky:     { stripe: 'bg-sky-500',     iconText: 'text-sky-600',     chipBg: 'bg-sky-500',     chipBorder: 'ring-sky-300',     cardBorder: 'border-t-sky-500',     swatchBg: 'bg-sky-500',     label: 'Sky'     },
  indigo:  { stripe: 'bg-indigo-500',  iconText: 'text-indigo-500',  chipBg: 'bg-indigo-500',  chipBorder: 'ring-indigo-300',  cardBorder: 'border-t-indigo-500',  swatchBg: 'bg-indigo-500',  label: 'Indigo'  },
  violet:  { stripe: 'bg-violet-500',  iconText: 'text-violet-500',  chipBg: 'bg-violet-500',  chipBorder: 'ring-violet-300',  cardBorder: 'border-t-violet-500',  swatchBg: 'bg-violet-500',  label: 'Violet'  },
  fuchsia: { stripe: 'bg-fuchsia-500', iconText: 'text-fuchsia-500', chipBg: 'bg-fuchsia-500', chipBorder: 'ring-fuchsia-300', cardBorder: 'border-t-fuchsia-500', swatchBg: 'bg-fuchsia-500', label: 'Fuchsia' },
}

export function isPaletteToken(value: unknown): value is PaletteToken {
  return typeof value === 'string' && (PALETTE_TOKENS as readonly string[]).includes(value)
}

/**
 * Return the Tailwind class bundle for a token, or `null` if the token is missing/invalid.
 * Callers should handle the null case (e.g. omit the stripe entirely).
 */
export function paletteClasses(token: PaletteToken | null | undefined): PaletteClasses | null {
  if (!token || !isPaletteToken(token)) return null
  return TABLE[token]
}
