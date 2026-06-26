const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — list all mkt metrics
    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT
          id,
          week,
          month,
          app_consent AS "appConsent",
          affiliate
        FROM mkt_metrics
        ORDER BY week DESC, month DESC
      `;
      return res.status(200).json(rows);
    }

    // POST — upsert mkt metrics
    if (req.method === 'POST') {
      const {
        week,
        month,
        appConsent = 0,
        affiliate = 0,
      } = req.body;

      if (!week || !month) {
        return res.status(400).json({ error: 'week and month are required' });
      }

      const { rows } = await sql`
        INSERT INTO mkt_metrics (week, month, app_consent, affiliate)
        VALUES (${week}, ${month}, ${appConsent}, ${affiliate})
        ON CONFLICT (week, month)
        DO UPDATE SET
          app_consent = EXCLUDED.app_consent,
          affiliate   = EXCLUDED.affiliate
        RETURNING
          id,
          week,
          month,
          app_consent AS "appConsent",
          affiliate
      `;

      return res.status(200).json(rows[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
