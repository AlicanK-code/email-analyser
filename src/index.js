const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const { scanInbox, statusOf } = require('./gmail');

const PORT = Number(process.env.PORT) || 3000;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const SESSION_COOKIE = 'email-analyser.sid';

// Refuse to start without the secrets, rather than falling back to defaults.
const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET'].filter(k => !process.env[k]);
if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
}

const app = express();
app.disable('x-powered-by');

app.use(session({
    name: SESSION_COOKIE,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 1000, // 1 hour, matching Google's access token lifetime
    },
}));

// Only the public/ folder is served, so server code and config stay private.
app.use(express.static(path.join(__dirname, '..', 'public')));

// A fresh OAuth client per request, so one user's tokens are never shared with another.
function createOAuthClient() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        REDIRECT_URI,
    );
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Returns a whole number in range, or null if the input is invalid.
function parseLimit(raw) {
    if (raw === undefined) return DEFAULT_LIMIT;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= MAX_LIMIT ? n : null;
}

// --- Auth routes ---

app.get('/login', (req, res) => {
    // Random state value ties Google's callback to this browser session (prevents login CSRF).
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauthState = state;

    const url = createOAuthClient().generateAuthUrl({
        access_type: 'online', // tokens live only in the session, so no refresh token is needed
        scope: SCOPES,
        state,
    });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const expectedState = req.session.oauthState;
    delete req.session.oauthState;

    if (error) return res.redirect('/?auth=denied');
    if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
        return res.status(400).send('Invalid sign-in attempt. Please go back and try again.');
    }

    try {
        const { tokens } = await createOAuthClient().getToken(code);
        // New session ID after login, so a pre-login session ID can't be reused.
        req.session.regenerate(err => {
            if (err) {
                console.error('Session error:', err);
                return res.status(500).send('Sign-in failed.');
            }
            req.session.tokens = tokens;
            res.redirect('/');
        });
    } catch (err) {
        console.error('Auth error:', err.message);
        res.status(500).send('Sign-in failed.');
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie(SESSION_COOKIE);
        res.status(204).end();
    });
});

// --- API routes ---

app.get('/api/status', (req, res) => {
    res.json({ authenticated: Boolean(req.session.tokens) });
});

app.get('/data', async (req, res) => {
    // 401 rather than a redirect: fetch() can't follow a redirect to Google's sign-in page.
    if (!req.session.tokens) {
        return res.status(401).json({ error: 'not_authenticated', message: 'Please sign in.' });
    }

    const limit = parseLimit(req.query.max);
    if (limit === null) {
        return res.status(400).json({
            error: 'invalid_max',
            message: `max must be a whole number between 1 and ${MAX_LIMIT}.`,
        });
    }

    const auth = createOAuthClient();
    auth.setCredentials(req.session.tokens);

    try {
        res.json(await scanInbox(auth, limit));
    } catch (err) {
        if (statusOf(err) === 401) {
            delete req.session.tokens;
            return res.status(401).json({ error: 'session_expired', message: 'Your sign-in expired.' });
        }
        console.error('Scan failed:', err.message);
        res.status(500).json({ error: 'scan_failed', message: 'Scanning failed. Check the server logs.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is live at http://localhost:${PORT}`);
});
