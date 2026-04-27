const {onRequest} = require("firebase-functions/v2/https");
const {logger} = require("firebase-functions");

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
