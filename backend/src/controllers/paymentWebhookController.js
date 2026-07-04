const pool = require("../config/db");
const { enqueueConfirmationEmail } = require("../services/emailQueue");
const { getTransactionStatus } = require("../services/pesapalService");

function parseCallback(reqBody) {
  const stk = reqBody?.Body?.stkCallback;
  if (!stk) return null;

  const items = stk.CallbackMetadata?.Item || [];
  const meta = {};
  for (const item of items) if (item.Name) meta[item.Name] = item.Value;

  return {
    checkoutRequestId: stk.CheckoutRequestID,
    merchantRequestId: stk.MerchantRequestID,
    resultCode: stk.ResultCode,
    resultDesc: stk.ResultDesc,
    receipt: meta.MpesaReceiptNumber || null,
    amount: meta.Amount || null,
    phoneNumber: meta.PhoneNumber || null,
    raw: stk,
  };
}

async function mpesaCallbackController(req, res) {
  const payload = parseCallback(req.body);
  if (!payload || !payload.checkoutRequestId) {
    return res.status(400).json({ ok: false, error: "INVALID_CALLBACK_PAYLOAD" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Dedupe on the M-Pesa checkout request id
    const insertWebhook = await client.query(
      `INSERT INTO webhook_events (provider, event_id, event_type, payload, raw_body, status)
       VALUES ('mpesa', $1, 'stk_callback', $2::jsonb, $3, 'verified')
       ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [payload.checkoutRequestId, req.body, JSON.stringify(req.body)]
    );
    if (insertWebhook.rowCount === 0) {
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const paymentRes = await client.query(
      `SELECT p.id, p.order_id, p.status, o.company_id, o.buyer_email, o.buyer_name
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.checkout_request_id = $1 FOR UPDATE`,
      [payload.checkoutRequestId]
    );

    if (paymentRes.rowCount === 0) {
      await client.query(
        `UPDATE webhook_events SET status='failed', failure_reason='PAYMENT_NOT_FOUND', processed_at=NOW() WHERE provider='mpesa' AND event_id=$1`,
        [payload.checkoutRequestId]
      );
      await client.query("COMMIT");
      return res.status(200).json({ ok: true });
    }

    const payment = paymentRes.rows[0];

    if (Number(payload.resultCode) !== 0) {
      await client.query(`UPDATE payments SET status='failed', failed_at=NOW(), raw_payload=$2::jsonb, updated_at=NOW() WHERE id=$1`, [payment.id, req.body]);
      await client.query(`UPDATE orders SET status='failed', cancelled_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='pending'`, [payment.order_id]);
      await client.query(`UPDATE booking_sessions SET status='failed', updated_at=NOW() WHERE order_id=$1`, [payment.order_id]);
      await client.query(`UPDATE webhook_events SET status='processed', processed_at=NOW() WHERE provider='mpesa' AND event_id=$1`, [payload.checkoutRequestId]);
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, success: false });
    }

    await client.query(
      `UPDATE payments SET status='successful', provider_ref=COALESCE(provider_ref,$2), raw_payload=$3::jsonb, paid_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [payment.id, payload.receipt || payload.checkoutRequestId, req.body]
    );

    await client.query("SELECT confirm_booking($1, $2)", [payment.order_id, payment.id]);
    await client.query(`UPDATE webhook_events SET status='processed', processed_at=NOW() WHERE provider='mpesa' AND event_id=$1`, [payload.checkoutRequestId]);

    await client.query("COMMIT");

    await enqueueConfirmationEmail({
      companyId: payment.company_id,
      orderId: payment.order_id,
      recipientEmail: payment.buyer_email,
      recipientName: payment.buyer_name,
      templateKey: "payment_confirmation",
    });

    return res.status(200).json({ ok: true, success: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ ok: false, error: "MPESA_CALLBACK_FAILED" });
  } finally {
    client.release();
  }
}

// Pesapal calls this as a GET with ?OrderTrackingId=...&OrderMerchantReference=...
// It's a notification only — never trust it directly. We always re-verify
// the real status via GetTransactionStatus before touching the order.
async function pesapalIpnController(req, res) {
  const orderTrackingId = req.query.OrderTrackingId || req.query.orderTrackingId;
  const merchantReference = req.query.OrderMerchantReference || req.query.orderMerchantReference || "";

  const respond = (status) =>
    res.status(200).json({
      orderNotificationType: "IPNCHANGE",
      orderTrackingId: orderTrackingId || null,
      orderMerchantReference: merchantReference,
      status,
    });

  if (!orderTrackingId) return respond(400);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertWebhook = await client.query(
      `INSERT INTO webhook_events (provider, event_id, event_type, payload, raw_body, status)
       VALUES ('pesapal', $1, 'ipn', $2::jsonb, $3, 'verified')
       ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [orderTrackingId, req.query, JSON.stringify(req.query)]
    );
    if (insertWebhook.rowCount === 0) {
      await client.query("COMMIT");
      return respond(200);
    }

    const paymentRes = await client.query(
      `SELECT p.id, p.order_id, p.status, o.company_id, o.buyer_email, o.buyer_name
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.checkout_request_id = $1 AND p.provider = 'pesapal' FOR UPDATE`,
      [orderTrackingId]
    );

    if (paymentRes.rowCount === 0) {
      await client.query(
        `UPDATE webhook_events SET status='failed', failure_reason='PAYMENT_NOT_FOUND', processed_at=NOW() WHERE provider='pesapal' AND event_id=$1`,
        [orderTrackingId]
      );
      await client.query("COMMIT");
      return respond(200);
    }

    const payment = paymentRes.rows[0];

    // Ask Pesapal directly what the real status is — the IPN ping itself
    // carries no trustworthy payment result.
    const statusData = await getTransactionStatus(orderTrackingId);
    const description = String(statusData.payment_status_description || "").toUpperCase();

    if (description !== "COMPLETED") {
      const terminal = ["FAILED", "INVALID", "REVERSED"].includes(description);
      if (terminal) {
        await client.query(`UPDATE payments SET status='failed', failed_at=NOW(), raw_payload=$2::jsonb, updated_at=NOW() WHERE id=$1`, [payment.id, statusData]);
        await client.query(`UPDATE orders SET status='failed', cancelled_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='pending'`, [payment.order_id]);
        await client.query(`UPDATE booking_sessions SET status='failed', updated_at=NOW() WHERE order_id=$1`, [payment.order_id]);
      }
      await client.query(`UPDATE webhook_events SET status='processed', processed_at=NOW() WHERE provider='pesapal' AND event_id=$1`, [orderTrackingId]);
      await client.query("COMMIT");
      return respond(200);
    }

    await client.query(
      `UPDATE payments SET status='successful', raw_payload=$2::jsonb, paid_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [payment.id, statusData]
    );

    await client.query("SELECT confirm_booking($1, $2)", [payment.order_id, payment.id]);
    await client.query(`UPDATE webhook_events SET status='processed', processed_at=NOW() WHERE provider='pesapal' AND event_id=$1`, [orderTrackingId]);

    await client.query("COMMIT");

    await enqueueConfirmationEmail({
      companyId: payment.company_id,
      orderId: payment.order_id,
      recipientEmail: payment.buyer_email,
      recipientName: payment.buyer_name,
      templateKey: "payment_confirmation",
    });

    return respond(200);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return respond(500);
  } finally {
    client.release();
  }
}

module.exports = { mpesaCallbackController, pesapalIpnController };
