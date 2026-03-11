import { describe, expect, it } from '@jest/globals'
import {
  getDeclaredCustomAction,
  isValidActionHandlerName,
  isValidActionId,
  isValidBobbinId
} from '../../bobbin-actions'

describe('bobbin action helpers', () => {
  it('validates bobbin and action identifiers used by the API route', () => {
    expect(isValidBobbinId('google-drive-backup')).toBe(true)
    expect(isValidBobbinId('../google-drive-backup')).toBe(false)
    expect(isValidActionId('sync_to_drive')).toBe(true)
    expect(isValidActionId('../../sync')).toBe(false)
  })

  it('validates exported handler names', () => {
    expect(isValidActionHandlerName('syncChapterToDrive')).toBe(true)
    expect(isValidActionHandlerName('sync-chapter')).toBe(false)
    expect(isValidActionHandlerName('../../evil')).toBe(false)
  })

  it('returns the declared custom action and handler from a manifest', () => {
    const manifest = {
      interactions: {
        actions: [
          { id: 'publish_chapter', type: 'custom', handler: 'publishChapter' },
          { id: 'archive_chapter', type: 'update' }
        ]
      }
    }

    expect(getDeclaredCustomAction(manifest, 'publish_chapter')).toEqual({
      id: 'publish_chapter',
      handler: 'publishChapter'
    })
    expect(getDeclaredCustomAction(manifest, 'archive_chapter')).toBeNull()
    expect(getDeclaredCustomAction(manifest, 'missing')).toBeNull()
  })
})
