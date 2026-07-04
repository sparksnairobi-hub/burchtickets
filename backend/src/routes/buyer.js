const express = require("express");
const { requireBuyerAuth } = require("../middleware/auth");
const { myOrders } = require("../controllers/buyerController");
const router = express.Router();

router.get("/orders", requireBuyerAuth, myOrders);

module.exports = router;
