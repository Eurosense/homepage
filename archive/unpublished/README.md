# Pages that are kept but not published

Squarespace accumulated drafts, duplicates and default stubs over the life of
the site. Nothing linked to any of these — not this site, and not the live
Squarespace site either, which was checked page by page before they were moved
here.

They are kept rather than deleted because the content may still be wanted, and
because "nothing links to it" is a weaker claim than "nobody wants it".

| File | Why it is here |
| --- | --- |
| `pages/events.json`, `pages/store.json` | Empty. These are the two `[parse] EMPTY` warnings the build used to print. |
| `pages/new-page.json` | Squarespace's default "New Page" stub. |
| `pages/multimedia2.json` | A stub, 215 characters. |
| `pages/blog.json`, `blog/*.md` | Squarespace's demo blog: "Blog Post Title Two", "Three", "Four", plus a 2019-dated copy of a real post that also lives in `content/blognews/`. The real blog is `/blognews`. |
| `pages/home-2.json` | An older draft of the homepage, 25 blocks against the live 68. Not a copy of it. |
| `pages/eurosensers.json` | A prototype map with thirty invented names. |
| `pages/vision-1.json` | An orphaned variant of `/vision`, which is linked from `/forpartners` and stays published. |
| `pages/events--innovating-democracy-workshop-and-complexity-cafes.json` | A real event page, but `/home-2` was the only thing that linked to it. |

## Publishing one again

Move the file back into `content/pages/` (or `content/<collection>/` for a
post), then **add a link to it** — from `content/site.json`'s `nav` or
`footerBlocks`, or from another page. A page with no route into it is how all of
these ended up here.

Restoring a collection also means adding it back to `COLLECTION_ROUTES` in
`src/lib/content.ts`, which is what maps `blognews` to `/blognews`.

Nothing outside `content/` is read at build time, so a file sitting here has no
effect on the site.
