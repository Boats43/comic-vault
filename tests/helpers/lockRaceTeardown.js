// tests/helpers/lockRaceTeardown.js -- safe teardown for two-connection lock-race tests (d4 B9, d5b Scenario 1).
//
// THE DEFECT THIS REPLACES (diagnosed 2026-10-20, reproduced in a scratch schema): the old tail was
//     const c1Committed = await finish(c1, r1.ok);   // ROLLBACK/COMMIT
//     const c2Committed = await finish(c2, r2.ok);
// When the race resolved as "T1 blocked, T2 succeeded" (a plain lock wait, no Postgres cycle), T1's UPDATE was still in flight on client c1 waiting for T2's
// uncommitted row lock. finish(c1) therefore queued its ROLLBACK BEHIND that UPDATE on the same client, while T2's COMMIT (the only thing that could release the
// lock) was issued only after finish(c1) returned: a circular wait inside the harness that no database timeout can break. The run hung until the outer runner killed it.
//
// THE FIX: issue both teardown statements CONCURRENTLY. Whichever side holds the lock commits/rolls back immediately regardless of which client the blocked statement sits
// on, so the blocked statement is released and the queued teardown follows. A watchdog guarantees termination: if teardown has not settled in `watchdogMs` the sockets are destroyed (the
// server rolls the transactions back) and the result says so -- a test then fails loudly instead of hanging. This helper changes nothing about WHAT is asserted.
export async function finishRace(c1, ok1, c2, ok2, { watchdogMs = 15000 } = {}) {
  // a watchdog-destroyed socket makes pg emit 'error' on the Client; without a listener that crashes the process
  for (const c of [c1, c2]) c.on('error', () => {});
  const fin = (client, ok) => (async () => {
    try { await client.query(ok ? 'COMMIT' : 'ROLLBACK'); return ok === true; } catch { return false; }
  })();
  const both = Promise.all([fin(c1, ok1), fin(c2, ok2)]);
  let timer;
  const dog = new Promise((resolve) => { timer = setTimeout(() => resolve('WATCHDOG'), watchdogMs); });
  const r = await Promise.race([both, dog]);
  clearTimeout(timer);
  if (r === 'WATCHDOG') {
    for (const c of [c1, c2]) { try { c.connection?.stream?.destroy(); } catch { /* socket already gone */ } }
    await Promise.race([both.catch(() => {}), new Promise((res) => setTimeout(res, 2000))]);
    return { committed: [false, false], watchdogFired: true };
  }
  return { committed: r, watchdogFired: false };
}

/** Close both clients without ever hanging (pg's end() waits for the queue; destroy after a short grace). */
export async function closeRaceClients(...clients) {
  await Promise.all(clients.map(async (c) => {
    try {
      await Promise.race([c.end(), new Promise((_, rej) => setTimeout(() => rej(new Error('end timeout')), 3000))]);
    } catch {
      try { c.connection?.stream?.destroy(); } catch { /* already closed */ }
    }
  }));
}
