import { syncToGoogleSheets } from './api/google_sheets.js';

async function test() {
    await syncToGoogleSheets({
        EntryTimestamp: new Date().toISOString(),
        RollID: 'TEST-001'
    });
}

test().catch(console.error);
