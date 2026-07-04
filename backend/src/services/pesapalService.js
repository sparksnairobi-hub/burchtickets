const axios = require("axios");

// Pesapal API v3. Sandbox vs live is just a different base URL — same
// consumer key/secret shape as everything else in this codebase.
const BASE_URL =
  process.env.PESAPAL_ENV === "live"
    ? "https://pay.pesapal.com/v3"
    : "https://cybqa.pesapal.com/pesapalv3";

let cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 10_000) {
    return cachedToken.token;
  }

  const { data } = await axios.post(
    `${BASE_URL}/api/Auth/RequestToken`,
    {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
    },
    { headers: { "Content-Type": "application/json", Accept: "application/json" }, timeout: 30000 }
  );

  if (!data.token) {
    const err = new Error(data.error?.message || "PESAPAL_AUTH_FAILED");
    err.raw = data;
    throw err;
  }

  // Tokens are valid for 5 minutes per Pesapal's docs — cache conservatively.
  cachedToken = { token: data.token, expiresAt: Date.now() + 4 * 60 * 1000 };
  return data.token;
}

/**
 * Registers this server's IPN (webhook) URL with Pesapal and returns an
 * ipn_id. Pesapal requires this to be done once per IPN URL — the id is
 * then reused on every order request. Call this once (see
 * scripts/registerPesapalIpn.js) and paste the returned id into
 * PESAPAL_IPN_ID in your .env; there's no need to call it per-order.
 */
async function registerIpn(url) {
  const token = await getAccessToken();
  const { data } = await axios.post(
    `${BASE_URL}/api/URLSetup/RegisterIPN`,
    { url, ipn_notification_type: "GET" },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" }, timeout: 30000 }
  );
  return data; // { url, ipn_id, ... }
}

/**
 * Kicks off a Pesapal hosted checkout. Returns a redirect_url — send the
 * buyer's browser there (full redirect or iframe) to complete payment by
 * card, M-Pesa, Airtel Money, etc. through Pesapal's own page.
 */
async function submitOrderRequest({ orderId, amount, currency, description, callbackUrl, buyerEmail, buyerPhone, buyerName }) {
  const token = await getAccessToken();
  const ipnId = process.env.PESAPAL_IPN_ID;
  if (!ipnId) {
    const err = new Error("PESAPAL_IPN_ID_NOT_SET");
    throw err;
  }

  const [firstName, ...rest] = String(buyerName || "Guest").trim().split(/\s+/);
  const lastName = rest.join(" ") || firstName;

  const payload = {
    id: `ORDER-${orderId}-${Date.now()}`, // must be unique per attempt
    currency: currency || "KES",
    amount: Number(amount),
    description: description || `Ticket payment for order ${orderId}`,
    callback_url: callbackUrl,
    notification_id: ipnId,
    billing_address: {
      email_address: buyerEmail,
      phone_number: buyerPhone,
      first_name: firstName,
      last_name: lastName,
      country_code: "KE",
    },
  };

  const { data } = await axios.post(`${BASE_URL}/api/Transactions/SubmitOrderRequest`, payload, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    timeout: 30000,
  });

  if (data.error) {
    const err = new Error(data.error.message || "PESAPAL_SUBMIT_ORDER_FAILED");
    err.raw = data;
    throw err;
  }

  return {
    provider: "pesapal",
    providerRef: data.order_tracking_id,
    merchantReference: data.merchant_reference || payload.id,
    redirectUrl: data.redirect_url,
    raw: data,
  };
}

/**
 * Polls Pesapal for the current status of a previously-submitted order.
 * payment_status_description is one of: COMPLETED, FAILED, INVALID, REVERSED.
 */
async function getTransactionStatus(orderTrackingId) {
  const token = await getAccessToken();
  const { data } = await axios.get(`${BASE_URL}/api/Transactions/GetTransactionStatus`, {
    params: { orderTrackingId },
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    timeout: 30000,
  });
  return data;
}

module.exports = { getAccessToken, registerIpn, submitOrderRequest, getTransactionStatus };
