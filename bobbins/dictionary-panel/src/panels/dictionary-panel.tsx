'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useMessageBus } from '@bobbinry/sdk'

type TabId = 'dictionary' | 'thesaurus'

interface DictionaryPhonetic {
  text?: string
  audio?: string
}

interface DictionaryDefinition {
  definition: string
  example?: string
}

interface DictionaryMeaning {
  partOfSpeech?: string
  definitions?: DictionaryDefinition[]
}

interface DictionaryEntry {
  word: string
  phonetics?: DictionaryPhonetic[]
  meanings?: DictionaryMeaning[]
  sourceUrls?: string[]
}

interface ThesaurusResult {
  synonyms: string[]
  antonyms: string[]
}

interface SelectionMessage {
  data?: {
    text?: string
  }
}

const INITIAL_STATUS = 'Select a single word in the editor to look it up.'

function normalizeWord(value: string | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[^a-zA-Z\-']/g, '')
}

function getSafeExternalUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
  } catch {}
  return null
}

export default function DictionaryPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('dictionary')
  const [selectedWord, setSelectedWord] = useState('')
  const [status, setStatus] = useState(INITIAL_STATUS)
  const [loading, setLoading] = useState(false)
  const [dictionaryData, setDictionaryData] = useState<DictionaryEntry[] | null>(null)
  const [thesaurusData, setThesaurusData] = useState<ThesaurusResult | null>(null)
  const cacheRef = useRef<Record<string, { dictionary: DictionaryEntry[] | null; thesaurus: ThesaurusResult }>>({})
  const lastWordRef = useRef('')

  const fetchResults = useCallback(async (word: string) => {
    if (cacheRef.current[word]) {
      setDictionaryData(cacheRef.current[word].dictionary)
      setThesaurusData(cacheRef.current[word].thesaurus)
      setStatus('')
      return
    }

    setLoading(true)
    setStatus('')
    try {
      const [dictionaryResponse, synonymResponse, antonymResponse] = await Promise.all([
        fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`),
        fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=20`),
        fetch(`https://api.datamuse.com/words?rel_ant=${encodeURIComponent(word)}&max=12`),
      ])

      const dictionary = dictionaryResponse.ok ? await dictionaryResponse.json() as DictionaryEntry[] : null
      const synonyms = synonymResponse.ok ? await synonymResponse.json() as Array<{ word: string }> : []
      const antonyms = antonymResponse.ok ? await antonymResponse.json() as Array<{ word: string }> : []
      const thesaurus = {
        synonyms: synonyms.map((entry) => entry.word),
        antonyms: antonyms.map((entry) => entry.word),
      }

      cacheRef.current[word] = { dictionary, thesaurus }
      setDictionaryData(dictionary)
      setThesaurusData(thesaurus)
      if (!dictionary?.length && !thesaurus.synonyms.length && !thesaurus.antonyms.length) {
        setStatus('No definition, synonyms, or antonyms found for this word.')
      }
    } catch {
      setStatus('Lookup failed. Check your connection and try again.')
      setDictionaryData(null)
      setThesaurusData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLookup = useCallback((rawWord: string | undefined) => {
    const word = normalizeWord(rawWord)
    if (!word || word.includes(' ')) {
      setSelectedWord('')
      setDictionaryData(null)
      setThesaurusData(null)
      setStatus(INITIAL_STATUS)
      return
    }

    if (word === lastWordRef.current) {
      return
    }

    lastWordRef.current = word
    setSelectedWord(word)
    void fetchResults(word)
  }, [fetchResults])

  useMessageBus('manuscript.editor.selection.v1', (message: SelectionMessage) => {
    handleLookup(message?.data?.text)
  })

  const dictionaryEntry = dictionaryData?.[0] || null
  const phonetic = dictionaryEntry?.phonetics?.find((entry) => entry.text)
  const audioUrl = getSafeExternalUrl(dictionaryEntry?.phonetics?.find((entry) => entry.audio)?.audio)
  const sourceUrl = getSafeExternalUrl(dictionaryEntry?.sourceUrls?.[0])

  const thesaurusSummary = useMemo(() => {
    return {
      synonyms: thesaurusData?.synonyms || [],
      antonyms: thesaurusData?.antonyms || [],
    }
  }, [thesaurusData])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2">
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-900 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('dictionary')}
            className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'dictionary'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Dictionary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('thesaurus')}
            className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'thesaurus'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Thesaurus
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            Looking up “{selectedWord}”...
          </div>
        ) : status ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400">
            <p>{status}</p>
          </div>
        ) : activeTab === 'dictionary' ? (
          dictionaryEntry ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{dictionaryEntry.word}</h3>
                    {phonetic?.text && (
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{phonetic.text}</p>
                    )}
                  </div>
                  {audioUrl && (
                    <button
                      type="button"
                      onClick={() => void new Audio(audioUrl).play().catch(() => {})}
                      className="rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800"
                    >
                      Play
                    </button>
                  )}
                </div>
              </div>

              {(dictionaryEntry.meanings || []).map((meaning, index) => (
                <div key={`${meaning.partOfSpeech || 'meaning'}-${index}`} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {meaning.partOfSpeech || 'Meaning'}
                  </p>
                  <ol className="space-y-2">
                    {(meaning.definitions || []).slice(0, 4).map((definition, definitionIndex) => (
                      <li
                        key={`${definition.definition}-${definitionIndex}`}
                        className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
                      >
                        <p className="text-sm text-gray-900 dark:text-gray-100">{definition.definition}</p>
                        {definition.example && (
                          <p className="mt-2 text-xs italic text-gray-500 dark:text-gray-400">
                            “{definition.example}”
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}

              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Source: Wiktionary
                </a>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">No definition found for “{selectedWord}”.</div>
          )
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Synonyms</p>
              {thesaurusSummary.synonyms.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {thesaurusSummary.synonyms.map((word) => (
                    <button
                      key={`syn-${word}`}
                      type="button"
                      onClick={() => handleLookup(word)}
                      className="rounded-full bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs text-blue-700 dark:text-blue-200"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No synonyms found.</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Antonyms</p>
              {thesaurusSummary.antonyms.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {thesaurusSummary.antonyms.map((word) => (
                    <button
                      key={`ant-${word}`}
                      type="button"
                      onClick={() => handleLookup(word)}
                      className="rounded-full bg-rose-50 dark:bg-rose-900/30 px-2.5 py-1 text-xs text-rose-700 dark:text-rose-200"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No antonyms found.</p>
              )}
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Source: Datamuse API
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
