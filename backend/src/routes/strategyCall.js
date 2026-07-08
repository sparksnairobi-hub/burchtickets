const express = require('express');
const router = express.Router();
const { createStrategyCall } = require('../services/strategyService');

// POST /api/strategy-call
// Body: { name, email, phone, company, preferredDate, message, source }
router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, company, preferredDate, message, source } = req.body || {};
    if (!name || !email) return res.status(400).json({ ok:false, error: 'MISSING_FIELDS' });
    const id = await createStrategyCall({ name, email, phone, company, preferredDate, message, source });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('strategy-call error', err);
    next(err);
  }
});

module.exports = router;
