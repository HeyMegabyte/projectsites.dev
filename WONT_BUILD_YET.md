# Won't Build Yet

Features explicitly deferred to prevent scope creep and control costs.

## Deferred Features

1. **Registrar domain purchasing** - Users provide their own domains or use free subdomain. Actual domain registration is a future feature.
2. **Advanced A/B experimentation platform** - Feature flags exist for gradual rollout; no full experimentation infrastructure.
3. **Complex CMS / multi-page sites** - Stick to single-page portfolio sites for now.
4. **PostHog analytics** - Feature-flagged; not required. Use internal funnel events + Cloudflare analytics.
5. **Lago on Fly.io** - Feature-flagged and optional. Internal metering is the default.
6. **ZIP automation for postcards** - Default OFF; stored as "ready-to-send" drafts only.
7. **TOTP / WebAuthn MFA** - Model + enforcement hook required; UI deferred.
8. **Rich admin dashboards** - Minimal admin controls first; richer dashboards later.
9. **Chatwoot email channel configuration** - Waiting on inbox/from-name decisions.

## Cost Guardrails

- Max LLM spend: $20/day (enforced via AI Gateway + org backstop)
- Max sites per day: 20
- Max emails per day: 25
- Max compute time per job: 5 minutes
- Max queued retries: 5
- Max storage per free tenant: 100MB
- Max storage per paid tenant: 500MB

## Open Questions

See the QUESTIONS section in the task specification for decisions that can improve the build but are not blockers.
