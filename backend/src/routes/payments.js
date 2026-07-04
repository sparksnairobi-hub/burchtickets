const express = require("express");
const { mpesaCallbackController, pesapalIpnController } = require("../controllers/paymentWebhookController");
const router = express.Router();

router.post("/webhook/mpesa", mpesaCallbackController);
// Pesapal's IPN is a GET ping by default (ipn_notification_type: "GET" in
// registerPesapalIpn.js) — accept both since some Pesapal configs use POST.
router.get("/webhook/pesapal", pesapalIpnController);
router.post("/webhook/pesapal", pesapalIpnController);

module.exports = router;
