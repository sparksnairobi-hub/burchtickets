const pool = require("../config/db");

async function overview(req, res) {
  const { companyId } = req.auth;

  const result = await pool.query(
    `SELECT
       c.status AS company_status,
       COALESCE(ev.total_events,0) AS total_events,
       COALESCE(ord.paid_orders,0) AS paid_orders,
       COALESCE(ord.gross_revenue,0) AS gross_revenue,
       COALESCE(ord.commission_paid,0) AS commission_paid
     FROM companies c
     LEFT JOIN (
       SELECT company_id, COUNT(*) AS total_events
       FROM events GROUP BY company_id
     ) ev ON ev.company_id = c.id
     LEFT JOIN (
       SELECT company_id,
         SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid_orders,
         SUM(CASE WHEN status='paid' THEN total_amount ELSE 0 END) AS gross_revenue,
         SUM(CASE WHEN status='paid' THEN commission_amount ELSE 0 END) AS commission_paid
       FROM orders GROUP BY company_id
     ) ord ON ord.company_id = c.id
     WHERE c.id = $1`,
    [companyId]
  );

  return res.json({
    ok: true,
    commissionRate: 10,
    stats: result.rows[0] || { company_status: "pending", total_events: 0, paid_orders: 0, gross_revenue: 0, commission_paid: 0 },
  });
}

module.exports = { overview };
