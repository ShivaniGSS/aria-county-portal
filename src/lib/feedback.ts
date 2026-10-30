/**
 * Engineer feedback on individual records, kept in the browser and exported as JSON for the team.
 * The portal is a static site; when it moves to a server this is the one place to swap for an API call.
 */
import { useCallback, useEffect, useState } from 'react'

export interface FeedbackItem {
  verdict: 'correct' | 'wrong' | 'missing' | null
  note: string
  at?: string
}

const KEY = 'aria-asset-feedback-v1'
const EVT = 'aria-feedback-changed'

function load(): Record<string, FeedbackItem> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export function useFeedback() {
  const [items, setItems] = useState<Record<string, FeedbackItem>>(load)
  useEffect(() => {
    const h = () => setItems(load())
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])
  const set = useCallback((id: string, v: FeedbackItem) => {
    const next = { ...load(), [id]: { ...v, at: new Date().toISOString() } }
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage blocked: feedback lives for this session only */
    }
    setItems(next)
    window.dispatchEvent(new Event(EVT))
  }, [])
  return { items, set }
}
