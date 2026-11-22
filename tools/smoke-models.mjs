#!/usr/bin/env node
/**
 * `npm run smoke:models`: one figure request, one board request and one speech request per configured model, with
 * times, and the error test set (server tasks, round 5). It needs a key and is never part of `npm run check`.
 * Round 1 holds only this stub, so it fails loudly instead of passing.
 */
process.stderr.write('smoke:models is not built yet: it arrives in round 5 of the teacher and server plan (handoff/teacher/plan.md).\n');
process.exitCode = 1;
