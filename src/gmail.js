const { google } = require('googleapis');

const GMAIL_PAGE_SIZE = 500; // the most Gmail returns per list call
const CONCURRENCY = 10;      // parallel requests; stays well inside Gmail's per-user quota

// Pull the HTTP status out of a googleapis/gaxios error, if there is one.
function statusOf(err) {
    return err?.response?.status ?? err?.status;
}

// Collect up to `limit` message IDs from the inbox, following page tokens.
async function listMessageIds(gmail, limit) {
    const ids = [];
    let pageToken;

    do {
        const { data } = await gmail.users.messages.list({
            userId: 'me',
            labelIds: ['INBOX'],
            maxResults: Math.min(limit - ids.length, GMAIL_PAGE_SIZE),
            pageToken,
        });
        for (const msg of data.messages || []) ids.push(msg.id);
        pageToken = data.nextPageToken;
    } while (pageToken && ids.length < limit);

    return ids.slice(0, limit);
}

// "Name <user@mail.example.com>" -> "mail.example.com"
// Reads the address inside <...> first, so an "@" in the display name
// (e.g. "@brand" <news@brand.com>) can't be mistaken for the sender.
function extractDomain(fromHeader) {
    if (!fromHeader) return null;

    const angle = fromHeader.match(/<([^>]*)>/);
    const address = angle ? angle[1] : fromHeader;
    const match = address.match(/@([a-z0-9.-]+)/i);
    if (!match) return null;

    const domain = match[1].toLowerCase().replace(/^\.+|\.+$/g, '');
    return domain || null;
}

// Run `fn` over `items` with at most `limit` calls in flight.
// Stops handing out new work as soon as one call fails.
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    let failed = false;

    async function worker() {
        while (!failed && next < items.length) {
            const i = next++;
            try {
                results[i] = await fn(items[i]);
            } catch (err) {
                failed = true;
                throw err;
            }
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);
    return results;
}

async function getSenderDomain(gmail, id) {
    try {
        // Metadata only: downloads the From header, not the whole email.
        const { data } = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From'],
        });
        const headers = data.payload?.headers || [];
        const from = headers.find(h => h.name.toLowerCase() === 'from');
        return extractDomain(from?.value);
    } catch (err) {
        if (statusOf(err) === 404) return null; // deleted while we were scanning
        throw err;
    }
}

// ["a.com", "b.com", "a.com", null] -> [{ domain: "a.com", count: 2 }, { domain: "b.com", count: 1 }]
function countDomains(domains) {
    const counts = new Map();
    for (const domain of domains) {
        if (domain) counts.set(domain, (counts.get(domain) || 0) + 1);
    }
    return [...counts]
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

async function scanInbox(auth, limit) {
    const gmail = google.gmail({ version: 'v1', auth });
    const ids = await listMessageIds(gmail, limit);
    const domains = await mapWithConcurrency(ids, CONCURRENCY, id => getSenderDomain(gmail, id));
    return { scanned: ids.length, domains: countDomains(domains) };
}

module.exports = {
    scanInbox,
    extractDomain,
    countDomains,
    mapWithConcurrency,
    listMessageIds,
    statusOf,
};
