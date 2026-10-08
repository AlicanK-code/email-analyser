const retrieveBtn = document.getElementById('btn');
const signOutBtn = document.getElementById('signOut');
const statusText = document.getElementById('status');
const table = document.getElementById('emailTable');
const tableBody = document.getElementById('tableBody');
const maxInput = document.getElementById('maxResults');
const inputError = document.getElementById('inputError');
const saveBtn = document.getElementById('saveSettings');
const modalEl = document.getElementById('staticBackdrop');

const MIN = Number(maxInput.min);
const MAX = Number(maxInput.max);
const STORAGE_KEY = 'emailAnalyser.maxResults';

let signedIn = false;
let maxResults = loadMaxResults();

function isValidMax(n) {
    return Number.isInteger(n) && n >= MIN && n <= MAX;
}

function loadMaxResults() {
    try {
        const saved = Number(localStorage.getItem(STORAGE_KEY));
        if (isValidMax(saved)) return saved;
    } catch { /* storage unavailable, use the default */ }
    return Number(maxInput.value);
}

function setStatus(message) {
    statusText.textContent = message;
}

function setSignedIn(value) {
    signedIn = value;
    retrieveBtn.textContent = value ? 'Retrieve' : 'Sign in with Google';
    retrieveBtn.disabled = false;
    signOutBtn.hidden = !value;
}

function renderTable(domains) {
    const fragment = document.createDocumentFragment();

    if (domains.length === 0) {
        const row = fragment.appendChild(document.createElement('tr'));
        const cell = row.appendChild(document.createElement('td'));
        cell.colSpan = 2;
        cell.textContent = 'No emails found.';
    }

    for (const { domain, count } of domains) {
        const row = fragment.appendChild(document.createElement('tr'));
        row.appendChild(document.createElement('td')).textContent = domain;
        const badge = row.appendChild(document.createElement('td')).appendChild(document.createElement('span'));
        badge.className = 'badge bg-secondary';
        badge.textContent = count;
    }

    tableBody.replaceChildren(fragment);
    table.style.display = 'table';
}

async function retrieve() {
    retrieveBtn.disabled = true;
    retrieveBtn.textContent = 'Loading...';
    setStatus(`Scanning up to ${maxResults} emails...`);

    try {
        const response = await fetch(`/data?max=${maxResults}`);
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }

        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || `Server returned ${response.status}`);

        renderTable(body.domains);
        setStatus(`Scanned ${body.scanned} emails from ${body.domains.length} domains.`);
        retrieveBtn.textContent = 'Complete';

        window.setTimeout(() => {
            retrieveBtn.textContent = 'Retrieve';
            retrieveBtn.disabled = false;
        }, 1000);
    } catch (err) {
        console.error('Fetch error:', err);
        setStatus(`Something went wrong: ${err.message}`);
        retrieveBtn.textContent = 'Retrieve';
        retrieveBtn.disabled = false;
    }
}

retrieveBtn.addEventListener('click', () => {
    if (signedIn) retrieve();
    else window.location.href = '/login';
});

signOutBtn.addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' }).catch(() => {});
    setSignedIn(false);
    tableBody.replaceChildren();
    table.style.display = 'none';
    setStatus('Signed out.');
});

// --- Settings modal ---

modalEl.addEventListener('show.bs.modal', () => {
    maxInput.value = maxResults;
    inputError.style.display = 'none';
});

saveBtn.addEventListener('click', () => {
    const value = Number(maxInput.value);
    if (!isValidMax(value)) {
        inputError.textContent = `Enter a whole number between ${MIN} and ${MAX}.`;
        inputError.style.display = 'block';
        return;
    }

    maxResults = value;
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* not critical */ }
    bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    setStatus(`Will scan up to ${value} emails.`);
});

maxInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveBtn.click();
});

// --- Start-up ---

async function init() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'denied') setStatus('Sign-in was cancelled.');
    if (params.has('auth')) window.history.replaceState(null, '', window.location.pathname);

    try {
        const response = await fetch('/api/status');
        const { authenticated } = await response.json();
        setSignedIn(authenticated);
    } catch {
        setStatus('Could not reach the server.');
    }
}

init();
