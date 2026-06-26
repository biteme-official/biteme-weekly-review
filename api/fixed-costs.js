const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — list all fixed costs
    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT
          id,
          month,
          bu,
          item,
          amount,
          memo,
          created_at AS "createdAt"
        FROM fixed_costs
        ORDER BY created_at DESC
      `;
      return res.status(200).json(rows);
    }

    // POST — create a new fixed cost
    if (req.method === 'POST') {
      const {
        month,
        bu = '',
        item = '',
        amount = 0,
        memo = '',
      } = req.body;

      if (!month) {
        return res.status(400).json({ error: 'month is required' });
      }

      // Generate ID: FC-{seq}
      const { rows: countRows } = await sql`SELECT COUNT(*)::int AS cnt FROM fixed_costs`;
      const seq = String(countRows[0].cnt + 1).padStart(3, '0');
      const id = `FC-${seq}`;

      await sql`
        INSERT INTO fixed_costs (id, month, bu, item, amount, memo)
        VALUES (${id}, ${month}, ${bu}, ${item}, ${amount}, ${memo})
      `;

      return res.status(201).json({ id, month, bu, item, amount, memo });
    }

    // PUT — update an existing fixed cost
    if (req.method === 'PUT') {
      const { id, ...fields } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const mapping = {
        month: 'month',
        bu: 'bu',
        item: 'item',
        amount: 'amount',
        memo: 'memo',
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
      const query = `UPDATE fixed_costs SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`;
      await sql.query(query, values);

      return res.status(200).json({ success: true, id });
    }

    // DELETE — remove a fixed cost
    if (req.method === 'DELETE') {
      const id = req.body?.id || req.query?.id;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      await sql`DELETE FROM fixed_costs WHERE id = ${id}`;
      return res.status(200).json({ success: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
