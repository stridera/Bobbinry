import { Extension, InputRule } from '@tiptap/core'

export interface SmartTypographyOptions {
  dashes: boolean
  ellipsis: boolean
}

export interface SmartTypographyStorage {
  dashes: boolean
  ellipsis: boolean
}

export const SmartTypography = Extension.create<SmartTypographyOptions, SmartTypographyStorage>({
  name: 'smartTypography',

  addOptions() {
    return {
      dashes: false,
      ellipsis: false,
    }
  },

  addStorage() {
    return {
      dashes: this.options.dashes,
      ellipsis: this.options.ellipsis,
    }
  },

  addInputRules() {
    const storage = this.storage
    return [
      new InputRule({
        find: /--$/,
        handler: ({ state, range }) => {
          if (!storage.dashes) return null
          state.tr.insertText('—', range.from, range.to)
          return
        },
      }),
      new InputRule({
        find: /\.\.\.$/,
        handler: ({ state, range }) => {
          if (!storage.ellipsis) return null
          state.tr.insertText('…', range.from, range.to)
          return
        },
      }),
    ]
  },
})
