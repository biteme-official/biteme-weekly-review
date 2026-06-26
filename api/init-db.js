const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        week TEXT NOT NULL,
        team TEXT NOT NULL,
        action TEXT NOT NULL,
        category TEXT DEFAULT '',
        exec_period TEXT DEFAULT '',
        purpose TEXT DEFAULT '',
        expected_effect TEXT DEFAULT '',
        status TEXT DEFAULT '진행예정',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        week TEXT NOT NULL,
        team TEXT NOT NULL,
        impact_analysis TEXT DEFAULT '',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(week, team)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS fixed_costs (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL,
        bu TEXT DEFAULT '',
        item TEXT DEFAULT '',
        amount NUMERIC DEFAULT 0,
        memo TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS launch_items (
        id TEXT PRIMARY KEY,
        month TEXT DEFAULT '',
        sku TEXT DEFAULT '',
        launch_date TEXT DEFAULT '',
        risk TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS mkt_metrics (
        id SERIAL PRIMARY KEY,
        week TEXT NOT NULL,
        month TEXT NOT NULL,
        app_consent NUMERIC DEFAULT 0,
        affiliate NUMERIC DEFAULT 0,
        UNIQUE(week, month)
      )
    `;

    res.status(200).json({ success: true, message: 'All tables created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
