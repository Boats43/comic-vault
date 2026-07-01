// TEMPORARY ADMIN ENDPOINT — Cache inspection and cleanup
// DELETE THIS FILE after tonight's validation complete

import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  // Security: Only allow in development or with admin key
  const adminKey = process.env.ADMIN_KEY || 'dev-only-temp-key-2026';
  const providedKey = req.headers['x-admin-key'] || req.query.key;

  if (providedKey !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const redis = Redis.fromEnv();
    const action = req.query.action || 'list';

    if (action === 'list') {
      // List all ac: prefixed keys
      const keys = await redis.keys('ac:*');
      const results = [];

      for (const key of keys.slice(0, 50)) { // Limit to 50 keys
        const value = await redis.get(key);
        const ttl = await redis.ttl(key);
        results.push({
          key,
          count: value?.count || 0,
          avgPrice: value?.average || null,
          ttl: ttl > 0 ? ttl : 'expired',
          poisoned: value?.count === 0
        });
      }

      return res.json({
        action: 'list',
        totalKeys: keys.length,
        showing: results.length,
        poisonedCount: results.filter(r => r.poisoned).length,
        keys: results
      });
    }

    if (action === 'delete') {
      const key = req.query.key;
      if (!key) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }
      await redis.del(key);
      return res.json({ action: 'delete', key, deleted: true });
    }

    if (action === 'deleteAll') {
      const pattern = req.query.pattern || 'ac:*';
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      return res.json({ action: 'deleteAll', pattern, deletedCount: keys.length });
    }

    if (action === 'get') {
      const key = req.query.key;
      if (!key) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }
      const value = await redis.get(key);
      const ttl = await redis.ttl(key);
      return res.json({ key, value, ttl });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: ['list', 'get', 'delete', 'deleteAll']
    });

  } catch (error) {
    console.error('[admin-cache] Error:', error);
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
