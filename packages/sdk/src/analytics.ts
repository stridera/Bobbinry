/**
 * Product analytics for the shell and bobbins.
 *
 * Bobbins need to report events (a chapter getting published is our best
 * engagement signal) but must not depend on whichever analytics vendor the
 * shell happens to use. So the SDK owns a vendor-neutral trackEvent, and the
 * shell registers the real implementation at startup via setAnalyticsSink.
 * Swapping vendors is then a one-file change in the shell.
 *
 * Event names are a closed union so a typo fails typecheck rather than
 * silently creating a junk event that nobody notices until the funnel is
 * missing a step.
 */

export type AnalyticsEvent =
  // Author funnel: land -> sign up -> create -> publish -> pay
  | 'signup_completed'
  | 'project_created'
  | 'chapter_published'
  | 'checkout_started'
  // Reader engagement
  | 'chapter_view_started'
  | 'chapter_completed'
  | 'reaction_added'
  | 'comment_posted'
  | 'project_followed'

/**
 * Event properties. Deliberately narrow: ids, counts and enums only. Never put
 * titles, emails, or anything a reader wrote in here — it leaves our servers.
 */
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>

export type AnalyticsSink = (name: AnalyticsEvent, props?: AnalyticsProps) => void

let sink: AnalyticsSink | null = null

/**
 * Events fired before the sink registers. Bobbin panels can mount before the
 * shell finishes initialising analytics, and the first events after a cold load
 * are the interesting ones, so buffer rather than drop. Bounded so a missing
 * sink can't grow unboundedly in a long-lived tab.
 */
const pending: Array<{ name: AnalyticsEvent; props: AnalyticsProps | undefined }> = []
const MAX_PENDING = 50

/**
 * Register the real analytics implementation and flush anything buffered.
 * Pass null to detach (used on unmount so a stale sink can't outlive its
 * provider during a hot reload).
 */
export function setAnalyticsSink(fn: AnalyticsSink | null): void {
  sink = fn
  if (!fn) return

  const buffered = pending.splice(0, pending.length)
  for (const event of buffered) {
    try {
      fn(event.name, event.props)
    } catch {
      // Analytics must never break the app it measures.
    }
  }
}

/** Report a product event. Safe to call during SSR and before init. */
export function trackEvent(name: AnalyticsEvent, props?: AnalyticsProps): void {
  if (typeof window === 'undefined') return

  if (!sink) {
    if (pending.length < MAX_PENDING) pending.push({ name, props })
    return
  }

  try {
    sink(name, props)
  } catch {
    // Analytics must never break the app it measures.
  }
}
