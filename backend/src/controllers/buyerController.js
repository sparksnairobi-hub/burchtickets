const pool = require("../config/db");

async function myOrders(req, res) {
  const { buyerId } = req.auth;

  const ordersRes = await pool.query(
    `SELECT o.id, o.status, o.total_amount, o.currency, o.created_at,
            e.title AS event_title, e.slug AS event_slug, e.venue_name, e.venue_city, e.start_at,
            c.name AS company_name
     FROM orders o
     JOIN events e ON e.id = o.event_id
     JOIN companies c ON c.id = o.company_id
     WHERE o.buyer_id = $1
     ORDER BY o.created_at DESC
     LIMIT 100`,
    [buyerId]
  );

  const orders = ordersRes.rows;
  if (orders.length === 0) return res.json({ ok: true, orders: [] });

  const orderIds = orders.map((o) => o.id);
  const ticketsRes = await pool.query(
    `SELECT oi.order_id, t.ticket_code, tt.name AS tier_name
     FROM tickets t
     JOIN order_items oi ON oi.id = t.order_item_id
     WHERE oi.order_id = ANY($1::bigint[])
     ORDER BY t.id`,
    [orderIds]
  );

  const ticketsByOrder = {};
  for (const row of ticketsRes.rows) {
    (ticketsByOrder[row.order_id] ||= []).push({ ticketCode: row.ticket_code, tierName: row.tier_name });
  }

  return res.json({
    ok: true,
    orders: orders.map((o) => ({
      orderId: o.id,
      status: o.status,
      totalAmount: o.total_amount,
      currency: o.currency,
      createdAt: o.created_at,
      eventTitle: o.event_title,
      eventSlug: o.event_slug,
      venueName: o.venue_name,
      venueCity: o.venue_city,
      startAt: o.start_at,
      companyName: o.company_name,
      tickets: ticketsByOrder[o.id] || [],
    })),
  });
}

module.exports = { myOrders };
