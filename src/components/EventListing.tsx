'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

import { SmartLink } from '@/components/SmartLink'
import type { Block } from '@/lib/content'

type EventListingBlock = Extract<Block, { type: 'eventListing' }>
type EventEntry = EventListingBlock['events'][number]

function formatEventDate(startsAt: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Vienna',
  }).format(new Date(startsAt))
}

function EventCard({ event }: { event: EventEntry }) {
  return (
    <article className="mx-auto w-full max-w-[406px] space-y-5">
      <Image
        src={event.image}
        alt={event.imageAlt}
        width={940}
        height={470}
        className="h-auto w-full rounded-xl object-contain"
        sizes="(max-width: 452px) calc(100vw - 12vw), 406px"
      />
      <div className="prose-eurosense">
        <h3>{event.title}</h3>
        <p className="mt-3">
          <strong>
            {formatEventDate(event.startsAt)}
            <br />
            {event.details}
          </strong>
        </p>
        <div
          className="prose-eurosense mt-4"
          dangerouslySetInnerHTML={{ __html: event.descriptionHtml }}
        />
        {event.registrationHref ? (
          <SmartLink
            href={event.registrationHref}
            className="mt-5 inline-flex h-14 items-center justify-center rounded-[15px] bg-[color:var(--sec-btn-bg)] px-5 text-base font-medium leading-none text-[color:var(--sec-btn-text)] transition hover:opacity-90"
          >
            {event.registrationLabel ?? 'Register'}
          </SmartLink>
        ) : null}
      </div>
    </article>
  )
}

function EventGroup({
  heading,
  events,
  emptyMessage,
}: {
  heading: string
  events: EventEntry[]
  emptyMessage: string
}) {
  return (
    <section aria-label={heading} className="space-y-8">
      <div className="prose-eurosense text-center">
        <h2>{heading}</h2>
      </div>
      {events.length ? (
        <div className="space-y-12">
          {events.map((event) => (
            <EventCard key={`${event.startsAt}-${event.title}`} event={event} />
          ))}
        </div>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </section>
  )
}

export function EventListing({
  events,
  upcomingHeading = 'Upcoming events',
  pastHeading = 'Past events',
  initialNow,
}: EventListingBlock & { initialNow: number }) {
  const [now, setNow] = useState(initialNow)

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>
    const refreshAtMidnight = () => {
      const current = new Date()
      const midnight = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate() + 1,
      )
      timeout = setTimeout(() => {
        setNow(Date.now())
        refreshAtMidnight()
      }, midnight.getTime() - current.getTime())
    }

    setNow(Date.now())
    refreshAtMidnight()
    return () => clearTimeout(timeout)
  }, [])

  const upcoming = events
    .filter((event) => new Date(event.endsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
  const past = events
    .filter((event) => new Date(event.endsAt).getTime() < now)
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())

  return (
    <div className="mx-auto w-full max-w-6xl space-y-16 px-[4vw] py-14">
      <EventGroup
        heading={upcomingHeading}
        events={upcoming}
        emptyMessage="There are no upcoming events at the moment."
      />
      <EventGroup
        heading={pastHeading}
        events={past}
        emptyMessage="Past events will appear here."
      />
    </div>
  )
}

