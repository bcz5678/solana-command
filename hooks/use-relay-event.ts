'use client'

import { useEffect, useRef } from 'react'
import type { RelayMessage } from '@/lib/wss/types'

type Listener = (msg: RelayMessage) => void

// Module-level so every component sharing the page shares one SSE connection
// instead of each opening its own — ref-counted open/close.
let source: EventSource | null = null
let refCount = 0
const listeners = new Set<Listener>()

function acquireSource() {
  refCount++
  if (source) return
  source = new EventSource('/api/wss/events')
  source.onmessage = (e) => {
    const msg: RelayMessage = JSON.parse(e.data)
    listeners.forEach((fn) => fn(msg))
  }
}

function releaseSource() {
  refCount--
  if (refCount > 0) return
  source?.close()
  source = null
}

/** Subscribes to one relay message type for the component's lifetime. */
export function useRelayEvent<T extends RelayMessage['type']>(
  type: T,
  handler: (msg: Extract<RelayMessage, { type: T }>) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const listener: Listener = (msg) => {
      if (msg.type === type) handlerRef.current(msg as Extract<RelayMessage, { type: T }>)
    }

    acquireSource()
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
      releaseSource()
    }
  }, [type])
}
