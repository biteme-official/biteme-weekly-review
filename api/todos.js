const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — list all todos
    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT
          id,
          week,
          team,
          action,
          category,
          exec_period   AS "execPeriod",
          purpose,
          expected_effect AS "expectedEffect",
          status,
          created_at    AS "createdAt"
        FROM todos
        ORDER BY created_at DESC
      `;
      return res.status(200).json(rows);
    }

    // POST — create a new todo
    if (req.method === 'POST') {
      const {
        week,
        team,
        action,
        category = '',
        execPeriod = '',
        purpose = '',
        expectedEffect = '',
        status = '진행예정',
      } = req.body;

      if (!week || !team || !action) {
        return res.status(400).json({ error: 'week, team, and action are required' });
      }

      // Generate ID: T-{week}-{seq} where seq is zero-padded to 3 digits
      const { rows: countRows } = await sql`SELECT COUNT(*)::int AS cnt FROM todos`;
      const seq = String(countRows[0].cnt + 1).padStart(3, '0');
      const id = `T-${week}-${seq}`;

      await sql`
        INSERT INTO todos (id, week, team, action, category, exec_period, purpose, expected_effect, status)
        VALUES (${id}, ${week}, ${team}, ${action}, ${category}, ${execPeriod}, ${purpose}, ${expectedEffect}, ${status})
      `;

      return res.status(201).json({
        id,
        week,
        team,
        action,
        category,
        execPeriod,
        purpose,
        expectedEffect,
        status,
      });
    }

    // PUT — update an existing todo
    if (req.method === 'PUT') {
      const { id, ...fields } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      // Build dynamic SET clause
      const mapping = {
        week: 'week',
        team: 'team',
        action: 'action',
        category: 'category',
        execPeriod: 'exec_period',
        purpose: 'purpose',
        expectedEffect: 'expected_effect',
        status: 'status',
      };

      const setClauses = [];
      const values = [];
      let paramIdx = 1;

      for (const [camel, col] of Object.entries(mapping)) {
        if (fields[camel] !== undefined) {
          setClauses.push(`${col} = $${paramIdx}`);
          values.push(fields[camel]);
          paramIdx++;
        }
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(id);
      const query = `UPDATE todos SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`;
      await sql.query(query, values);

      return res.status(200).json({ success: true, id });
    }

    // DELETE — remove a todo
    if (req.method === 'DELETE') {
      const id = req.body?.id || req.query?.id;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      await sql`DELETE FROM todos WHERE id = ${id}`;
      return res.status(200).json({ success: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
