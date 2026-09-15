'use client'

import { useSyncExternalStore } from 'react'

/**
 * The blog search term, shared between the search box and the post list.
 *
 * They live in different sections of the page — Squarespace put the search block
 * in the hero and the post index below it — so they cannot share React state
 * through a common parent without restructuring the section renderer. A module
 * store keeps both as ordinary components and costs nothing on pages that have
 * no search box.
 */
let query = ''
const listeners = new Set<() => void>()

export function setPostQuery(next: string) {
  query = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePostQuery() {
  // The server render has no query, which is also the initial client state.
  return useSyncExternalStore(
    subscribe,
    () => query,
    () => '',
  )
}

/** Case-insensitive match across the fields a reader would search by. */
export function matchesQuery(
  post: { title: string; excerpt?: string; author?: string; body?: string },
  term: string,
) {
  const needle = term.trim().toLowerCase()
  if (!needle) return true

  return [post.title, post.excerpt, post.author, post.body]
    .filter(Boolean)
    .some((field) => field!.toLowerCase().includes(needle))
}
