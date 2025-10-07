/**
 * Stripe Webhook Types
 */

export interface StripeWebhookEvent {
  id: string
  type: string
  data: {
    object: StripeSubscription | StripeInvoice | StripeCharge
  }
  created: number
}

export interface StripeSubscription {
  id: string
  customer: string
  status: 'active' | 'past_due' | 'canceled' | 'unpaid'
  current_period_start: number
  current_period_end: number
  cancel_at_period_end: boolean
  items: {
    data: Array<{
      id: string
      price: {
        id: string
      }
    }>
  }
  metadata?: Record<string, string>
}

export interface StripeInvoice {
  id: string
  customer: string
  subscription: string
  amount_paid: number
  currency: string
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
  payment_intent?: string
  metadata?: Record<string, string>
}

export interface StripeCharge {
  id: string
  amount: number
  amount_refunded: number
  currency: string
  customer: string
  refunded: boolean
  metadata?: Record<string, string>
}
