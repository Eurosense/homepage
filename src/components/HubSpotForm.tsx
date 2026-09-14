import { Embed } from '@/components/Embed'

/**
 * Renders a HubSpot form on a surface it is guaranteed to be readable on.
 *
 * HubSpot renders into an iframe, so its label and help-text colours cannot be
 * restyled from here. Those colours are dark, and the form appears in sections
 * with a deep purple theme and over background images — where it was effectively
 * invisible. The white card is not decoration: it is the only way to control the
 * contrast of content we do not own.
 */
export function HubSpotForm({
  portalId,
  formId,
  region,
  className = '',
}: {
  portalId: string
  formId: string
  region: string
  className?: string
}) {
  return (
    <div className={`w-full rounded-xl bg-white p-5 shadow-sm sm:p-7 ${className}`}>
      <Embed
        html={
          `<script src="https://js.hsforms.net/forms/embed/${portalId}.js" defer></script>` +
          `<div class="hs-form-frame" data-region="${region}" ` +
          `data-form-id="${formId}" data-portal-id="${portalId}"></div>`
        }
      />
    </div>
  )
}
