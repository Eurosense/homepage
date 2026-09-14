'use client'

import { useState } from 'react'

export type NewsletterSpec = {
  intro?: string
  submitLabel?: string
  successMessage?: string
  fields: { name: string; label: string; type: string; required: boolean }[]
  checkboxGroup?: {
    name: string
    intro?: string
    label?: string
    options: { value: string; label: string }[]
  }
}

type Status = 'idle' | 'sending' | 'sent' | 'error'

const inputClasses =
  'w-full rounded-lg border border-line bg-white px-4 py-2.5 text-ink ' +
  'focus:border-purple focus:outline-none'

/**
 * Newsletter signup rendered in our own markup and posted to HubSpot's public
 * forms API.
 *
 * Replaces HubSpot's embed, which shipped an iframe roughly 700px tall, could
 * not be styled to match the site, and set tracking cookies on page load rather
 * than on submit. The submission endpoint needs no key — the portal and form ids
 * are public — so the only thing that has to be exact is the field names, which
 * are HubSpot property names taken from the form definition.
 */
export function NewsletterForm({
  portalId,
  formId,
  spec,
}: {
  portalId: string
  formId: string
  spec: NewsletterSpec
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setStatus('sending')
    setError('')

    const fields = spec.fields
      .map((field) => ({ name: field.name, value: String(data.get(field.name) ?? '').trim() }))
      .filter((field) => field.value)

    // HubSpot takes a multi-select as one field with values joined by ';'.
    if (spec.checkboxGroup) {
      const chosen = data.getAll(spec.checkboxGroup.name).map(String)
      if (chosen.length) fields.push({ name: spec.checkboxGroup.name, value: chosen.join(';') })
    }

    try {
      const res = await fetch(
        `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields,
            context: {
              pageUri: window.location.href,
              pageName: document.title,
            },
          }),
        },
      )

      if (!res.ok) {
        // HubSpot explains validation failures in the body; surface that rather
        // than a bare status code.
        const body = await res.json().catch(() => null)
        throw new Error(body?.errors?.[0]?.message ?? `The server replied ${res.status}.`)
      }

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
        data-newsletter-form
        className="rounded-xl border border-line bg-white p-6 text-purple-deep"
      >
        {spec.successMessage ?? 'Thank you — you are signed up.'}
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      data-newsletter-form
      className="flex w-full flex-col gap-4 rounded-xl border border-line bg-white p-6 text-purple sm:p-7"
    >
      {spec.intro ? <p className="font-medium text-purple-deep">{spec.intro}</p> : null}

      {spec.fields.map((field) => {
        const id = `${formId}-${field.name}`
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
            <input
              id={id}
              name={field.name}
              type={field.type}
              required={field.required}
              autoComplete={
                field.name === 'email'
                  ? 'email'
                  : field.name === 'firstname'
                    ? 'given-name'
                    : field.name === 'lastname'
                      ? 'family-name'
                      : 'on'
              }
              className={inputClasses}
            />
          </div>
        )
      })}

      {spec.checkboxGroup ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-muted">{spec.checkboxGroup.intro}</legend>
          {spec.checkboxGroup.options.map((option) => {
            const id = `${formId}-${spec.checkboxGroup!.name}-${option.value}`
            return (
              <div key={option.value} className="flex items-start gap-2.5">
                <input
                  id={id}
                  type="checkbox"
                  name={spec.checkboxGroup!.name}
                  value={option.value}
                  className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-purple)]"
                />
                <label htmlFor={id} className="text-sm leading-snug">
                  {option.label}
                </label>
              </div>
            )
          })}
        </fieldset>
      ) : null}

      {status === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          Could not sign you up. {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="self-start rounded-[15px] bg-purple px-7 py-3 font-medium text-cream transition hover:bg-purple-deep disabled:opacity-60"
      >
        {status === 'sending' ? 'Signing up…' : (spec.submitLabel ?? 'Submit')}
      </button>
    </form>
  )
}
