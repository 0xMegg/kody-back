# Kody Backend Wiki Log

## 2026-06-16

- S0-AL-001 Sub-AC 3 verified from `kody-backend`: unauthorized `POST /shipments/:id/complete` returns 403 under shipment execute authorization and writes no ActionLog; verification passed with `npm run test -- tests/shipment-routes.test.ts -t "does not write action logs for failed or unauthorized shipment pack and complete attempts"`, `npm run test -- tests/shipment-routes.test.ts`, `npm run lint`, `npm run build`, and `npm run test` (30 files / 400 tests).

## 2026-05-04

- Created backend wiki during Hermes cutover.
- Added backend conventions, state, and legacy harness summary.
