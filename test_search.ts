import { google } from 'googleapis';
import path from 'path';

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(process.cwd(), 'google-credentials.json'),
  scopes: ['https://www.googleapis.com/auth/drive'],
});

async function testCurrentSearch() {
  const drive = google.drive({ version: 'v3', auth });
  const query = 'name="Production Records (Lifetime)" and mimeType="application/vnd.google-apps.spreadsheet" and trashed=false';
  const res = await drive.files.list({
    q: query,
    fields: 'files(id, name)'
  });
  console.log("Normal query:", res.data.files);
}

testCurrentSearch();
