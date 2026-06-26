const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — list all notes
    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT
          id,
          week,
          team,
          impact_analysis AS "impactAnalysis",
          updated_at      AS "updatedAt"
        FROM notes
        ORDER BY updated_at DESC
      `;
      return res.status(200).json(rows);
    }

    // POST — upsert a note (insert or update on conflict)
    if (req.method === 'POST') {
      const { week, team, impactAnalysis = '' } = req.body;

      if (!week || !team) {
        return res.status(400).json({ error: 'week and team are required' });
      }

      const { rows } = await sql`
        INSERT INTO notes (week, team, impact_analysis, updated_at)
        VALUES (${week}, ${team}, ${impactAnalysis}, NOW())
        ON CONFLICT (week, team)
        DO UPDATE SET
          impact_analysis = EXCLUDED.impact_analysis,
          updated_at = NOW()
        RETURNING
          id,
          week,
          team,
          impact_analysis AS "impactAnalysis",
          updated_at      AS "updatedAt"
      `;

      return res.status(200).json(rows[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
