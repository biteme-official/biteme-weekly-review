const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — list all launch items
    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT
          id,
          month,
          sku,
          launch_date AS "launchDate",
          risk,
          created_at  AS "createdAt"
        FROM launch_items
        ORDER BY created_at DESC
      `;
      return res.status(200).json(rows);
    }

    // POST — create a new launch item
    if (req.method === 'POST') {
      const {
        month = '',
        sku = '',
        date = '',
        risk = '',
      } = req.body;

      // Generate ID: L-{seq}
      const { rows: countRows } = await sql`SELECT COUNT(*)::int AS cnt FROM launch_items`;
      const seq = String(countRows[0].cnt + 1).padStart(3, '0');
      const id = `L-${seq}`;

      await sql`
        INSERT INTO launch_items (id, month, sku, launch_date, risk)
        VALUES (${id}, ${month}, ${sku}, ${date}, ${risk})
      `;

      return res.status(201).json({ id, month, sku, launchDate: date, risk });
    }

    // PUT — update an existing launch item
    if (req.method === 'PUT') {
      const { id, ...fields } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const mapping = {
        month: 'month',
        sku: 'sku',
        date: 'launch_date',
        launchDate: 'launch_date',
        risk: 'risk',
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
      const query = `UPDATE launch_items SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`;
      await sql.query(query, values);

      return res.status(200).json({ success: true, id });
    }

    // DELETE — remove a launch item
    if (req.method === 'DELETE') {
      const id = req.body?.id || req.query?.id;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      await sql`DELETE FROM launch_items WHERE id = ${id}`;
      return res.status(200).json({ success: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
