require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const session = require('express-session');
const path = require('path');

const app = express();
const port = 3000;

// Session Config:

app.use(session({
    secret: process.env.SESSION_SECRET || 'this-is-the-key',
    resave: false,
    saveUninitialized: true
}));

// OAUTH2 Client:
// Via Web Credentials

console.log("id check: ", process.env.GOOGLE_CLIENT_ID);

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:3000/auth/google/callback" // Redirect URL from Google Console
)

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']; // Google READONLY scope

// Look for index.html
app.use(express.static(__dirname));

// Authentication Route:
// Login Process

app.get('/login', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type:  'offline', // Used for Refresh Token
        scope: SCOPES,
        prompt: 'consent' //Forces Google to give a refresh token every time
    });
    res.redirect(url);
});

// Route where Google sends the user back:

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const {tokens} = await oauth2Client.getToken(code);
        // Save token into current session:
        req.session.tokens = tokens;
        res.send("Authenticated Successfully!");
    } catch (error) {
        console.error("Auth error: ", error);
        res.status(500).send("Authentication failed.");
    }
});

async function start(tokens) {
    
    oauth2Client.setCredentials(tokens);
    
    // The Gmail tool:
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 2. Get a list of X most recent messages
    console.log("Scanning inbox...");
    const res = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 100,
    });

    const messages = res.data.messages || [];
    const domainCounts = {};

    // 3. Loop through and extract domains (Step 3.1 in your notes)
    for (const msg of messages) {
        const details = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
        });

        // Find the "From" line in the email headers
        const fromHeader = details.data.payload.headers.find(h => h.name === 'From');
        if (fromHeader) {
            const emailMatch = fromHeader.value.match(/@([\w.-]+)/);
            if (emailMatch) {
                const domain = emailMatch[1].replace('>', '');
                domainCounts[domain] = (domainCounts[domain] || 0) + 1;
            }
        }
    } 
    
    // Convert the data into an array to sort
    const sortDomains = Object.entries(domainCounts);

    // Sort the domains
    sortDomains.sort(function(a, b){return b[1] - a[1]});

    // transforming the data to a list of objects
    const domainMap = sortDomains.map(([a, b]) => ({
        Domain: a,
        Count: b
    }));

    // 4. Output RAW DATA
    console.log("\n--- WHO OWNS YOUR INBOX? ---");

    return domainMap; // sends data back to function caller
}

app.get('/data', async (req, res) => {
    // Check if user is logged in:
    if(!req.session.tokens) {
        return res.redirect('/login');
    }

    try {
        const emailData = await start(req.session.tokens); // Pass session token to scanning function
        res.json(emailData); // sending clean list to browser
    } catch (err) {
        console.error(err); // Log the real error to the terminal
        res.status(500).send("Scanning failed.");
    }
});

// listen for visitors
app.listen(port, () => {
    console.log(`Server is live at http://localhost:${port}`);
    console.log(`Go to http://localhost:${port}/login to authenticate.`);
    //open(`http://localhost:${port}`);
    
});

