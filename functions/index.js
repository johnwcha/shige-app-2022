const {onRequest} = require("firebase-functions/v2/https");
const {logger} = require("firebase-functions");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {normalizeYoutubeUrl, buildLegacyMediaIndex} = require("./hymn-media");

admin.initializeApp();

const db = admin.firestore();
const DYNAMIC_HYMNS_COLLECTION = "dynamicHymns";
const dynamicHymnAdminToken = defineSecret("DYNAMIC_HYMN_ADMIN_TOKEN");
const DYNAMIC_HYMN_EDITIONS = ["ch", "ts", "user_upload"];

function normalizeDynamicHymn(doc) {
  const data = doc.data();

  return {
    id: doc.id,
    hymnID: String(data.hymnID || "").trim(),
    edition: String(data.edition || "").trim(),
    html: String(data.html || "").trim(),
    title: String(data.title || "").trim(),
    searchText: String(data.searchText || "").trim(),
    youtubeUrl: normalizeYoutubeUrl(data.youtubeUrl),
    source: "dynamic",
    updatedAt: data.updatedAt && data.updatedAt.toDate ?
      data.updatedAt.toDate().toISOString() :
      null,
  };
}

function isValidDynamicHymn(hymn) {
  return hymn.hymnID && DYNAMIC_HYMN_EDITIONS.includes(hymn.edition) &&
    hymn.html;
}

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function buildSearchText(title, html) {
  return `${title} ${html}`
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
}

function documentIdForHymn(edition, hymnID) {
  return `${edition}-${hymnID}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function validateDynamicHymnInput(body) {
  const hymnID = String(body.hymnID || "").trim();
  const edition = String(body.edition || "").trim();
  const title = String(body.title || "").trim();
  const html = String(body.html || "").trim();
  const searchText = String(body.searchText || "").trim();
  const published = Boolean(body.published);
  const youtubeUrl = normalizeYoutubeUrl(body.youtubeUrl);

  if (body.youtubeUrl && !youtubeUrl) {
    return {error: "youtubeUrl must be a valid HTTPS YouTube video link"};
  }

  if (!hymnID) {
    return {error: "hymnID is required"};
  }

  if (!DYNAMIC_HYMN_EDITIONS.includes(edition)) {
    return {error: "edition must be 'ch', 'ts', or 'user_upload'"};
  }

  if (!html) {
    return {error: "html is required"};
  }

  return {
    hymn: {
      hymnID,
      edition,
      title,
      html,
      searchText: searchText || buildSearchText(title, html),
      // Omitted fields preserve existing links on edits; an empty string clears it.
      ...(body.youtubeUrl !== undefined ? {youtubeUrl} : {}),
      published,
    },
  };
}

exports.createDynamicHymn = onRequest(
    {cors: true, secrets: [dynamicHymnAdminToken]},
    async (req, res) => {
      try {
        if (req.method !== "POST") {
          return res.status(405).json({error: "Use POST"});
        }

        if (getBearerToken(req) !== dynamicHymnAdminToken.value()) {
          return res.status(401).json({error: "Unauthorized"});
        }

        const {error, hymn} = validateDynamicHymnInput(req.body || {});

        if (error) {
          return res.status(400).json({error});
        }

        const docId = documentIdForHymn(hymn.edition, hymn.hymnID);
        const now = admin.firestore.FieldValue.serverTimestamp();

        await db.collection(DYNAMIC_HYMNS_COLLECTION).doc(docId).set({
          ...hymn,
          updatedAt: now,
          createdAt: now,
        }, {merge: true});

        return res.status(201).json({
          success: true,
          collection: DYNAMIC_HYMNS_COLLECTION,
          id: docId,
          hymn,
        });
      } catch (error) {
        logger.error("Error in createDynamicHymn:", error);
        return res.status(500).json({
          error: "Internal server error",
          message: error.message,
        });
      }
    },
);

// Returns published Firestore hymn additions without requiring an app redeploy.
exports.getDynamicHymns = onRequest({cors: true}, async (req, res) => {
  try {
    const snapshot = await db.collection(DYNAMIC_HYMNS_COLLECTION)
        .where("published", "==", true)
        .get();

    const hymns = snapshot.docs
        .map(normalizeDynamicHymn)
        .filter(isValidDynamicHymn)
        .sort((a, b) => {
          const byEdition = a.edition.localeCompare(b.edition);

          if (byEdition !== 0) {
            return byEdition;
          }

          return Number(a.hymnID) - Number(b.hymnID);
        });

    res.set("Cache-Control", "public, max-age=60, s-maxage=300");
    return res.json({
      collection: DYNAMIC_HYMNS_COLLECTION,
      count: hymns.length,
      hymns,
    });
  } catch (error) {
    logger.error("Error in getDynamicHymns:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Cache the legacy label index per warm function instance to avoid a collection
// scan on every selection. Concurrent cold requests share the same read.
let legacyMediaCache;
let legacyMediaExpiresAt = 0;
let legacyMediaRead;

async function getLegacyMediaIndex() {
  if (legacyMediaCache && Date.now() < legacyMediaExpiresAt) {
    return legacyMediaCache;
  }
  if (!legacyMediaRead) {
    legacyMediaRead = db.collection("hymns")
        .select("hymn", "link", "updated").get()
        .then(snapshot => {
          legacyMediaCache = buildLegacyMediaIndex(snapshot.docs);
          legacyMediaExpiresAt = Date.now() + 5 * 60 * 1000;
          return legacyMediaCache;
        }).finally(() => {
          legacyMediaRead = null;
        });
  }
  return legacyMediaRead;
}

exports.getHymnYoutube = onRequest({cors: true}, async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({error: "Use GET"});
  }
  const {hymnNumber, edition} = req.query;
  if (typeof hymnNumber !== "string" || !/^\d{1,10}$/.test(hymnNumber) ||
      !DYNAMIC_HYMN_EDITIONS.includes(edition)) {
    return res.status(400).json({
      error: "Use a numeric hymnNumber and edition ch, ts, or user_upload",
    });
  }
  try {
    // Exact string matching preserves dynamic IDs such as 001, which are
    // different songs from the bundled hymn numbered 1.
    const snapshot = await db.collection(DYNAMIC_HYMNS_COLLECTION)
        .where("hymnID", "==", hymnNumber).get();
    const dynamic = snapshot.docs.filter(doc => {
      const data = doc.data();
      return data.edition === edition && data.published === true;
    }).sort((a, b) => {
      const timestamp = doc => doc.data().updatedAt?.toMillis?.() || 0;
      return timestamp(b) - timestamp(a) || a.id.localeCompare(b.id);
    });

    let youtubeUrl = null;
    let source = null;
    if (dynamic.length) {
      // A dynamic lyric override must never inherit a different song's link.
      youtubeUrl = normalizeYoutubeUrl(dynamic[0].data().youtubeUrl);
      if (youtubeUrl) source = "dynamicHymns";
    } else if (edition !== "user_upload") {
      const index = await getLegacyMediaIndex();
      youtubeUrl = index.get(`${edition}:${hymnNumber.replace(/^0+(?=\d)/, "")}`) || null;
      if (youtubeUrl) source = "hymns";
    }
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
    return res.json({success: true, hymnNumber, edition, youtubeUrl, source});
  } catch (error) {
    logger.error("Error in getHymnYoutube:", error);
    return res.status(500).json({error: "Unable to load hymn video"});
  }
});
