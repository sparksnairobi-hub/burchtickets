// Run once after deploying, whenever PESAPAL_CALLBACK_URL's domain changes,
// or when switching between sandbox and live Pesapal credentials:
//
//   node src/scripts/registerPesapalIpn.js
//
// It registers PESAPAL_IPN_URL with Pesapal and prints the ipn_id you need
// to paste into PESAPAL_IPN_ID in your .env before checkout will work.
require("dotenv").config();
const { registerIpn } = require("../services/pesapalService");

async function main() {
  const url = process.env.PESAPAL_IPN_URL;
  if (!url) {
    console.error("Set PESAPAL_IPN_URL in .env first, e.g. https://api.yourdomain.com/api/payments/webhook/pesapal");
    process.exit(1);
  }
  try {
    const result = await registerIpn(url);
    console.log("Registered Pesapal IPN:");
    console.log(result);
    console.log(`\nAdd this to your .env:\nPESAPAL_IPN_ID=${result.ipn_id}`);
  } catch (err) {
    console.error("Failed to register IPN:", err.response?.data || err.message);
    process.exit(1);
  }
}

main();
