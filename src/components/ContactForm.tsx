'use client'

import { useState } from 'react'

import { Embed } from '@/components/Embed'
import type { Block } from '@/lib/content'
import type { FormTarget } from '@/lib/forms'

type FormBlock = Extract<Block, { type: 'form' }>

type Status = 'idle' | 'sending' | 'sent' | 'error'

const inputClasses =
  'w-full rounded-lg border border-line bg-white px-4 py-2.5 text-ink ' +
  'placeholder:text-muted/70 focus:border-purple focus:outline-none'

/**
 * Posts to a deploybase form endpoint.
 *
 * The markup is a real <form action=...>, so it still submits if JavaScript
 * fails; the handler below only upgrades it to an inline result. deploybase
 * returns JSON when sent `Accept: application/json` and a 303 redirect
 * otherwise, which is what makes both paths work from the same markup.
 */
export function ContactForm({ block, target }: { block: FormBlock; target: FormTarget }) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string>('')

  /*
   * A HubSpot-backed form renders HubSpot's own embed rather than our markup:
   * the fields, validation and consent wording live in HubSpot, and duplicating
   * them here would drift the moment someone edits the form there.
   */
  if (target?.provider === 'hubspot') {
    return (
      <Embed
        html={
          `<script src="https://js.hsforms.net/forms/embed/${target.portalId}.js" defer></script>` +
          `<div class="hs-form-frame" data-region="${target.region}" ` +
          `data-form-id="${target.formId}" data-portal-id="${target.portalId}"></div>`
        }
        className="w-full"
      />
    )
  }

  const endpoint = target?.provider === 'deploybase' ? target.endpoint : null

  if (!endpoint) {
    return (
      <div
        role="note"
        className="rounded-xl border border-dashed border-line bg-white/60 p-5 text-sm text-muted"
      >
        <p className="font-medium text-purple-deep">
          This form is not connected yet.
        </p>
        <p className="mt-1">
          The {block.title || 'contact'} form has no provider yet. Set one in{' '}
          <code className="rounded bg-cream px-1">content/forms.json</code> — either a
          HubSpot form id or a deploybase endpoint — so messages reach an inbox rather
          than disappearing.
        </p>
      </div>
    )
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setStatus('sending')
    setError('')

    try {
      const res = await fetch(endpoint!, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      })
      if (!res.ok) throw new Error(`The server replied ${res.status}.`)
      setStatus('sent')
      form.reset()
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (status === 'sent') {
    return (
      <div
        role="status"
        className="rounded-xl border border-line bg-white p-5 text-purple-deep"
      >
        Thank you — your message has been sent.
      </div>
    )
  }

  return (
    <form
      action={endpoint}
      method="POST"
      onSubmit={onSubmit}
      className="flex w-full flex-col gap-4 rounded-xl border border-line bg-white/70 p-6"
    >
      {block.title ? (
        <h3 className="text-xl font-semibold">{block.title}</h3>
      ) : null}

      {block.fields.map((field) => {
        const id = `${block.formId}-${field.name}`
        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium text-purple-deep">
              {field.label}
              {field.required ? (
                <span className="text-purple" aria-hidden>
                  {' '}
                  *
                </span>
              ) : null}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                id={id}
                name={field.name}
                required={field.required}
                rows={5}
                className={inputClasses}
              />
            ) : (
              <input
                id={id}
                name={field.name}
                type={field.type}
                required={field.required}
                autoComplete={field.type === 'email' ? 'email' : 'on'}
                className={inputClasses}
              />
            )}
          </div>
        )
      })}

      {/* deploybase quarantines submissions that fill this in. Hidden from
          sighted users and from assistive technology, not from bots. */}
      <input
        type="text"
        name="_gotcha"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
      />

      {status === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          Your message could not be sent. {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="self-start rounded-full bg-purple px-7 py-3 font-medium text-cream transition hover:bg-purple-deep disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending…' : block.submitLabel || 'Submit'}
      </button>
    </form>
  )
}
