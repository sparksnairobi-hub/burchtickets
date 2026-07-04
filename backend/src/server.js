require("dotenv").config();
const app = require("./app");
const { startEmailWorker } = require("./services/emailQueue");

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`BurchTickets backend listening on port ${PORT}`);
});

// Requires Redis to be running. Comment this out if you don't need
// async confirmation emails yet.
try {
  startEmailWorker();
  console.log("Email confirmation worker started.");
} catch (err) {
  console.warn("Email worker not started (is Redis running?):", err.message);
}
