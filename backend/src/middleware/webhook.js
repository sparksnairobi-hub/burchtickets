const crypto = require("crypto");

function timingSafeEqualBase64(a, b) {
  const ab = Buffer.from(a, "base64");
  const bb = Buffer.from(b, "base64");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function rawBodySaver(req, res, buf) {
  if (buf && buf.length) req.rawBody = buf;
}

// NOTE: Safaricom's Daraja callback does not sign its payloads the way a typical
// webhook provider does. In production, treat MPESA_CALLBACK_URL as a secret,
// serve it over HTTPS, and consider an additional shared-secret query param
// or IP allowlist as defense in depth. This middleware is written generically
// so it also works for any provider that *does* sign requests (card gateways, etc).
function verifyWebhookSignature({
  secret,
  signatureHeader = "x-webhook-signature",
  timestampHeader = "x-webhook-timestamp",
  toleranceSeconds = 300,
  required = true,
}) {
  return function (req, res, next) {
    try {
      if (!required) return next();

      const rawBody = req.rawBody;
      if (!rawBody) return res.status(400).json({ ok: false, error: "RAW_BODY_MISSING" });

      const signature = req.headers[signatureHeader];
      const timestamp = req.headers[timestampHeader];
      if (!signature || !timestamp) {
        return res.status(401).json({ ok: false, error: "MISSING_SIGNATURE_HEADERS" });
      }

      const ts = Number(timestamp);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSeconds) {
        return res.status(401).json({ ok: false, error: "WEBHOOK_TIMESTAMP_INVALID" });
      }

      const payloadToSign = `${timestamp}.${rawBody.toString("utf8")}`;
      const expected = crypto.createHmac("sha256", secret).update(payloadToSign).digest("base64");

      if (!timingSafeEqualBase64(expected, signature)) {
        return res.status(401).json({ ok: false, error: "INVALID_SIGNATURE" });
      }

      req.webhookMeta = { signature, timestamp: ts, rawBody: rawBody.toString("utf8") };
      next();
    } catch (err) {
      return res.status(500).json({ ok: false, error: "WEBHOOK_VERIFICATION_FAILED" });
    }
  };
}

module.exports = { rawBodySaver, verifyWebhookSignature };
