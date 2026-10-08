const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractDomain, countDomains, mapWithConcurrency, listMessageIds } = require('../src/gmail');

test('extractDomain reads the address inside angle brackets', () => {
    assert.equal(extractDomain('Amazon <shipment@amazon.co.uk>'), 'amazon.co.uk');
    assert.equal(extractDomain('"@brand" <news@mail.brand.com>'), 'mail.brand.com');
});

test('extractDomain handles bare addresses and normalises case', () => {
    assert.equal(extractDomain('Someone@Example.COM'), 'example.com');
    assert.equal(extractDomain('user@example.com (Display Name)'), 'example.com');
});

test('extractDomain returns null for missing or unusable headers', () => {
    assert.equal(extractDomain(undefined), null);
    assert.equal(extractDomain(''), null);
    assert.equal(extractDomain('Mailer Daemon'), null);
});

test('countDomains counts, sorts by count, then alphabetically', () => {
    const result = countDomains(['b.com', 'a.com', 'c.com', 'a.com', null, 'b.com', 'a.com']);
    assert.deepEqual(result, [
        { domain: 'a.com', count: 3 },
        { domain: 'b.com', count: 2 },
        { domain: 'c.com', count: 1 },
    ]);
});

test('mapWithConcurrency keeps order and respects the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async n => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight--;
        return n * 10;
    });
    assert.deepEqual(result, [10, 20, 30, 40, 50, 60]);
    assert.equal(peak, 2);
});

test('mapWithConcurrency rejects when a call fails', async () => {
    await assert.rejects(
        mapWithConcurrency([1, 2, 3], 2, async n => {
            if (n === 2) throw new Error('boom');
            return n;
        }),
        /boom/,
    );
});

test('listMessageIds follows page tokens and stops at the limit', async () => {
    const pages = {
        undefined: { messages: [{ id: '1' }, { id: '2' }], nextPageToken: 'p2' },
        p2: { messages: [{ id: '3' }, { id: '4' }], nextPageToken: 'p3' },
        p3: { messages: [{ id: '5' }] },
    };
    const calls = [];
    const fakeGmail = {
        users: {
            messages: {
                list: async params => {
                    calls.push(params);
                    return { data: pages[params.pageToken] };
                },
            },
        },
    };

    const ids = await listMessageIds(fakeGmail, 3);
    assert.deepEqual(ids, ['1', '2', '3']);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].labelIds, ['INBOX']);
});
