/**
 * Entity Templates - Pre-configured entity types
 */

import type { EntityTemplate } from '../types'

// Import all templates
import { charactersTemplate } from './characters'
import { spellsTemplate } from './spells'
import { locationsTemplate } from './locations'
import { itemsTemplate } from './items'
import { classesTemplate } from './classes'
import { factionsTemplate } from './factions'
import { racesTemplate } from './races'

export const templates: EntityTemplate[] = [
  charactersTemplate,
  spellsTemplate,
  locationsTemplate,
  itemsTemplate,
  classesTemplate,
  factionsTemplate,
  racesTemplate
]

export {
  charactersTemplate,
  spellsTemplate,
  locationsTemplate,
  itemsTemplate,
  classesTemplate,
  factionsTemplate,
  racesTemplate
}
