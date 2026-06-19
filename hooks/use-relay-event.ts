'use client'

import { useEffect, useRef, useState } from 'react'
import type { RelayMessage } from '@/lib/wss/types'

type Listener = (msg: RelayMessage) => void
type StatusListener = (status: RelayConnectionStatus) => void

export type RelayConnectionStatus = 'connecting' | 'open' | 'closed'

// Module-level so every component sharing the page shares one SSE connection
// instead of each opening its own — ref-counted open/close.
let source: EventSource | null = null
let refCount = 0
let connectionStatus: RelayConnectionStatus = 'connecting'
const listeners = new Set<Listener>()
const statusListeners = new Set<StatusListener>()

function setStatus(status: RelayConnectionStatus) {
  connectionStatus = status
  statusListeners.forEach((fn) => fn(status))
}

function acquireSource() {
  refCount++
  if (source) return

  connectionStatus = 'connecting'
  source = new EventSource('/api/wss/events')

  // The browser auto-retries on drop, going back through CONNECTING — that's
  // our "retrying" state. It only settles on CLOSED when the server tells it
  // to stop (e.g. a non-2xx response, such as an expired session).
  source.onopen = () => setStatus('open')
  source.onerror = () => setStatus(source?.readyState === EventSource.CONNECTING ? 'connecting' : 'closed')

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

/** Tracks the shared relay SSE connection's status for the component's lifetime. */
export function useRelayStatus(): RelayConnectionStatus {
  const [status, setLocalStatus] = useState<RelayConnectionStatus>(connectionStatus)

  useEffect(() => {
    acquireSource()
    setLocalStatus(connectionStatus)
    statusListeners.add(setLocalStatus)

    return () => {
      statusListeners.delete(setLocalStatus)
      releaseSource()
    }
  }, [])

  return status
}
