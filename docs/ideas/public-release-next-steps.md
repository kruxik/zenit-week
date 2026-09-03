# Public Release — Next Steps

Picked up from `public-release-plan.md`. Week 1-2 (T1–T10) is done. This is the
queue for the next sessions, grouped by who has to do it.

## Manual verification (run after next deploy)

- [ ] Open `https://opengraph.xyz/?url=zenitweek.com` and `?url=zenitweek.com/cs/` — confirm both share cards render correctly.
- [ ] Run [Google Rich Results Test](https://search.google.com/test/rich-results) on `/` and `/cs/` — confirm `SoftwareApplication` JSON-LD validates.
- [ ] Run [Twitter Card Validator](https://cards-dev.twitter.com/validator) on both URLs.
- [ ] `curl https://zenitweek.com/robots.txt` and `curl https://zenitweek.com/sitemap.xml` — both return 200 with expected content.
- [ ] Submit `sitemap.xml` in **Google Search Console** and **Bing Webmaster Tools**.
- [ ] Verify hreflang in Search Console → International Targeting (no errors after a few days).

## Privacy-policy compliance check (manual)

- [ ] **Confirm Vercel Analytics is OFF** in Vercel project settings. Privacy
      policy §2.3 claims Vercel does not share IPs with us in identifiable
      form. Default plans are opaque; Analytics or Log Drains break the claim.
      If on, either turn it off OR update privacy policy.
- [ ] Confirm postal address on file at `petr@petrburian.com` — GDPR contact
      should reach you reliably.

## Ko-fi activation (when account exists)

- [ ] Create account at https://ko-fi.com.
- [ ] Uncomment `ko_fi: <username>` in `.github/FUNDING.yml`.
- [ ] Add discreet Ko-fi link to `index.html` and `cs/index.html` footers (between MIT License and Privacy).
- [ ] Replace placeholder sentence in `README.md` § Sponsoring with the real link.
- [ ] Verify the ❤️ Sponsor button shows on the GitHub repo header.

## Code follow-ups (not in T1-T10 scope)

- [ ] **Czech privacy & terms** — `/privacy` and `/terms` are still EN-only. Create `cs/privacy.html` and `cs/terms.html` mirroring the EN structure (privacy.html GDPR pass already done; just translate). Update hreflang on both EN files to point at the new CZ alternates.
- [ ] **App `?lang=` URL param** — `zenit-week.html` does not yet read the URL parameter, so a CZ user clicking *Otevřít aplikaci* from `/cs/` lands on the EN UI. Add a one-liner that reads `new URLSearchParams(location.search).get('lang')` on init and sets `currentLang` if it's a known value before the existing `localStorage.getItem('zenit-week-lang')` fallback. Update both EN and CS homepage CTAs to include `?lang=en` / `?lang=cs`.
- [ ] **Backup-reminder UX** — `localStorage` data loss is the biggest privacy-friendly trap. Add a gentle in-app prompt suggesting Export → JSON after N weeks of use, dismissible. Spec lives in privacy/risk #4.
- [ ] **HTML validator config** — extend `npm run validate` to also check `index.html`, `cs/index.html`, `privacy.html`, `terms.html`. The pre-existing `aria-label-misuse` and `no-inline-style` errors are not blocking but worth burning down once.

## Week 3 — Pre-launch validation (mostly off-keyboard)

- [ ] **Trademark check** — quick search at [ÚPV](https://www.upv.cz) (CZ) and [EUIPO](https://www.tmdn.org) for "Zenit Week" / "Zenit". 30 min job.
- [ ] **Domain auto-renew** — verify zenitweek.com renewal is on; lock the registrar account with 2FA.
- [ ] **Mentee seed round** — 5-10 trusted users, 3-week observation. Track retention by direct check-in or self-reported export, not analytics.
- [ ] **Mentor-peer outreach** — DM 10 CZ mentor peers asking for 30-min feedback. If <3 reply, channel is colder than assumed; revisit launch motion.
- [ ] **Plausible vs. zero analytics decision** — €9/mo, EU-hosted, cookie-free. Recommend on; flying blind on retention will kill iteration discipline. If on, update privacy policy §3.

## Week 4-5 — CZ launch

- [ ] **Mentor playbook PDF** (CZ): "Týden v rovnováze" 1-pager / mini-workbook. App is the digital companion. Free, white-labelable so peer mentors can share.
- [ ] **Soft launch** via mentor newsletter / network.
- [ ] **Testimonials** — collect 2-3 before any public push.
- [ ] **CZ press** — one outlet only (Lupa.cz or Czechcrunch). Only after testimonials are in hand.

## Week 6+ — Sustain

- [ ] **Weekly ritual post** — short Sunday post / newsletter; commits the 10-min-on-Sunday positioning.
- [ ] **EN re-launch** in 3-6 months once retention is real. Show HN angle: single-file, no servers, OAuth `drive.appdata` only.
- [ ] **Pro tier wording** — write the public framing now (server-bound team/cohort sync as the value prop) so it doesn't read as bait-and-switch when added.
