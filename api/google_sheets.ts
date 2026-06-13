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

export async function syncMachineLogToGoogleSheets(log: any) {
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

    // 2. Ensure "Breakdown Logs" sheet exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = spreadsheet.data.sheets || [];
    const hasSheet = sheetsList.some(s => s.properties?.title === 'Breakdown Logs');

    if (!hasSheet) {
       await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
             requests: [{
                addSheet: {
                   properties: { title: 'Breakdown Logs' }
                }
             }]
          }
       });
    }

    // Check headers
    const headerRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: 'Breakdown Logs!A1:Z1'
    });

    if (!headerRes.data.values || headerRes.data.values.length === 0) {
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Breakdown Logs!A1:Z1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [
               ['Log Timestamp', 'Date', 'Machine No', 'Status', 'Reason', 'Duration (Hrs)', 'Start Time', 'End Time']
             ]
          }
       });
    }

    // 3. Append row
    const rowData = [
       new Date().toISOString(),
       log.date || '',
       log.machineId || '',
       log.status || '',
       log.reason || '',
       log.durationHrs !== undefined ? Number(log.durationHrs).toFixed(3) : '0',
       log.startTime || '',
       log.endTime || ''
    ];

    await sheets.spreadsheets.values.append({
       spreadsheetId,
       range: 'Breakdown Logs!A1',
       valueInputOption: 'USER_ENTERED',
       requestBody: {
          values: [rowData]
       }
    });

  } catch (err: any) {
    console.error("Error syncing machine log to Google Sheets:", err.message);
  }
}

export async function syncMultipleMachineLogsToGoogleSheets(logs: any[]) {
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
        console.error("Spreadsheet not found.");
        return;
    }

    // 2. Ensure "Breakdown Logs" sheet exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = spreadsheet.data.sheets || [];
    const hasSheet = sheetsList.some(s => s.properties?.title === 'Breakdown Logs');

    if (!hasSheet) {
       await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
             requests: [{
                addSheet: {
                   properties: { title: 'Breakdown Logs' }
                }
             }]
          }
       });
    }

    // Check headers
    const headerRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: 'Breakdown Logs!A1:Z1'
    });

    if (!headerRes.data.values || headerRes.data.values.length === 0) {
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Breakdown Logs!A1:Z1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [
               ['Log Timestamp', 'Date', 'Machine No', 'Status', 'Reason', 'Duration (Hrs)', 'Start Time', 'End Time']
             ]
          }
       });
    }

    // 3. Append rows
    if (logs.length > 0) {
      const rowsData = logs.map(log => [
         new Date().toISOString(),
         log.date || '',
         log.machineId || '',
         log.status || '',
         log.reason || '',
         log.durationHrs !== undefined ? Number(log.durationHrs).toFixed(3) : '0',
         log.startTime || '',
         log.endTime || ''
      ]);

      await sheets.spreadsheets.values.append({
         spreadsheetId,
         range: 'Breakdown Logs!A1',
         valueInputOption: 'USER_ENTERED',
         requestBody: {
            values: rowsData
         }
      });
    }
  } catch (err: any) {
    console.error("Error batch syncing machine logs to Google Sheets:", err.message);
  }
}
