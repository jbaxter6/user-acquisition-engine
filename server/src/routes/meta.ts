import { Router } from "express";
import { getMetaUsageSummary, listAccounts } from "../db.js";
import { highestPct, usageLevel, usageThresholds } from "../meta/usage.js";

// Feeds the usage meter on the Instagram chip in the navbar. Reads only
// our own call log — never calls Meta. See docs/meta-api-usage-meter.md.
export function metaRouter(): Router {
  const router = Router();

  router.get("/usage", (_req, res) => {
    const thresholds = usageThresholds();
    const accounts = listAccounts("instagram").map((account) => {
      const s = getMetaUsageSummary(account.id);
      const metaPct = highestPct(s.reading);
      return {
        accountId: account.id,
        username: account.username,
        calls: { lastHour: s.lastHour, last24h: s.last24h, byKind: s.byKind },
        sendsLastHour: s.sendsLastHour,
        meta: s.reading ? { ...s.reading, highestPct: metaPct } : null,
        lastThrottledAt: s.lastThrottledAt,
        lastSyncCalls: s.lastSyncCalls,
        lastSyncAt: s.lastSyncAt,
        level: usageLevel({ ...s, metaPct }, thresholds),
      };
    });
    res.json({ thresholds, accounts });
  });

  return router;
}
