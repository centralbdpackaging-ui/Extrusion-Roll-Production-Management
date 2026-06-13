import { google } from 'googleapis';
import path from 'path';

// Authenticate using the service account credential
let auth: any;

if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
    });
  } catch (error) {
    console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_CREDENTIALS environment variable", error);
  }
}

if (!auth) {
  auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'google-credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
  });
}

export async function syncToGoogleSheets(entry: any) {
  try {
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    let spreadsheetId = null;
    const query = 'name="Production Records (Lifetime)" and mimeType="application/vnd.google-apps.spreadsheet" and trashed=false';
    const searchRes = await drive.files.list({
      q: query,
      fields: 'files(id, name)'
    });

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      spreadsheetId = searchRes.data.files[0].id;
    }

    if (!spreadsheetId) {
        console.error("Spreadsheet not found. Please create a sheet named 'Production Records (Lifetime)' and share it with the service account.");
        return;
    }

    // Check if headers exist
    const headerRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: 'A1:Z1'
    });

    if (!headerRes.data.values || headerRes.data.values.length === 0) {
       // Add headers automatically
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'A1:Z1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [
               ['Entry Timestamp', 'Roll ID', 'Date', 'Shift', 'Production Type', 'Operator ID', 'Operator Name', 'Machine No', 'Year', 'PI Number', 'Tube Size', 'UOM', 'Material', 'Micron', 'InLine Print', 'Finished Meter', 'Finished Kgs', 'Scrap Kgs', 'Roll Location']
             ]
          }
       });
    }

    // 3. Append row
    if (spreadsheetId) {
      const rowData = [
         entry.EntryTimestamp || new Date().toISOString(),
         entry.RollID || '',
         entry.ProductionDate || '',
         entry.Shift || '',
         entry.ProductionType || '',
         entry.OperatorID || '',
         entry.OperatorName || '',
         entry.MachineNo || '',
         entry.Year || '',
         entry.PINumber || '',
         entry.TubeSize || '',
         entry.UOM || '',
         entry.Material || '',
         entry.Micron || '',
         entry.InLinePrint || '',
         entry.FinishedMeter || '',
         entry.FinishedKgs || '',
         entry.ScrapKgs || '',
         entry.RollLocation || ''
      ];
      
      await sheets.spreadsheets.values.append({
         spreadsheetId,
         range: 'A1',
         valueInputOption: 'USER_ENTERED',
         requestBody: {
            values: [rowData]
         }
      });
    }
  } catch (err: any) {
    console.error("Error syncing to Google Sheets:", err.message);
    if (err.response && err.response.data) {
        console.error("Detailed error:", JSON.stringify(err.response.data, null, 2));
    }
  }
}

export async function syncMultipleToGoogleSheets(entries: any[]) {
  try {
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    let spreadsheetId = null;
    const query = 'name="Production Records (Lifetime)" and mimeType="application/vnd.google-apps.spreadsheet" and trashed=false';
    const searchRes = await drive.files.list({
      q: query,
      fields: 'files(id, name)'
    });

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      spreadsheetId = searchRes.data.files[0].id;
    }

    if (!spreadsheetId) {
        console.error("Spreadsheet not found. Please create a sheet named 'Production Records (Lifetime)' and share it with the service account.");
        return;
    }

    // Check if headers exist
    const headerRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: 'A1:Z1'
    });

    if (!headerRes.data.values || headerRes.data.values.length === 0) {
       // Add headers automatically
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'A1:Z1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [
               ['Entry Timestamp', 'Roll ID', 'Date', 'Shift', 'Production Type', 'Operator ID', 'Operator Name', 'Machine No', 'Year', 'PI Number', 'Tube Size', 'UOM', 'Material', 'Micron', 'InLine Print', 'Finished Meter', 'Finished Kgs', 'Scrap Kgs', 'Roll Location']
             ]
          }
       });
    }

    // 3. Append rows
    if (spreadsheetId && entries.length > 0) {
      const rowsData = entries.map(entry => [
         entry.EntryTimestamp || new Date().toISOString(),
         entry.RollID || '',
         entry.ProductionDate || '',
         entry.Shift || '',
         entry.ProductionType || '',
         entry.OperatorID || '',
         entry.OperatorName || '',
         entry.MachineNo || '',
         entry.Year || '',
         entry.PINumber || '',
         entry.TubeSize || '',
         entry.UOM || '',
         entry.Material || '',
         entry.Micron || '',
         entry.InLinePrint || '',
         entry.FinishedMeter || '',
         entry.FinishedKgs || '',
         entry.ScrapKgs || '',
         entry.RollLocation || ''
      ]);
      
      await sheets.spreadsheets.values.append({
         spreadsheetId,
         range: 'A1',
         valueInputOption: 'USER_ENTERED',
         requestBody: {
            values: rowsData
         }
      });
    }
  } catch (err: any) {
    console.error("Error batch syncing to Google Sheets:", err.message);
    if (err.response && err.response.data) {
        console.error("Detailed error:", JSON.stringify(err.response.data, null, 2));
    }
  }
}
