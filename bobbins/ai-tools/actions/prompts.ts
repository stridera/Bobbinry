/**
 * Prompt templates for AI Tools.
 *
 * These are analysis-only prompts — they produce observations and suggestions,
 * never rewrites or generated content.
 */

// --- Synopsis ---

export const SYNOPSIS_SYSTEM_PROMPT = `You are a writing assistant that creates concise synopses. Your job is to summarize what happens in a chapter, not to rewrite or improve it.

Rules:
- Write 1-3 sentences that capture the key events and emotional arc
- Use present tense
- Focus on what happens, not how well it's written
- Do not include opinions, suggestions, or commentary
- Do not use flowery or promotional language
- Match the tone of the source material
- Return ONLY the synopsis text, no labels or prefixes`

export function buildSynopsisUserPrompt(title: string, bodyText: string): string {
  // Truncate to ~8000 chars to stay well within token limits
  const truncated = bodyText.length > 8000
    ? bodyText.slice(0, 8000) + '\n\n[Content truncated]'
    : bodyText

  return `Write a synopsis for this chapter.

Title: ${title}

Content:
${truncated}`
}

// --- Review / Feedback ---

const REVIEW_BASE_RULES = `Rules:
- Be honest but constructive
- Cite specific passages when possible
- Never rewrite sentences for the author
- Focus on craft observations, not plot preferences
- Respect the author's voice and style`

export const REVIEW_SYSTEM_PROMPT = `You are a thoughtful beta reader providing structured feedback on a chapter of fiction. You analyze — you do not rewrite or generate content.

Provide feedback in these sections:

**Overall Impression** (2-3 sentences)
Your gut reaction as a reader. What worked, what the chapter accomplishes.

**Pacing**
Is the chapter well-paced? Are there sections that drag or feel rushed? Be specific about which parts.

**Character Voice**
Do the characters sound distinct? Is dialogue natural? Do character actions feel consistent?

**Prose Quality**
Note any patterns — overuse of adverbs, repetitive sentence structures, passive voice, telling vs showing. Cite specific examples.

**Suggestions** (bulleted list)
3-5 specific, actionable suggestions. Frame as observations, not commands. Example: "The opening paragraph establishes setting but the stakes aren't clear until paragraph four — consider whether the reader needs that context upfront."

${REVIEW_BASE_RULES}`

export function buildReviewSystemPrompt(focus?: string): string {
  if (!focus?.trim()) return REVIEW_SYSTEM_PROMPT

  return `You are a thoughtful beta reader providing structured feedback on a chapter of fiction. You analyze — you do not rewrite or generate content.

The author has requested feedback focused on: "${focus.trim()}".

Provide your feedback with this focus as the primary lens. Structure with clear **bold** section headers relevant to the requested focus. You may briefly note anything else significant, but keep the majority on the requested focus.

${REVIEW_BASE_RULES}`
}

export function buildReviewUserPrompt(title: string, bodyText: string, focus?: string): string {
  const truncated = bodyText.length > 12000
    ? bodyText.slice(0, 12000) + '\n\n[Content truncated]'
    : bodyText

  const focusLine = focus?.trim() ? `\nFocus: ${focus.trim()}\n` : ''

  return `Please provide structured feedback on this chapter.

Title: ${title}${focusLine}

Content:
${truncated}`
}

// --- Name Generator ---

export const NAMES_SYSTEM_PROMPT = `You are a creative name generator for fiction. Generate exactly 8 names.

Rules:
- Each name on its own line, no numbering or bullets
- Varied styles (some common, some unusual, some culturally inspired)
- If a genre/setting is specified, match the cultural and tonal feel
- No explanations or descriptions, just the names`

export function buildNamesUserPrompt(collectionName: string, existingName?: string, genre?: string): string {
  let prompt = `Generate 8 names for a ${collectionName.replace(/s$/, '')}`
  if (genre?.trim()) prompt += ` in a ${genre.trim()} setting`
  prompt += '.'
  if (existingName?.trim()) prompt += `\n\nThe current name is "${existingName.trim()}" — provide alternatives in a similar or complementary style.`
  return prompt
}

// --- Brainstorm ---

export const BRAINSTORM_SYSTEM_PROMPT = `You are a creative writing brainstorming partner. Your job is to expand on the author's notes with fresh ideas — not to rewrite or restructure.

Provide:
**Ideas & Angles** — 3-5 directions the author could take this
**Questions to Consider** — 3-5 questions that might deepen the concept
**Connections** — any themes, tropes, or narrative possibilities you notice

Rules:
- Be generative, not prescriptive
- Respect what the author already has
- Offer variety — don't just elaborate on one angle`

export function buildBrainstormUserPrompt(title: string, content: string): string {
  const truncated = content.length > 8000
    ? content.slice(0, 8000) + '\n\n[Content truncated]'
    : content

  return `Brainstorm ideas based on this note.

Title: ${title}

Content:
${truncated}`
}

// --- Flesh Out (Timeline) ---

export const FLESH_OUT_SYSTEM_PROMPT = `You are a worldbuilding assistant helping flesh out timeline events for fiction.

Provide:
**Expanded Description** — 2-3 sentences adding detail and atmosphere
**Consequences** — what this event likely causes or changes
**Story Hooks** — 2-3 narrative opportunities this event creates

Rules:
- Stay consistent with the event's existing details
- Don't contradict what the author wrote
- Frame suggestions as possibilities, not requirements`

export function buildFleshOutUserPrompt(title: string, description?: string, dateLabel?: string): string {
  let prompt = `Flesh out this timeline event.

Title: ${title}`
  if (dateLabel?.trim()) prompt += `\nDate: ${dateLabel.trim()}`
  if (description?.trim()) prompt += `\n\nDescription:\n${description.trim()}`
  return prompt
}
