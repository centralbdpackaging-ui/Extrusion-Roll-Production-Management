import { google } from 'googleapis';
import path from 'path';

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(process.cwd(), 'google-credentials.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function testSheets() {
    const sheets = google.sheets({ version: 'v4', auth });
    try {
        const createRes = await sheets.spreadsheets.create({
            requestBody: {
              properties: { title: "Test Sheet" }
            }
        });
        console.log("Sheet ID:", createRes.data.spreadsheetId);
    } catch(err: any) {
        console.error("Sheets Error:", err.message);
        if (err.response) console.error(JSON.stringify(err.response.data, null, 2));
    }
}

testSheets();
