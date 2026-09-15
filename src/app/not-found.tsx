import Link from 'next/link'

export default function NotFound() {
  return (
    // Cream, for the same reason a post is: there is no section here to paint a
    // background, and the purple-deep body left this text purple on purple.
    <div className="post-page bg-cream text-purple">
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-5 px-5 py-28">
        <p className="text-sm uppercase tracking-widest text-muted">404</p>
        <h1 className="text-4xl">This page has moved or no longer exists.</h1>
        <p className="text-muted">
          The site was recently rebuilt, so a few older links may no longer resolve.
        </p>
        <Link
          href="/"
          className="rounded-full bg-purple px-7 py-3 font-medium text-cream transition hover:bg-purple-deep"
        >
          Go to the homepage
        </Link>
      </div>
    </div>
  )
}
