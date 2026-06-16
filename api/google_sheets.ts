import { google } from 'googleapis';
import path from 'path';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';

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

    // Check headers, ensure "Log ID" is the first column
    const headerRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: 'Breakdown Logs!A1:I1'
    });

    if (!headerRes.data.values || headerRes.data.values.length === 0 || headerRes.data.values[0][0] !== 'Log ID') {
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Breakdown Logs!A1:I1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [
               ['Log ID', 'Log Timestamp', 'Date', 'Machine No', 'Status', 'Reason', 'Duration (Hrs)', 'Start Time', 'End Time']
             ]
          }
       });
    }

    const logId = log.id;
    let rowIndex = -1;

    if (logId) {
      const logIdsRes = await sheets.spreadsheets.values.get({
         spreadsheetId,
         range: 'Breakdown Logs!A:A'
      });

      const values = logIdsRes.data.values || [];
      for (let i = 0; i < values.length; i++) {
         if (values[i][0] === logId) {
            rowIndex = i + 1; // 1-based index
            break;
         }
      }
    }

    // Prepare timestamp (keep old if updating, otheriwse use log.timestamp or current)
    let logTimestamp = log.timestamp || new Date().toISOString();
    if (rowIndex !== -1) {
       try {
          const existingRowRes = await sheets.spreadsheets.values.get({
             spreadsheetId,
             range: `Breakdown Logs!A${rowIndex}:I${rowIndex}`
          });
          if (existingRowRes.data.values && existingRowRes.data.values[0]) {
             logTimestamp = existingRowRes.data.values[0][1] || logTimestamp;
          }
       } catch (e) {
          console.error("Could not fetch existing row:", e);
       }
    }

    const rowData = [
       logId || '',
       logTimestamp,
       log.date || '',
       log.machineId || '',
       log.status || '',
       log.reason || '',
       log.durationHrs !== undefined ? Number(log.durationHrs).toFixed(3) : '0',
       log.startTime || '',
       log.endTime || ''
    ];

    if (rowIndex !== -1) {
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Breakdown Logs!A${rowIndex}:I${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [rowData]
          }
       });
       console.log(`[Google Sheets Log Sync] Updated existing log ${logId} at row ${rowIndex}.`);
    } else {
       await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Breakdown Logs!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [rowData]
          }
       });
       console.log(`[Google Sheets Log Sync] Appended new log ${logId || 'N/A'}.`);
    }

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

    // Check headers, ensure "Log ID" is the first column
    const headerRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: 'Breakdown Logs!A1:I1'
    });

    if (!headerRes.data.values || headerRes.data.values.length === 0 || headerRes.data.values[0][0] !== 'Log ID') {
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Breakdown Logs!A1:I1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [
               ['Log ID', 'Log Timestamp', 'Date', 'Machine No', 'Status', 'Reason', 'Duration (Hrs)', 'Start Time', 'End Time']
             ]
          }
       });
    }

    // 3. Append rows
    if (logs.length > 0) {
      const rowsData = logs.map(log => [
         log.id || '',
         log.timestamp || new Date().toISOString(),
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

export async function syncDashboardToGoogleSheets(summary: any[]) {
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
        console.error("Spreadsheet 'Production Records (Lifetime)' not found.");
        return;
    }

    // 2. Ensure "Machine Status Dashboard" sheet exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = spreadsheet.data.sheets || [];
    const sheetTitle = 'Machine Status Dashboard';
    const hasSheet = sheetsList.some(s => s.properties?.title === sheetTitle);

    if (!hasSheet) {
       await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
             requests: [{
                addSheet: {
                   properties: { title: sheetTitle }
                }
             }]
          }
       });
    }

    // 3. Clear existing values in the sheet to prevent leftover rows from previous runs
    await sheets.spreadsheets.values.clear({
       spreadsheetId,
       range: `${sheetTitle}!A1:Z100`,
    });

    // 4. Construct Headers and Row values
    const headers = [
       'Machine No',
       'Date',
       'Target (Kgs)',
       'Current State',
       'Reason',
       'Total Rolls',
       'Total Meter',
       'Total Production (Kgs)',
       'Idle Count',
       'Idle Duration (Mins)',
       'Breakdown Count',
       'Breakdown Duration (Mins)',
       'Last Status Change / Update Time',
       'Last Refreshed At'
    ];

    const currentRefreshTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }) + " (Dhaka)";

    const rowData = summary.map(row => [
       row.MachineNo || '',
       row.Date || '',
       row.TargetKgs !== undefined ? Number(row.TargetKgs) : 0,
       row.MachineStatus || 'Running',
       row.Reason || '',
       row.TotalRolls !== undefined ? Number(row.TotalRolls) : 0,
       row.TotalMeter !== undefined ? Number(row.TotalMeter).toFixed(2) : '0.00',
       row.TotalProductionKgs !== undefined ? Number(row.TotalProductionKgs).toFixed(2) : '0.00',
       row.IdleNoOfTimes !== undefined ? Number(row.IdleNoOfTimes) : 0,
       row.IdleDurationMins !== undefined ? Number(row.IdleDurationMins).toFixed(2) : '0.00',
       row.BreakdownNoOfTimes !== undefined ? Number(row.BreakdownNoOfTimes) : 0,
       row.BreakdownDurationMins !== undefined ? Number(row.BreakdownDurationMins).toFixed(2) : '0.00',
       row.LastUpdateTime || 'N/A',
       currentRefreshTime
    ]);

    // 5. Update values in the sheet
    await sheets.spreadsheets.values.update({
       spreadsheetId,
       range: `${sheetTitle}!A1`,
       valueInputOption: 'USER_ENTERED',
       requestBody: {
          values: [headers, ...rowData]
       }
    });

    console.log(`[Dashboard Google Sheets Sync] Successfully updated ${summary.length} machine statuses.`);
  } catch (err: any) {
    console.error("Error syncing dashboard to Google Sheets:", err.message);
  }
}

export async function syncUpdatedEntryToGoogleSheets(entry: any) {
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

    const rollId = entry.RollID;
    if (!rollId) {
      console.error("RollID is missing in entry.");
      return;
    }

    // 2. Fetch the Roll ID column B to locate the row
    const rollIdsRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: 'B:B'
    });

    const values = rollIdsRes.data.values || [];
    let rowIndex = -1;
    for (let i = 0; i < values.length; i++) {
       if (values[i][0] === rollId) {
          rowIndex = i + 1; // 1-based index for Google Sheets
          break;
       }
    }

    if (rowIndex === -1) {
       console.log(`Roll ID ${rollId} not found in Google Sheets, appending instead.`);
       await syncToGoogleSheets(entry);
       return;
    }

    // 3. Construct the entire row data to replace the old row
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

    // 4. Update the exact row range (e.g. A22:S22)
    await sheets.spreadsheets.values.update({
       spreadsheetId,
       range: `A${rowIndex}:S${rowIndex}`,
       valueInputOption: 'USER_ENTERED',
       requestBody: {
          values: [rowData]
       }
    });

    console.log(`[Google Sheets Update Sync] Successfully updated Roll ID ${rollId} at row ${rowIndex}.`);
  } catch (err: any) {
    console.error("Error updating entry in Google Sheets:", err.message);
  }
}

export async function uploadPendingOrdersToGoogleSheets(base64Content: string, filename: string) {
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
      throw new Error("Spreadsheet 'Production Records (Lifetime)' not found. Please ensure it exists and is shared.");
    }

    // 2. Ensure "Pending Orders" exists, and delete "Pending Orders Metadata" if it exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = spreadsheet.data.sheets || [];
    const hasSheet = sheetsList.some(s => s.properties?.title === 'Pending Orders');
    const metaSheet = sheetsList.find(s => s.properties?.title === 'Pending Orders Metadata');

    const requests: any[] = [];
    if (!hasSheet) {
      requests.push({
        addSheet: {
          properties: { title: 'Pending Orders' }
        }
      });
    }
    if (metaSheet && metaSheet.properties?.sheetId !== undefined) {
      requests.push({
        deleteSheet: {
          sheetId: metaSheet.properties.sheetId
        }
      });
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      });
    }

    // 3. Clear all existing rows from "Pending Orders" tab
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Pending Orders!A1:Z50000'
    });

    // 4. Parse Base64 to raw rows using xlsx
    let cleanBase64 = base64Content;
    if (base64Content.includes(';base64,')) {
      cleanBase64 = base64Content.split(';base64,')[1];
    }
    const buffer = Buffer.from(cleanBase64, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (!rawData || rawData.length === 0) {
      throw new Error("The uploaded file does not contain any readable rows.");
    }

    // Custom dynamic column scanning with smart fallbacks
    let headerRowIndex = 2; // Row 3 is index 2
    let piIndex = -1;
    let retailerIndex = -1;
    let customerIndex = -1;

    // Check Row 3 (index 2) first
    if (rawData.length > 2) {
      const row = rawData[2]; // Index 2 is Row 3
      if (row && Array.isArray(row)) {
        const colNamesLower = Array.from(row).map(h => String(h || "").trim().toLowerCase());
        piIndex = colNamesLower.findIndex(s => 
          s && (s === "pi no." || s === "pi no" || s === "pino" || s === "pino." || s === "pi" || s === "pi #" || s === "pi_no" || s.includes("pi no") || s.includes("pi-no") || s === "proforma invoice" || s.includes("pi"))
        );
        retailerIndex = colNamesLower.findIndex(s => 
          s && (s === "retailer" || s === "retailer name" || s.includes("retailer") || s === "brand" || s.includes("brand"))
        );
        customerIndex = colNamesLower.findIndex(s => 
          s && (s === "customer" || s === "customer name" || s.includes("customer") || s === "buyer" || s.includes("buyer") || s === "factory name" || s.includes("factory"))
        );
      }
    }

    // Dynamic scanning from other rows if index 2 doesn't match perfectly
    if (piIndex === -1 || retailerIndex === -1 || customerIndex === -1) {
      for (let r = 0; r < Math.min(rawData.length, 50); r++) {
        if (r === 2) continue; // parsed index 2 already
        const row = rawData[r];
        if (!row || !Array.isArray(row)) continue;

        const colNamesLower = Array.from(row).map(h => String(h || "").trim().toLowerCase());

        const tempPiIndex = colNamesLower.findIndex(s => 
          s && (s === "pi no." || s === "pi no" || s === "pino" || s === "pino." || s === "pi" || s === "pi #" || s === "pi_no" || s.includes("pi no") || s.includes("pi-no") || s === "proforma invoice" || s.includes("pi"))
        );
        const tempRetailerIndex = colNamesLower.findIndex(s => 
          s && (s === "retailer" || s === "retailer name" || s.includes("retailer") || s === "brand" || s.includes("brand"))
        );
        const tempCustomerIndex = colNamesLower.findIndex(s => 
          s && (s === "customer" || s === "customer name" || s.includes("customer") || s === "buyer" || s.includes("buyer") || s === "factory name" || s.includes("factory"))
        );

        let matchCount = 0;
        if (tempPiIndex !== -1) matchCount++;
        if (tempRetailerIndex !== -1) matchCount++;
        if (tempCustomerIndex !== -1) matchCount++;

        // If at least 2 headers match, we assume this is the header row
        if (matchCount >= 2) {
          headerRowIndex = r;
          if (tempPiIndex !== -1) piIndex = tempPiIndex;
          if (tempRetailerIndex !== -1) retailerIndex = tempRetailerIndex;
          if (tempCustomerIndex !== -1) customerIndex = tempCustomerIndex;
          break;
        }
      }
    }

    // If still missing, throw an informative exception
    const missing: string[] = [];
    if (piIndex === -1) missing.push("'PI No.'");
    if (retailerIndex === -1) missing.push("'Retailer'");
    if (customerIndex === -1) missing.push("'Customer'");

    if (missing.length > 0) {
      const sampleRow = rawData[headerRowIndex] || rawData[2] || [];
      const colNames = Array.from(sampleRow).map((h: any) => String(h || "").trim());
      throw new Error(`Row 3 (বা অন্য কোনো হেডার রো) এ প্রয়োজনীয় কলামগুলো পাওয়া যায়নি: ${missing.join(", ")}। Row 3 এর কলামগুলো ছিল: [ ${colNames.filter(Boolean).slice(0, 15).join(", ")} ]`);
    }

    // Filter, keep only the 3 columns, and merge/deduplicate records
    const seen = new Set<string>();
    const uniqueRows: string[][] = [];

    const startIdx = headerRowIndex + 1;
    for (let idx = startIdx; idx < rawData.length; idx++) {
      const row = rawData[idx];
      if (!row || !Array.isArray(row)) continue;

      const piVal = String(row[piIndex] !== undefined && row[piIndex] !== null ? row[piIndex] : "").trim();
      const retailerVal = String(row[retailerIndex] !== undefined && row[retailerIndex] !== null ? row[retailerIndex] : "").trim();
      const customerVal = String(row[customerIndex] !== undefined && row[customerIndex] !== null ? row[customerIndex] : "").trim();

      // Skip empty or placeholder rows
      if (!piVal && !retailerVal && !customerVal) {
        continue;
      }

      // Merge (deduplicate) rows that share identical PI No, Retailer, and Customer values
      const key = `${piVal.toLowerCase()}||${retailerVal.toLowerCase()}||${customerVal.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRows.push([piVal, retailerVal, customerVal]);
      }
    }

    const uploadTimeStr = new Date().toISOString();
    const metadataRow = [
      "ID_METADATA_PENDING_ORDERS", 
      filename, 
      uploadTimeStr, 
      String(uniqueRows.length), // total unique rows
      "SPREADSHEET_ID_LINK", 
      spreadsheetId
    ];

    const finalRows: any[][] = [
      ["PI No.", "Retailer", "Customer"], // Header is exactly Row 1 of "Pending Orders" tab
      ...uniqueRows
    ];

    // 5. Write clean parsed unique rows to "Pending Orders" starting precisely at A1
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Pending Orders!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: finalRows
      }
    });

    const webViewLink = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return {
      filename,
      uploadedAt: uploadTimeStr,
      totalRows: uniqueRows.length,
      webViewLink,
      spreadsheetId
    };
  } catch (err: any) {
    console.error("Error saving pending orders to Google Sheet:", err);
    throw err;
  }
}

export async function deletePendingOrdersFromGoogleSheets() {
  try {
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find spreadsheet
    let spreadsheetId = null;
    const query = 'name="Production Records (Lifetime)" and mimeType="application/vnd.google-apps.spreadsheet" and trashed=false';
    const searchRes = await drive.files.list({
      q: query,
      fields: 'files(id, name)'
    });

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      spreadsheetId = searchRes.data.files[0].id;
    }

    if (!spreadsheetId) return false;

    // Clear the rows in "Pending Orders" tab
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Pending Orders!A1:Z50000'
    });

    // Also look for "Pending Orders Metadata" tab and delete it if it exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = spreadsheet.data.sheets || [];
    const metaSheet = sheetsList.find(s => s.properties?.title === 'Pending Orders Metadata');
    if (metaSheet && metaSheet.properties?.sheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            deleteSheet: {
              sheetId: metaSheet.properties.sheetId
            }
          }]
        }
      });
    }

    return true;
  } catch (err: any) {
    console.error("Error deleting pending orders sheet:", err.message);
    throw err;
  }
}


