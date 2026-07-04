const pool = require("../config/db");
const { sendMpesaStkPush } = require("../services/mpesaService");
const { submitOrderRequest } = require("../services/pesapalService");

async function checkout(req, res) {
  const client = await pool.connect();
  try {
    const { eventId, buyerName, buyerEmail, buyerPhone, items } = req.body;
    const paymentMethod = req.body.paymentMethod === "pesapal" ? "pesapal" : "mpesa";

    if (!eventId || !buyerName || !buyerEmail || !buyerPhone || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_REQUEST" });
    }

    await client.query("BEGIN");

    const eventRes = await client.query(
      `SELECT id, company_id, status, currency FROM events WHERE id = $1 FOR UPDATE`,
      [eventId]
    );
    if (eventRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "EVENT_NOT_FOUND" });
    }
    const event = eventRes.rows[0];
    if (event.status !== "published") {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "EVENT_NOT_AVAILABLE" });
    }

    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const tierRes = await client.query(
        `SELECT id, price, quantity_total, quantity_sold, max_per_order, active
         FROM ticket_tiers WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [item.ticketTierId, eventId]
      );
      if (tierRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "TICKET_TIER_NOT_FOUND" });
      }
      const tier = tierRes.rows[0];
      if (!tier.active) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "TICKET_TIER_INACTIVE" });
      }
      if (item.quantity > tier.max_per_order) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "MAX_PER_ORDER_EXCEEDED" });
      }
      const available = tier.quantity_total - tier.quantity_sold;
      if (item.quantity > available) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "INSUFFICIENT_INVENTORY" });
      }

      const lineTotal = Number(tier.price) * Number(item.quantity);
      subtotal += lineTotal;
      validatedItems.push({ ticketTierId: tier.id, quantity: item.quantity, unitPrice: Number(tier.price), lineTotal });
    }

    const commissionRate = 10;
    const commissionAmount = +(subtotal * commissionRate / 100).toFixed(2);
    const totalAmount = +(subtotal + commissionAmount).toFixed(2);

    const orderRes = await client.query(
      `INSERT INTO orders (company_id, event_id, buyer_id, buyer_name, buyer_email, buyer_phone, subtotal, commission_rate, commission_amount, total_amount, currency, status, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending', NOW() + INTERVAL '15 minutes', NOW(), NOW())
       RETURNING id`,
      [event.company_id, eventId, req.buyerId || null, buyerName, buyerEmail, buyerPhone, subtotal, commissionRate, commissionAmount, totalAmount, event.currency]
    );
    const orderId = orderRes.rows[0].id;

    for (const item of validatedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, ticket_tier_id, quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5)`,
        [orderId, item.ticketTierId, item.quantity, item.unitPrice, item.lineTotal]
      );
      await client.query(
        `INSERT INTO inventory_holds (event_id, ticket_tier_id, order_id, hold_key, quantity, expires_at)
         VALUES ($1,$2,$3,$4,$5, NOW() + INTERVAL '15 minutes')`,
        [eventId, item.ticketTierId, orderId, `hold:${orderId}:${item.ticketTierId}`, item.quantity]
      );
    }

    const paymentRes = await client.query(
      `INSERT INTO payments (order_id, provider, provider_ref, amount, currency, status, raw_payload)
       VALUES ($1,$2,$3,$4,$5,'initiated','{}'::jsonb) RETURNING id`,
      [orderId, paymentMethod, `pending:${orderId}`, totalAmount, event.currency]
    );
    const paymentId = paymentRes.rows[0].id;

    await client.query(
      `INSERT INTO booking_sessions (order_id, session_key, hold_expires_at, payment_expires_at, status)
       VALUES ($1,$2, NOW() + INTERVAL '15 minutes', NOW() + INTERVAL '15 minutes', 'held')`,
      [orderId, `session:${orderId}`]
    );

    await client.query("COMMIT");

    // Initiate payment with the chosen provider after the DB transaction commits.
    let paymentInit;
    try {
      if (paymentMethod === "pesapal") {
        paymentInit = await submitOrderRequest({
          orderId,
          amount: totalAmount,
          currency: event.currency,
          description: `Ticket payment for order ${orderId}`,
          callbackUrl: `${process.env.PESAPAL_CALLBACK_URL}?orderId=${orderId}`,
          buyerEmail,
          buyerPhone,
          buyerName,
        });

        await pool.query(
          `UPDATE payments SET provider_ref=$2, checkout_request_id=$3, raw_payload=$4::jsonb, updated_at=NOW() WHERE id=$1`,
          [paymentId, paymentInit.providerRef, paymentInit.providerRef, JSON.stringify(paymentInit)]
        );
      } else {
        paymentInit = await sendMpesaStkPush({
          orderId,
          amount: totalAmount,
          phone: buyerPhone,
          accountReference: `ORDER-${orderId}`,
          description: `Ticket payment for order ${orderId}`,
        });

        await pool.query(
          `UPDATE payments SET provider_ref=$2, checkout_request_id=$3, raw_payload=$4::jsonb, updated_at=NOW() WHERE id=$1`,
          [paymentId, paymentInit.providerRef, paymentInit.checkoutRequestId, JSON.stringify(paymentInit)]
        );
      }
    } catch (paymentErr) {
      await pool.query(
        `UPDATE payments SET status='failed', failed_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [paymentId]
      );
      return res.status(201).json({
        ok: true,
        orderId,
        paymentId,
        totalAmount,
        currency: event.currency,
        payment: null,
        paymentError: paymentMethod === "pesapal" ? "PESAPAL_ORDER_FAILED" : "STK_PUSH_FAILED",
      });
    }

    return res.status(201).json({
      ok: true,
      orderId,
      paymentId,
      totalAmount,
      currency: event.currency,
      paymentMethod,
      payment: paymentInit,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ ok: false, error: "CHECKOUT_FAILED" });
  } finally {
    client.release();
  }
}

async function getOrderStatus(req, res) {
  const { orderId } = req.params;
  const result = await pool.query(
    `SELECT o.id, o.status AS order_status, p.status AS payment_status
     FROM orders o LEFT JOIN payments p ON p.order_id = o.id
     WHERE o.id = $1`,
    [orderId]
  );
  if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });

  const row = result.rows[0];
  let tickets = [];
  if (row.order_status === "paid") {
    const ticketRes = await pool.query(
      `SELECT t.ticket_code, tt.name AS tier_name
       FROM tickets t
       JOIN order_items oi ON oi.id = t.order_item_id
       WHERE oi.order_id = $1
       ORDER BY t.id`,
      [orderId]
    );
    tickets = ticketRes.rows.map((r) => ({ ticketCode: r.ticket_code, tierName: r.tier_name }));
  }

  return res.json({ ok: true, ...row, tickets });
}

module.exports = { checkout, getOrderStatus };
