const axios = require("axios");

// ============================================================
// BurchTickets event aggregator
//
// Only two of the requested sources have a public, city-searchable API
// with simple key-based auth: Ticketmaster Discovery API and PredictHQ.
// The rest are implemented honestly rather than pretending to work:
//
//   - Eventbrite:    public event *search* was shut down in Dec 2019 /
//                     Feb 2020. Today the API can only read events
//                     belonging to your own organization — there is no
//                     endpoint left that discovers arbitrary public
//                     events by city. Adapter is a documented no-op.
//   - Meetup:        API access now requires an active Meetup Pro
//                     subscription plus OAuth (no free API keys since
//                     2019). Adapter is a documented no-op unless you
//                     configure Pro OAuth credentials yourself.
//   - Bandsintown:   the public API is artist-scoped only (tour dates
//                     for ONE artist you represent) — there's no
//                     "what's on in this city" endpoint. Adapter fetches
//                     per-artist events for a configurable watchlist,
//                     which is the closest honest equivalent.
//   - Kenyabuzz,
//     Mookh,
//     TicketSasa:    no public developer APIs exist for any of these.
//                     Adapters return an empty list. The realistic path
//                     for these three is manual curation — an admin
//                     account creates an event via the normal
//                     eventController flow and tags it with
//                     source_label so it's visually marked as curated
//                     from that source in the feed.
// ============================================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map(); // key: `${city}` -> { at, data }

function normalize(ev) {
  return {
    id: ev.id,
    source: ev.source,
    sourceLabel: ev.sourceLabel,
    title: ev.title,
    venue: ev.venue || null,
    city: ev.city || null,
    startAt: ev.startAt || null,
    url: ev.url || null,
    image: ev.image || null,
  };
}

function dedupeKey(ev) {
  const day = ev.startAt ? String(ev.startAt).slice(0, 10) : "";
  return `${(ev.title || "").trim().toLowerCase()}|${day}`;
}

// ---------------- Ticketmaster Discovery API (real) ----------------
async function fetchTicketmaster(city) {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return [];

  try {
    const { data } = await axios.get("https://app.ticketmaster.com/discovery/v2/events.json", {
      params: { apikey: apiKey, city, countryCode: "KE", size: 20 },
      timeout: 8000,
    });
    const events = data?._embedded?.events || [];
    return events.map((ev) => {
      const venue = ev._embedded?.venues?.[0];
      return normalize({
        id: `tm:${ev.id}`,
        source: "ticketmaster",
        sourceLabel: "Ticketmaster",
        title: ev.name,
        venue: venue?.name,
        city: venue?.city?.name,
        startAt: ev.dates?.start?.dateTime || ev.dates?.start?.localDate,
        url: ev.url,
        image: ev.images?.[0]?.url,
      });
    });
  } catch (err) {
    console.warn("Ticketmaster adapter failed:", err.message);
    return [];
  }
}

// ---------------- PredictHQ (real) ----------------
async function fetchPredictHQ(city) {
  const token = process.env.PREDICTHQ_API_KEY;
  if (!token) return [];

  try {
    const { data } = await axios.get("https://api.predicthq.com/v1/events/", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      params: { "place.scope": undefined, q: city, country: "KE", limit: 20 },
      timeout: 8000,
    });
    const results = data?.results || [];
    return results.map((ev) =>
      normalize({
        id: `phq:${ev.id}`,
        source: "predicthq",
        sourceLabel: "PredictHQ",
        title: ev.title,
        venue: ev.entities?.[0]?.name,
        city: ev.geo?.address?.locality || city,
        startAt: ev.start,
        url: null, // PredictHQ is an intelligence feed, not a ticketing link
        image: null,
      })
    );
  } catch (err) {
    console.warn("PredictHQ adapter failed:", err.message);
    return [];
  }
}

// ---------------- Bandsintown (real, but artist-scoped) ----------------
// Configure a comma-separated watchlist of artist names in
// BANDSINTOWN_ARTISTS. This only returns events for those specific
// artists, filtered to the requested city — it cannot discover
// "everything happening in Nairobi" because Bandsintown's API doesn't
// expose that.
async function fetchBandsintown(city) {
  const appId = process.env.BANDSINTOWN_APP_ID;
  const artists = (process.env.BANDSINTOWN_ARTISTS || "").split(",").map((a) => a.trim()).filter(Boolean);
  if (!appId || artists.length === 0) return [];

  try {
    const results = await Promise.all(
      artists.map((artist) =>
        axios
          .get(`https://rest.bandsintown.com/artists/${encodeURIComponent(artist)}/events`, {
            params: { app_id: appId, date: "upcoming" },
            timeout: 8000,
          })
          .then((r) => r.data)
          .catch(() => [])
      )
    );

    return results
      .flat()
      .filter((ev) => !city || (ev.venue?.city || "").toLowerCase().includes(city.toLowerCase()))
      .map((ev) =>
        normalize({
          id: `bit:${ev.id}`,
          source: "bandsintown",
          sourceLabel: "Bandsintown",
          title: `${ev.lineup?.join(", ") || "Live"} at ${ev.venue?.name || "TBA"}`,
          venue: ev.venue?.name,
          city: ev.venue?.city,
          startAt: ev.datetime,
          url: ev.url,
          image: null,
        })
      );
  } catch (err) {
    console.warn("Bandsintown adapter failed:", err.message);
    return [];
  }
}

// ---------------- Documented no-ops ----------------
async function fetchEventbrite() {
  return []; // see header comment — no public discovery endpoint exists anymore
}
async function fetchMeetup() {
  return []; // see header comment — requires Meetup Pro + OAuth, not wired by default
}
async function fetchKenyabuzz() {
  return []; // no public API
}
async function fetchMookh() {
  return []; // no public API
}
async function fetchTicketSasa() {
  return []; // no public API
}

async function discoverEvents(city = "Nairobi") {
  const cacheKey = city.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const results = await Promise.all([
    fetchTicketmaster(city),
    fetchPredictHQ(city),
    fetchBandsintown(city),
    fetchEventbrite(),
    fetchMeetup(),
    fetchKenyabuzz(),
    fetchMookh(),
    fetchTicketSasa(),
  ]);

  const merged = results.flat();
  const seen = new Set();
  const deduped = [];
  for (const ev of merged) {
    const key = dedupeKey(ev);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }

  deduped.sort((a, b) => new Date(a.startAt || 0) - new Date(b.startAt || 0));

  cache.set(cacheKey, { at: Date.now(), data: deduped });
  return deduped;
}

module.exports = { discoverEvents };
