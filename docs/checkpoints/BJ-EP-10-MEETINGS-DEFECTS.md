# EP-10 Meetings regression qualification

Date: 2026-11-27 (Asia/Calcutta)

The full EP-10 suite reports the same two failures recorded before EP-10. Neither intersects the new server-side interview adapter, and no shared Meetings assertion or interface was weakened.

1. `tests/browser-ui.test.ts` — camera cycle preview assertion
   - The test expects `video.local-preview` inside `.tile.self` before joining, although the self tile is created after join.
   - Camera acquisition is invoked twice and the control returns to the enabled state; adjacent live camera reacquisition and ON/OFF/ON tests pass.
   - Classification: stale pre-join DOM expectation in the synthetic browser fixture. Requires separate Meetings UI qualification.

2. `tests/calendar-v1-004.test.ts` — month/week/day fixture assertion
   - The fixture is fixed to 13–14 October 2026 while the calendar initializes to the current date, 27 November 2026.
   - The assertion searches the current-month DOM for the out-of-month fixed fixture and receives no matching element.
   - Classification: time-dependent test fixture. Requires a clock-controlled fixture or explicit navigation in a separate Meetings correction.

Commands used for qualification:

- `npm test -- tests/browser-ui.test.ts tests/calendar-v1-004.test.ts --reporter=verbose` — 141 total, 139 passed, two failures above.
- `npm test -- --reporter=json --outputFile=ep10-full-tests.json` — 522 total, 520 passed, the same two failures.

