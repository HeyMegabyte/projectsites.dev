## Summary
<!-- 1-3 bullet points describing what this PR does -->

## Definition of Done
- [ ] **Shipped**: Merged + deployed
- [ ] **Tested**: Jest unit + integration tests pass; Cypress E2E tests pass
- [ ] **Logged**: Funnel events + audit log entries where applicable
- [ ] **Secured**: Zod validation, RBAC, rate limits, sanitization
- [ ] **Documented**: SETUP.md updated if keys/config changed

## Test Plan
<!-- How to verify this change works -->

## Checklist
- [ ] No secrets/PII in code or logs
- [ ] Idempotent webhook/job handlers
- [ ] Request size limits enforced
- [ ] Error handling with typed AppError
- [ ] Structured logs with request_id
