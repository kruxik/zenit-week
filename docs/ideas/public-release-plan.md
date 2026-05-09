# Zenit Week — Public Launch Plan

## Problem Statement
HMW move Zenit Week from working side-project to public release that earns
weekly use among Czech mentor circles, without losing the single-file purity
or privacy promise.

## Recommended Direction
**CZ-first "Sunday Ritual + Mentor Toolkit"**, sequenced into a quieter EN
launch later. Lead with the ritual ("10 minutes on Sunday, big rocks first"),
not the tool. Bundle a free Czech mentor playbook so peers in your network
have reason to share, not compete. Optional Ko-fi donate now; reserve room
for a server-bound Pro tier later (cohort/team sync) without breaking the
"your data stays with you" headline for solo users.

## Key Assumptions to Validate
- [ ] 5-10 mentees pre-launch use it ≥3 weeks. Validate via export-share or
      direct check-in, not "yes I'll try it" promises.
- [ ] At least 3 of 10 CZ mentor peers reply to a DM ask for 30-min feedback.
      Tests that your channel is real.
- [ ] Privacy/no-server story holds with a future Pro tier. Write the wording
      now, before launch, so Pro is "team add-on" not "we changed our mind".
- [ ] OAuth scopes are minimal (`drive.appdata` or `drive.file`). Anything
      broader triggers Google verification — confirm before public launch.

## MVP Scope (4-6 weeks part-time)

### Week 1-2 — Polish & legal hygiene
- Czech homepage (`index.html` localized; hreflang cs/en; canonical URLs)
- og:image, twitter:card, robots.txt, sitemap.xml, JSON-LD SoftwareApplication
- Privacy page: GDPR controller details, data categories, SAR contact
- README rewrite — user-first, not dev-first; screenshots + GIF
- FUNDING.yml + Ko-fi link (footer + GitHub sponsor button)
- Confirm OAuth scope; document in privacy page

### Week 3 — Pre-launch validation
- Seed 5-10 mentees; private Czech feedback round
- Check trademark (ÚPV + EUIPO); domain auto-renew on
- Add Plausible (or stay analytics-free — pick one with eyes open)
- Backup reminder UX in app (long-session toast)

### Week 4-5 — CZ launch
- Mentor playbook 1-pager PDF (CZ): "Týden v rovnováze"
- Soft launch via mentor newsletter / network
- 2-3 testimonials gathered before any public push
- Press to one CZ outlet (e.g., Lupa.cz, Czechcrunch) only after testimonials

### Week 6+ — Sustain
- Weekly ritual blog/newsletter (1 short post per Sunday)
- Track retention by self-reported export count, not analytics if you skip Plausible
- EN re-launch in 3-6 months with Show HN angle once you have data

## Not Doing (and Why)
- **Product Hunt launch on day 1** — Wrong audience for "weekly mentor
  retention" success metric. PH crowd churns in 7 days. Save for EN phase.
- **PayPal donate** — fees + business setup + weak in CZ. Ko-fi only.
- **Server-side sync now** — kills the headline. Defer until Pro tier.
- **i18n homepage parity from day 1** — CZ-first means CZ homepage gets full
  attention; EN gets a clean fallback, polished later.
- **A11y AA claim** — SVG mind-map can't honestly hit AA. Call it a known
  limitation; point screen-reader users to the agenda/todo list views.
- **Custom analytics infra** — Plausible or nothing.
- **Splitting the single HTML file** — single-file purity *is* part of the
  story. Don't trade it for "cleaner architecture".

## Open Questions
- Do you want a paid Pro tier on the public roadmap from day 1, or held
  silently until demand shows up? (Public = sets expectations + filters
  audience; silent = optionality but risks accusations of bait-and-switch later.)
- CZ legal entity for donations — do you already have an IČO, or do donations
  go to a personal account with the related tax footprint?
- Plausible (€9/mo, EU-hosted, cookie-free) or zero analytics? Recommend
  Plausible — flying blind on retention will kill iteration discipline.

## Risk Register

1. **GDPR posture for CZ launch.** Privacy page exists but verify: data
   controller (you, full name + address required), data categories, lawful
   basis, SAR contact. CZ users = ÚOOÚ jurisdiction.
2. **Google OAuth verification.** Check `api/token.js` scopes. If broader than
   `drive.appdata` or `drive.file`, Google may require verification ($$ + weeks).
3. **MIT + Pro tier conflict.** MIT means anyone can fork and ship "Pro"
   features for free. Pro must be server-bound to be defensible.
4. **localStorage data loss.** Browser cache clears = total wipe. Export
   exists but discoverability is poor. Add weekly backup reminder UX.
5. **No analytics = no signal.** Cannot tell if launch worked. Plausible or
   conscious choice to fly blind.
6. **Bus factor.** 392kB single HTML is hostile to contributors. Extract
   architecture map from CLAUDE.md into CONTRIBUTING.
7. **Trademark.** Quick check on ÚPV (CZ) + EUIPO before press.
8. **A11y.** SVG mind-map can't honestly hit AA — call it out, point at
   agenda/todo list as fallback.
9. **Donations + CZ tax.** Above ~€670/yr from one source may need
   registration. Document before donate button goes live.
10. **SEO gaps.** Missing og:image, twitter:card, canonical, robots.txt,
    sitemap.xml, JSON-LD `SoftwareApplication`. All easy wins.
