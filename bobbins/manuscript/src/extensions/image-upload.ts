/**
 * Image Upload Extension for TipTap
 *
 * Wraps @tiptap/extension-image with:
 * - Paste handler for clipboard images
 * - Drag-and-drop handler for file drops
 * - Placeholder node while uploading
 *
 * Requires SDK to be passed via extension storage.
 */

import Image from '@tiptap/extension-image'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { BobbinrySDK } from '@bobbinry/sdk'

const imageUploadPluginKey = new PluginKey('imageUpload')

export interface ImageUploadOptions {
  sdk: BobbinrySDK
  projectId: string
}

async function uploadAndInsert(
  file: File,
  sdk: BobbinrySDK,
  projectId: string,
  view: any,
  pos: number
) {
  // Insert a placeholder
  const { state, dispatch } = view
  const placeholderSrc = URL.createObjectURL(file)

  const node = state.schema.nodes.image.create({
    src: placeholderSrc,
    alt: file.name,
    title: 'Uploading...',
  })

  const tr = state.tr.insert(pos, node)
  dispatch(tr)

  try {
    const result = await sdk.uploads.upload({
      file,
      projectId,
      context: 'editor',
    })

    // Replace placeholder with final URL
    const { state: newState } = view
    const { doc } = newState
    let replaced = false

    doc.descendants((n: any, p: number) => {
      if (!replaced && n.type.name === 'image' && n.attrs.src === placeholderSrc) {
        const updateTr = newState.tr.setNodeMarkup(p, undefined, {
          ...n.attrs,
          src: result.url,
          title: null,
        })
        view.dispatch(updateTr)
        replaced = true
        return false
      }
      return true
    })

    URL.revokeObjectURL(placeholderSrc)
  } catch (err) {
    console.error('[ImageUpload] Upload failed:', err)
    // Remove the placeholder on failure
    const { state: errorState } = view
    const { doc } = errorState
    doc.descendants((n: any, p: number) => {
      if (n.type.name === 'image' && n.attrs.src === placeholderSrc) {
        const deleteTr = errorState.tr.delete(p, p + n.nodeSize)
        view.dispatch(deleteTr)
        return false
      }
      return true
    })
    URL.revokeObjectURL(placeholderSrc)
  }
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

export const ImageUpload = Image.extend({
  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() || []
    const extensionOptions = this.options as any as ImageUploadOptions

    return [
      ...parentPlugins,
      new Plugin({
        key: imageUploadPluginKey,
        props: {
          handlePaste(view, event) {
            const items = event.clipboardData?.items
            if (!items) return false

            for (const item of items) {
              if (item.type.startsWith('image/')) {
                event.preventDefault()
                const file = item.getAsFile()
                if (file) {
                  const pos = view.state.selection.from
                  uploadAndInsert(file, extensionOptions.sdk, extensionOptions.projectId, view, pos)
                }
                return true
              }
            }
            return false
          },

          handleDrop(view, event) {
            const files = event.dataTransfer?.files
            if (!files || files.length === 0) return false

            const imageFiles = Array.from(files).filter(isImageFile)
            if (imageFiles.length === 0) return false

            event.preventDefault()
            const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!coordinates) return false

            for (const file of imageFiles) {
              uploadAndInsert(file, extensionOptions.sdk, extensionOptions.projectId, view, coordinates.pos)
            }
            return true
          },
        },
      }),
    ]
  },
})

export default ImageUpload
