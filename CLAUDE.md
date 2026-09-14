# eurosense.eu

Static React (Next.js) site, migrated off Squarespace, deployed to deploybase.

Read these before changing anything:

- **[AGENTS.md](AGENTS.md)** — how content is structured, how to edit it, how to
  change the app, and what to run before opening a pull request.
- **[DESIGN.md](DESIGN.md)** — palette, type scale, section themes, buttons, grid.
  Every value there was measured from the live site, not chosen.

## Before you finish

```bash
npm run check    # validate content + formatting + types + build
```

A green build does **not** mean the change is correct. This project's failure
modes are quiet, and every one below shipped at least once during the migration:

- A block with a misspelled `type` renders as nothing.
- An `<img>` whose file is missing still prerenders.
- Text set in the section's own background colour is in the DOM and invisible.
- A section that collapses around its grid crops its background image to a band.
- Markup that depends on a script we do not ship renders a few pixels tall.

`npm run validate` catches the first two. The others need eyes: build, serve
`out/`, and look at the page at more than one width.

## The three rules that keep biting

1. **Measure, do not infer.** Squarespace's colour names are inverted — its
   `--black` is white. Guessing "obvious" values is how four headings ended up
   invisible.
2. **Tailwind v4 generates utilities from `@theme`.** Write `bg-purple`, never
   `bg-[--color-purple]` — the latter looks like valid CSS and silently does
   nothing.
3. **Content is trusted code.** `renderMarkdown` and the `embed` block do not
   sanitise HTML, deliberately, because the site depends on third-party iframes.
   Review `content/` like source. Never point those renderers at anything a
   visitor submitted.

## Static export

No server. No API routes, no runtime environment variables, no `next/image`
optimisation. If a change needs a server, it does not belong here.
