# InstaMosaic Marketing Automation

This is the working plan for a compliant Instagram marketing system for
InstaMosaic. The goal is to turn the existing mosaic pipeline into a steady
social content loop without spammy tagging, unreviewed use of other people's
images, or a fragile bot that silently operates the Instagram account.

## Goals

- Publish a few high-quality InstaMosaic posts per day from the official
  Instagram account.
- Use the existing mosaic and reveal-video pipeline for social-ready assets.
- Track target accounts, generated assets, captions, approval state, publish
  status, and performance.
- Track posts, stories, captions, or comments that mention InstaMosaic and queue
  them for review.
- Keep a human approval step before publishing or resharing until the account,
  permissions, and content policy are proven in production.

## Non-Goals

- Do not use the Meta API for the MVP.
- Do not run a headless or unattended Instagram browser bot.
- Do not mass-tag celebrities or popular accounts blindly.
- Do not repost third-party content without permission.
- Do not publish mosaics built from images we are not allowed to use.

## Platform Shape

Use a browser-assisted publishing workflow instead of the Meta API.

The app should generate assets and captions, then make manual publishing fast:

- Export one-click-ready media files for feed posts, Reels, and stories.
- Generate captions with tags and attribution.
- Provide a "Copy caption" action in admin.
- Provide an "Open Instagram" action in admin.
- Require the operator to upload, inspect, and publish manually.

This gives most of the operational benefit without storing Instagram
credentials, fighting UI changes, or silently posting content that should have
been reviewed.

## Automation Boundary

Allowed automation:

- Generate mosaics and reveal videos.
- Draft captions.
- Pick candidate targets from the marketing queue.
- Copy captions to the clipboard.
- Open Instagram URLs in the user's normal browser.
- Record manual publish results and links.
- Queue mention or reshare candidates from manually entered links.

Disallowed automation:

- Logging into Instagram.
- Uploading media to Instagram.
- Clicking publish, share, repost, comment, follow, like, or tag controls.
- Running unattended browser sessions against Instagram.
- Rotating accounts, bypassing rate limits, or evading anti-automation systems.

## Content Policy

For generated celebrity or popular-account mosaics, every queued post should
record the source of permission for the hero image and tile images.

Acceptable content sources:

- Customer-submitted mosaics where the customer has granted marketing rights.
- Public figures only when the source image is licensed, owned, or otherwise
  cleared for promotional use.
- Brand/account collaborations where permission is documented.
- Demo mosaics using internal photos or stock/licensed assets.

Avoid:

- Scraping a public figure's feed and tagging them for attention without a clear
  content-rights basis.
- Using a person's likeness in a way that implies endorsement.
- Reposting user-generated content without explicit permission or an in-app
  reshare flow that preserves attribution.

## Recommended MVP

1. Create an official `@instamosaic` Instagram account.
2. Use the Postgres-backed marketing queue in Prisma.
3. Add an admin-only marketing page that can:
   - create a campaign target,
   - generate a mosaic/reveal asset,
   - draft a caption,
   - preview the final post,
   - copy caption text,
   - open Instagram,
   - approve or reject it,
   - mark it as manually published.
4. Add a scheduler command that creates draft marketing items daily, but does
   not publish them automatically yet.
5. Add a manual mention inbox where links to posts/stories/comments can be
   pasted and reviewed for reshare.
6. After a few weeks of manual publishing, decide whether the friction is worth
   adding official API publishing later.

## Data Model

Marketing state now lives in Prisma/Postgres:

- `MarketingTarget`: target account, priority, status, notes, and rights state.
- `MarketingPost`: generated draft, selected asset, caption, approval, publish state, permalink, and errors.
- `InstagramMention`: manually entered mention or reshare candidates with permission review state.

Suggested post statuses:

- `draft`: generated but not reviewed.
- `approved`: ready for manual publish.
- `scheduled`: approved with a publish time.
- `published`: manually published and tracked.
- `failed`: manual publish failed or was abandoned.
- `rejected`: should not be posted.

Suggested mention statuses:

- `new`: manually entered mention or reshare candidate.
- `needs_permission`: looks worth resharing but permission is missing.
- `approved`: safe to reshare or respond.
- `reshared`: already handled.
- `ignored`: no action needed.

## System Flow

Daily draft generation:

1. Scheduler selects 1-3 active `marketing_targets` with acceptable rights
   status and no recent marketing post.
2. Worker creates a marketing mosaic using the existing job pipeline.
3. Worker generates social preview and reveal video assets.
4. Caption generator writes a short draft caption with attribution and a link
   prompt.
5. Admin reviews and approves the post.

Publishing:

1. Admin page shows the approved media asset, caption, target, and rights notes.
2. Operator clicks "Copy caption".
3. Operator clicks "Open Instagram".
4. Operator manually uploads the media and publishes.
5. Operator pastes the final Instagram URL back into the admin page.
6. App stores permalink, publish timestamp, and notes.

Mention handling:

1. Operator sees a mention or tag in Instagram.
2. Operator pastes the source URL into the admin mention inbox.
3. App stores the mention candidate.
4. Admin reviews rights, permission, and fit.
5. Approved mentions are handled manually.

## Implementation Notes

- Do not store Instagram credentials.
- Add hard daily caps.
- Add a per-target cool-down so the same person is not tagged repeatedly.
- Log every manual publish and reshare decision.
- Treat RapidAPI ingestion as an internal mosaic-generation dependency, not as a
  publishing or engagement automation channel.

## First Code Slice

The smallest useful implementation slice is:

1. Add the three marketing tables to `packages/db/src/index.ts`.
2. Add typed helpers for creating targets, draft posts, and mention records.
3. Add an admin marketing page with target and post lists.
4. Add copy-caption, open-Instagram, and mark-published actions.
5. Add a `scripts/marketing-draft.ts` command that creates draft rows only.

After that, we can add an optional local browser helper that opens Instagram to
the right page, but it should not post, reshare, comment, like, follow, or tag on
its own.

## Draft Bot Command

The first bot command generates a complete draft from a handle and a supplied
hero image:

```bash
npm run marketing:draft -- @username hero.jpg --email you@example.com
```

What it does:

1. Creates or updates the marketing target for the handle.
2. Creates a normal InstaMosaic job marked with `purpose: marketing`.
3. Runs the existing worker pipeline immediately.
4. Picks the reveal video as the best Instagram asset when FFmpeg succeeds,
   falling back to square/social previews.
5. Creates a `marketing_posts` draft row.
6. Emails the review address with the caption draft, status page, preview links,
   reveal video link, and local asset paths.

Useful options:

- `--caption "..."` overrides the generated caption.
- `--rights-status cleared` records the content-rights state.
- `--rights-notes "..."` records permission or license notes.
- `--notes "..."` records internal target notes.
