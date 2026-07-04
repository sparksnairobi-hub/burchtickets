const express = require("express");
const { optionalBuyerAuth } = require("../middleware/auth");
const { checkout, getOrderStatus } = require("../controllers/checkoutController");
const router = express.Router();

router.post("/", optionalBuyerAuth, checkout);
router.get("/:orderId/status", getOrderStatus);

module.exports = router;
