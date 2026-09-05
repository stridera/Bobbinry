import type { SaveStatus } from '../lib/editor-types'

/** The small status dot next to the word count. */
export function SaveIndicator({ status, focusMode }: { status: SaveStatus; focusMode: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 transition-opacity duration-300 ${focusMode ? 'opacity-20 hover:opacity-50' : 'opacity-60 hover:opacity-100'}`}>
      {status === 'dirty' && (
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" title="Unsaved changes" />
      )}
      {status === 'saving' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title="Saving..." />
      )}
      {status === 'saved' && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="Saved" />
      )}
      {status === 'error' && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" title="Save failed — will retry" />
      )}
      {status === 'offline' && (
        <span className="flex items-center gap-1" title="Offline — changes saved locally">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
          <span className="text-[10px] text-orange-400 font-medium">Offline</span>
        </span>
      )}
      {status === 'auth' && (
        <span className="flex items-center gap-1" title="Signed out — changes are saved on this device only">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] text-red-500 font-medium">Not syncing</span>
        </span>
      )}
      {status === 'conflict' && (
        <span className="flex items-center gap-1" title="Conflict — this scene was edited elsewhere">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className="text-[10px] text-red-500 font-medium">Conflict</span>
        </span>
      )}
    </div>
  )
}
