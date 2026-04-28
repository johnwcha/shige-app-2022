const {onRequest} = require("firebase-functions/v2/https");
const {logger} = require("firebase-functions");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

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

// Cloud Function v2 to fetch hymn mp3 links
exports.getHymnMp3 = onRequest({cors: true}, async (req, res) => {
  try {
    const {hymnNumber, edition} = req.query;

    // Validate input
    if (!hymnNumber || !edition) {
      return res.status(400).json({
        error: "Missing required parameters: hymnNumber and edition",
      });
    }

    if (!["ch", "ts"].includes(edition)) {
      return res.status(400).json({
        error: "Invalid edition. Must be 'ch' or 'ts'",
      });
    }

    logger.info(`Fetching hymn ${edition}/${hymnNumber}`);

    // Fetch the hymnal.net page
    const url = `https://www.hymnal.net/zh/hymn/${edition}/${hymnNumber}`;
    const response = await fetch(url);

    if (!response.ok) {
      logger.error(`Failed to fetch hymn page: ${response.status}`);
      return res.status(404).json({
        error: "Hymn not found",
      });
    }

    const htmlText = await response.text();

    // Extract mp3 URLs using regex
    const mp3Links = {};

    // Look for vocal mp3 (pattern: ch_XXXX_vocal.mp3 or ts_XXXX_vocal.mp3)
    // Handles both /Chinese/ (large book) and /ChineseTS/ (small book)
    const vocalMatch = htmlText.match(
        /https:\/\/www\.hymnal\.net\/Hymns\/Chinese(TS)?\/mp3\/[^"']+vocal\.mp3/,
    );
    if (vocalMatch) {
      mp3Links.vocal = vocalMatch[0];
      logger.info(`Found vocal mp3: ${vocalMatch[0]}`);
    }

    // Look for full mp3 (pattern: eXXXX_full.mp3)
    const fullMatch = htmlText.match(
        /https:\/\/www\.hymnal\.net\/Hymns\/Hymnal\/mp3\/[^"']+full\.mp3/,
    );
    if (fullMatch) {
      mp3Links.full = fullMatch[0];
      logger.info(`Found full mp3: ${fullMatch[0]}`);
    }

    // Look for instrumental mp3 (pattern: eXXXX_i.mp3)
    const instrumentalMatch = htmlText.match(
        /https:\/\/www\.hymnal\.net\/Hymns\/Hymnal\/mp3\/[^"']+_i\.mp3(\?v=\d+)?/,
    );
    if (instrumentalMatch) {
      mp3Links.instrumental = instrumentalMatch[0];
      logger.info(`Found instrumental mp3: ${instrumentalMatch[0]}`);
    }

    // Look for NewSongs mp3 (pattern: nsXXXX.mp3)
    const newSongsMatch = htmlText.match(
        /https:\/\/www\.hymnal\.net\/Hymns\/NewSongs\/mp3\/[^"']+\.mp3(\?v=\d+)?/,
    );
    if (newSongsMatch) {
      // Treat NewSongs as music (since they're typically full recordings)
      if (!mp3Links.full) {
        mp3Links.full = newSongsMatch[0];
        logger.info(`Found NewSongs mp3: ${newSongsMatch[0]}`);
      }
    }

    // Return the mp3 links
    return res.json({
      success: true,
      hymnNumber,
      edition,
      mp3Links,
    });
  } catch (error) {
    logger.error("Error in getHymnMp3:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});
