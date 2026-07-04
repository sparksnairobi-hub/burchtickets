const jwt = require("jsonwebtoken");

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "MISSING_TOKEN" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = decoded; // { userId, companyId, role }
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
}

// Buyer accounts use a distinctly-shaped token (role: 'buyer', buyerId) so
// a company JWT can never be replayed against buyer-only routes and vice versa.
function requireBuyerAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "MISSING_TOKEN" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "buyer" || !decoded.buyerId) {
      return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
    }
    req.auth = decoded; // { buyerId, role: 'buyer' }
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
}

// Checkout stays guest-friendly: this never rejects the request. If a valid
// buyer token is attached, req.buyerId is set so the order can be linked to
// an account; otherwise checkout proceeds anonymously exactly as before.
function optionalBuyerAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role === "buyer" && decoded.buyerId) {
      req.buyerId = decoded.buyerId;
    }
  } catch (err) {
    // ignore — an invalid/expired token just means "checkout as guest"
  }
  next();
}

module.exports = { requireAuth, requireBuyerAuth, optionalBuyerAuth };
