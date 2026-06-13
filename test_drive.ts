import { google } from 'googleapis';
import path from 'path';

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(process.cwd(), 'google-credentials.json'),
  scopes: ['https://www.googleapis.com/auth/drive'],
});

async function testDrive() {
    const drive = google.drive({ version: 'v3', auth });
    try {
        const res = await drive.files.list();
        console.log("Files:", res.data);
    } catch(err: any) {
        console.error("Drive Error:", err.message);
        if (err.response) console.error(JSON.stringify(err.response.data, null, 2));
    }
}

testDrive();
