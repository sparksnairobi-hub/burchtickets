const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const INK = "#1C1B19";
const INK_SOFT = "#5B564C";
const CHAMPAGNE = "#B08D57";
const WINE = "#7A2E43";
const PEARL = "#F7F5F2";
const LINE = "#E4DFD6";

/**
 * Renders one premium ticket as a PDF Buffer.
 * `ticket`   { ticketCode, holderName, holderEmail }
 * `event`    { title, venueName, venueCity, startAt }
 * `tier`     { name, price, currency }
 * `order`    { id }
 * `companyName` string — the organizer's registered company name
 */
async function buildTicketPdf({ ticket, event, tier, order, companyName }) {
  const qrDataUrl = await QRCode.toDataURL(
    `https://burchtickets.com/verify/${ticket.ticketCode}`,
    { margin: 0, color: { dark: "#1C1B19", light: "#00000000" }, width: 400 }
  );
  const qrImage = Buffer.from(qrDataUrl.split(",")[1], "base64");

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [612, 288], margin: 0 }); // wide ticket, 8.5in x 4in
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const stubWidth = 190;
    const mainWidth = 612 - stubWidth;

    // ---- main panel ----
    doc.rect(0, 0, mainWidth, 288).fill(INK);

    doc.fillColor(CHAMPAGNE).font("Helvetica-Bold").fontSize(10)
      .text("B U R C H T I C K E T S", 34, 30, { characterSpacing: 1 });

    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(24)
      .text(event.title, 34, 56, { width: mainWidth - 68 });

    doc.fillColor("#C9C4B8").font("Helvetica").fontSize(11)
      .text(`${event.venueName}, ${event.venueCity}`, 34, 96)
      .text(new Date(event.startAt).toLocaleString("en-KE", {
        weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
      }), 34, 114);

    doc.moveTo(34, 150).lineTo(mainWidth - 34, 150).strokeColor("#3A3733").lineWidth(1).stroke();

    doc.fillColor(CHAMPAGNE).font("Helvetica-Bold").fontSize(9).text("TICKET HOLDER", 34, 168);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(14).text(ticket.holderName, 34, 182);

    doc.fillColor(CHAMPAGNE).font("Helvetica-Bold").fontSize(9).text("TIER", 34, 212);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(14).text(tier.name, 34, 226);

    doc.fillColor(CHAMPAGNE).font("Helvetica-Bold").fontSize(9).text("PRICE PAID", 250, 168);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(14).text(`${tier.currency || "KES"} ${tier.price}`, 250, 182);

    doc.fillColor(CHAMPAGNE).font("Helvetica-Bold").fontSize(9).text("ORGANIZED BY", 250, 212);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(14).text(companyName, 250, 226, { width: mainWidth - 284 });

    doc.fillColor("#8A8578").font("Helvetica").fontSize(8)
      .text(`Order #${order.id}  ·  Issued by BurchTickets  ·  This ticket is valid for one entry only`, 34, 262);

    // ---- perforation ----
    const perfX = mainWidth;
    for (let y = 6; y < 288; y += 12) {
      doc.circle(perfX, y, 3).fill(PEARL);
    }

    // ---- stub panel ----
    doc.rect(mainWidth, 0, stubWidth, 288).fill(PEARL);

    doc.fillColor(WINE).font("Helvetica-Bold").fontSize(9)
      .text("ADMIT ONE", mainWidth + 24, 26, { characterSpacing: 1 });

    doc.image(qrImage, mainWidth + 24, 46, { width: 130, height: 130 });

    doc.fillColor(INK_SOFT).font("Helvetica").fontSize(8).text("TICKET CODE", mainWidth + 24, 190);
    doc.fillColor(INK).font("Courier-Bold").fontSize(15).text(ticket.ticketCode, mainWidth + 24, 202, { width: stubWidth - 48 });

    doc.moveTo(mainWidth + 24, 236).lineTo(612 - 24, 236).strokeColor(LINE).lineWidth(1).stroke();

    doc.fillColor(INK_SOFT).font("Helvetica").fontSize(7.5)
      .text("Scan at the door. Screenshots accepted.\nOne code = one entry.", mainWidth + 24, 244, { width: stubWidth - 48, lineGap: 2 });

    doc.end();
  });
}

module.exports = { buildTicketPdf };
