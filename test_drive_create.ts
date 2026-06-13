import { google } from 'googleapis';
import path from 'path';

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(process.cwd(), 'google-credentials.json'),
  scopes: ['https://www.googleapis.com/auth/drive'],
});

async function testDriveCreate() {
    const drive = google.drive({ version: 'v3', auth });
    try {
        const res = await drive.files.create({
            requestBody: {
                name: "Test Spreadsheet",
                mimeType: "application/vnd.google-apps.spreadsheet"
            }
        });
        console.log("File ID:", res.data.id);
    } catch(err: any) {
        console.error("Drive Error:", err.message);
        if (err.response) console.error(JSON.stringify(err.response.data, null, 2));
    }
}

testDriveCreate();
