import { google } from 'googleapis';
import path from 'path';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';
import fs from 'fs';

let sheetSyncChain = Promise.resolve();

export async function enqueueSheetSync<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    sheetSyncChain = sheetSyncChain.then(async () => {
      try {
        let retries = 3;
        while (retries > 0) {
          try {
            const result = await fn();
            // Wait 1.5s between rows to avoid rate limit
            await new Promise(r => setTimeout(r, 1500));
            resolve(result);
            return;
          } catch(err: any) {
             retries--;
             console.error(`[Google Sheets API] Error occurred, retries left: ${retries}`, err?.message || err);
             if (retries === 0) reject(err);
             else await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
          }
        }
      } catch (err) {
        reject(err);
      }
    }).catch(err => {
       console.error("[Google Sheets API] Uncaught queue error:", err);
    });
  });
}

// Lazy authentication function
export function getServiceAccountEmail(): string | null {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
      return credentials.client_email || null;
    } catch (error) {
      console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_CREDENTIALS for email", error);
    }
  }

  const credentialsPath = path.join(process.cwd(), 'google-credentials.json');
  if (fs.existsSync(credentialsPath)) {
    try {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      return credentials.client_email || null;
    } catch (error) {
      console.error("Failed to read google-credentials.json for email", error);
    }
  }

  if (process.env.AUTHORIZED_SERVICE_ACCOUNT_EMAIL) {
    return process.env.AUTHORIZED_SERVICE_ACCOUNT_EMAIL;
  }

  return null;
}

export function getGoogleAuth(): any {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
      return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
      });
    } catch (error) {
      console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_CREDENTIALS environment variable", error);
    }
  }

  const credentialsPath = path.join(process.cwd(), 'google-credentials.json');
  if (fs.existsSync(credentialsPath)) {
    return new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
    });
  }

  // Fallback to Application Default Credentials (ADC) when running inside GCP / Cloud Run environment
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
  });
}

import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

let sheetsDbInstance: any;
let cachedSpreadsheetId: string | null = null;

const FALLBACK_CONFIG = {
  projectId: "extrusion-f736a",
  appId: "1:1055215837141:web:cf25cc0674aae1b15be75c",
  apiKey: "AIzaSyCeO4Xpdd1OhLItAL0HtHVoXTi6r20H2nA",
  authDomain: "extrusion-f736a.firebaseapp.com",
  firestoreDatabaseId: "(default)",
  storageBucket: "extrusion-f736a.firebasestorage.app",
  messagingSenderId: "1055215837141",
  measurementId: ""
};

function getSheetsFirebaseDb() {
  if (sheetsDbInstance) return sheetsDbInstance;
  try {
    let config: any = null;
    const p = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(p)) {
      config = JSON.parse(fs.readFileSync(p, "utf-8"));
    }
    if (!config || !config.apiKey) {
      config = FALLBACK_CONFIG;
    }
    const appName = "sheets_db_client";
    const existing = getApps().find(a => a.name === appName);
    const app = existing || initializeApp(config, appName);
    const dbId = config.firestoreDatabaseId === "(default)" ? undefined : config.firestoreDatabaseId;
    sheetsDbInstance = getFirestore(app, dbId);
    return sheetsDbInstance;
  } catch (error) {
    console.error("Sheets Firebase Init Error:", error);
    return null;
  }
}

async function fetchSpreadsheetIdFromDb(): Promise<string | null> {
  try {
    const db = getSheetsFirebaseDb();
    if (!db) return null;
    const d = await getDoc(doc(db, 'app_config', 'sheet'));
    if (d.exists()) {
      return d.data()?.spreadsheetId || null;
    }
  } catch (e) {
    console.error("Error reading spreadsheetId from Firestore in sheets background:", e);
  }
  return null;
}

export function setCachedSpreadsheetId(id: string | null) {
  cachedSpreadsheetId = id;
}

export async function resolveSpreadsheetId(drive: any): Promise<string | null> {
  if (process.env.SPREADSHEET_ID) {
    return process.env.SPREADSHEET_ID;
  }
  
  if (cachedSpreadsheetId) {
    return cachedSpreadsheetId;
  }

  try {
    const dbId = await fetchSpreadsheetIdFromDb();
    if (dbId) {
      cachedSpreadsheetId = dbId;
      return dbId;
    }
  } catch (err: any) {
    console.error("Failed to dynamically fetch SpreadsheetId from DB:", err.message);
  }

  try {
    const query = 'name="Production Records (Lifetime)" and mimeType="application/vnd.google-apps.spreadsheet" and trashed=false';
    const searchRes = await drive.files.list({
      q: query,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc'
    });
    if (searchRes.data.files && searchRes.data.files.length > 0) {
      cachedSpreadsheetId = searchRes.data.files[0].id || null;
      return cachedSpreadsheetId;
    }
  } catch (err: any) {
    console.warn("[Google Sheets] Google Drive API search fell back (make sure Spreadsheet ID is configured in app settings):", err.message);
  }

  return null;
}

export function cleanPi(pi: string): string {
  if (!pi) return '';
  let str = pi.trim().toLowerCase();
  
  // Drop "mpbl" prefix if it exists to allow matching raw numbers to full codes
  str = str.replace(/^mpbl\s*[\/\-_]?\s*/, '');
  
  // Replace leading zeroes in any sequence of numbers (e.g. 04894 -> 4894, or leading 0s preceeded by non-digit or boundary)
  str = str.replace(/(^|[^0-9])0+(\d+)/g, '$1$2');

  str = str.replace(/[^a-z0-9]/g, '');
  return str;
}

export function getMatchedDetails(piDetailsMap: Map<string, { retailer: string, customer: string }>, piVal: string): { retailer: string, customer: string } {
  if (!piVal) return { retailer: '', customer: '' };
  
  // Try original exact uppercase first
  const upper = piVal.trim().toUpperCase();
  if (piDetailsMap.has(upper)) {
    return piDetailsMap.get(upper)!;
  }
  
  // Try cleaned/normalized key mapping
  const clean = cleanPi(piVal);
  if (piDetailsMap.has(clean)) {
    return piDetailsMap.get(clean)!;
  }
  
  // Try extracting the base number sequence (e.g. "4894" from "MPBL/04894/2026")
  const baseMatch = piVal.match(/MPBL\/0*(\d+)/i) || piVal.match(/0*(\d+)/);
  if (baseMatch) {
    const base = baseMatch[1];
    if (piDetailsMap.has(base)) {
      return piDetailsMap.get(base)!;
    }
  }
  
  return { retailer: '', customer: '' };
}

export async function getPendingOrderDetailsMap(sheets: any, spreadsheetId: string): Promise<Map<string, { retailer: string, customer: string }>> {
  const map = new Map<string, { retailer: string, customer: string }>();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Pending Orders!A1:C50000'
    });
    const values = res.data.values;
    if (values && values.length > 1) {
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        if (!row || row.length === 0) continue;
        const pi = String(row[0] || '').trim();
        if (pi) {
          const details = {
            retailer: String(row[1] || '').trim(),
            customer: String(row[2] || '').trim()
          };
          // Store multiple key formats for maximum matching success
          map.set(pi.toUpperCase(), details);
          map.set(cleanPi(pi), details);
          
          // Also set base number if possible (e.g. "4894")
          const baseMatch = pi.match(/MPBL\/0*(\d+)/i) || pi.match(/0*(\d+)/);
          if (baseMatch) {
            map.set(baseMatch[1], details);
          }
        }
      }
    }
  } catch (err: any) {
    console.error("Error reading details map from Pending Orders sheet:", err.message);
  }
  return map;
}

export async function getPendingOrderDetailsMapDirect(): Promise<Map<string, { retailer: string, customer: string }>> {
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      console.warn("[Google Sheets] Google credentials are missing. Skipping fetching details map direct.");
      return new Map();
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheetId = await resolveSpreadsheetId(drive);

    if (!spreadsheetId) {
      return new Map();
    }

    return await getPendingOrderDetailsMap(sheets, spreadsheetId);
  } catch (err: any) {
    console.error("Error direct fetching details map:", err.message);
    return new Map();
  }
}

export async function getPendingOrderDetailsByPi(piNumber: string): Promise<{ retailer: string, customer: string }> {
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      console.warn("[Google Sheets] Google credentials are missing. Skipping fetching pending order details by PI.");
      return { retailer: '', customer: '' };
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheetId = await resolveSpreadsheetId(drive);

    if (!spreadsheetId) {
      return { retailer: '', customer: '' };
    }

    const piDetailsMap = await getPendingOrderDetailsMap(sheets, spreadsheetId);
    return getMatchedDetails(piDetailsMap, piNumber);
  } catch (err: any) {
    console.error("Error retrieving pending order details by PI:", err.message);
    return { retailer: '', customer: '' };
  }
}

export async function getProductionSheetTitle(sheets: any, spreadsheetId: string): Promise<string> {
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = spreadsheet.data.sheets || [];
    
    // Check if "Master Production" sheet tab already exists
    const match = sheetsList.find((s: any) => {
       const title = s.properties?.title || '';
       return title.trim().toLowerCase() === 'master production';
    });
    if (match && match.properties?.title) {
       return match.properties.title;
    }
    
    // If it does not exist, create a new sheet tab named "Master Production"
    await sheets.spreadsheets.batchUpdate({
       spreadsheetId,
       requestBody: {
          requests: [{
             addSheet: {
                properties: { title: 'Master Production' }
             }
          }]
       }
    });
    console.log("Created 'Master Production' sheet tab in spreadsheet.");
    return 'Master Production';
  } catch (error) {
    console.error("Error fetching/creating 'Master Production' sheet, defaulting to 'Master Production':", error);
  }
  return 'Master Production';
}

export async function syncToGoogleSheets(entry: any) {
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      console.warn("[Google Sheets] Google credentials are missing. Skipping syncing to Google Sheets.");
      return;
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    const spreadsheetId = await resolveSpreadsheetId(drive);

    if (!spreadsheetId) {
        console.error("Spreadsheet not found. Please create a sheet named 'Production Records (Lifetime)' and share it with the service account or configure its ID in settings.");
        return;
    }

    const sheetTitle = await getProductionSheetTitle(sheets, spreadsheetId);

    // Check if headers exist
    const headerRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: `${sheetTitle}!A1:Z1`
    });

    const standardHeaders = [
        'Entry Timestamp', 'Roll ID', 'Production Date', 'Shift', 'Production Type', 
        'Operator ID', 'Operator Name', 'Machine No', 'Year', 'PI Number', 
        'Tube Size', 'UOM', 'Material', 'Micron', 'InLine Print', 
        'Finished Meter', 'Finished Kgs', 'Scrap Kgs', 'Roll Location', 'Retailer', 
        'Customer', 'Data Update Time', 'Fingerprint', 'Entered By', 
        'Production Year', 'Production Month'
    ];

    if (!headerRes.data.values || headerRes.data.values.length === 0) {
       // Add headers automatically
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetTitle}!A1:Z1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [standardHeaders]
          }
       });
    } else {
       // Update header row to include ALL columns
       await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetTitle}!A1:Z1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [standardHeaders]
          }
       });
    }

    // 3. Append row
    if (spreadsheetId) {
      const piDetailsMap = await getPendingOrderDetailsMap(sheets, spreadsheetId);
      const match = getMatchedDetails(piDetailsMap, entry.PINumber);

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
         entry.RollLocation || '',
         match.retailer || '',
         match.customer || '',
         entry.DataUpdateTime || '',
         entry.Fingerprint || '',
         entry.EnteredBy || '',
         entry.ProductionYear || '',
         entry.ProductionMonth || ''
      ];
      
      await enqueueSheetSync(() => sheets.spreadsheets.values.append({
         spreadsheetId,
         range: `${sheetTitle}!A1:Z`,
         valueInputOption: 'USER_ENTERED',
         requestBody: {
            values: [rowData]
         }
      }));
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
    const auth = getGoogleAuth();
    if (!auth) {
      console.warn("[Google Sheets] Google credentials are missing. Skipping batch syncing to Google Sheets.");
      return;
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    const spreadsheetId = await resolveSpreadsheetId(drive);

    if (!spreadsheetId) {
        console.error("Spreadsheet not found. Please create a sheet named 'Production Records (Lifetime)' and share it with the service account or configure its ID in settings.");
        return;
    }

    const sheetTitle = await getProductionSheetTitle(sheets, spreadsheetId);

    // 2. Clear all values in the sheet
    await sheets.spreadsheets.values.clear({
       spreadsheetId,
       range: `${sheetTitle}!A1:Z100000`,
    });

    const standardHeaders = [
        'Entry Timestamp', 'Roll ID', 'Production Date', 'Shift', 'Production Type', 
        'Operator ID', 'Operator Name', 'Machine No', 'Year', 'PI Number', 
        'Tube Size', 'UOM', 'Material', 'Micron', 'InLine Print', 
        'Finished Meter', 'Finished Kgs', 'Scrap Kgs', 'Roll Location', 'Retailer', 
        'Customer', 'Data Update Time', 'Fingerprint', 'Entered By', 
        'Production Year', 'Production Month'
    ];

    // 3. Construct all rows
    const piDetailsMap = await getPendingOrderDetailsMap(sheets, spreadsheetId);

    const rowsData = entries.map(entry => {
       const match = getMatchedDetails(piDetailsMap, entry.PINumber);
       return [
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
          entry.RollLocation || '',
          match.retailer || '',
          match.customer || '',
          entry.DataUpdateTime || '',
          entry.Fingerprint || '',
          entry.EnteredBy || '',
          entry.ProductionYear || '',
          entry.ProductionMonth || ''
       ];
    });

    // 4. Update the entire sheet with headers AND rows
    await sheets.spreadsheets.values.update({
       spreadsheetId,
       range: `${sheetTitle}!A1`,
       valueInputOption: 'USER_ENTERED',
       requestBody: {
          values: [standardHeaders, ...rowsData]
       }
    });

    console.log(`[Google Sheets Batch Sync] Reassembled & synchronized ${entries.length} records into standard sheet "${sheetTitle}".`);
  } catch (err: any) {
    console.error("Error batch syncing to Google Sheets:", err.message);
    if (err.response && err.response.data) {
        console.error("Detailed error:", JSON.stringify(err.response.data, null, 2));
    }
  }
}

export async function syncMachineLogToGoogleSheets(log: any) {
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      console.warn("[Google Sheets] Google credentials are missing. Skipping syncing machine log to Google Sheets.");
      return;
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    const spreadsheetId = await resolveSpreadsheetId(drive);

    if (!spreadsheetId) {
        console.error("Spreadsheet not found. Please create a sheet named 'Production Records (Lifetime)' and share it with the service account or configure its ID in settings.");
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
       await enqueueSheetSync(() => sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Breakdown Logs!A${rowIndex}:I${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [rowData]
          }
       }));
       console.log(`[Google Sheets Log Sync] Updated existing log ${logId} at row ${rowIndex}.`);
    } else {
       await enqueueSheetSync(() => sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Breakdown Logs!A:Z',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
             values: [rowData]
          }
       }));
       console.log(`[Google Sheets Log Sync] Appended new log ${logId || 'N/A'}.`);
    }

  } catch (err: any) {
    console.error("Error syncing machine log to Google Sheets:", err.message);
  }
}

export async function syncMultipleMachineLogsToGoogleSheets(logs: any[]) {
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      console.warn("[Google Sheets] Google credentials are missing. Skipping batch syncing machine logs to Google Sheets.");
      return;
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    const spreadsheetId = await resolveSpreadsheetId(drive);

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

      await enqueueSheetSync(() => sheets.spreadsheets.values.append({
         spreadsheetId,
         range: 'Breakdown Logs!A:Z',
         valueInputOption: 'USER_ENTERED',
         requestBody: {
            values: rowsData
         }
      }));
    }
  } catch (err: any) {
    console.error("Error batch syncing machine logs to Google Sheets:", err.message);
  }
}

export async function syncDashboardToGoogleSheets(summary: any[]) {
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      console.warn("[Google Sheets] Google credentials are missing. Skipping syncing dashboard to Google Sheets.");
      return;
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    const spreadsheetId = await resolveSpreadsheetId(drive);

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
       (row.Reason && row.Reason !== 'NO_ALERTS' && row.Reason !== 'Initial Setup') ? row.Reason : '',
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
    await enqueueSheetSync(() => sheets.spreadsheets.values.update({
       spreadsheetId,
       range: `${sheetTitle}!A1`,
       valueInputOption: 'USER_ENTERED',
       requestBody: {
          values: [headers, ...rowData]
       }
    }));

    console.log(`[Dashboard Google Sheets Sync] Successfully updated ${summary.length} machine statuses.`);
  } catch (err: any) {
    console.error("Error syncing dashboard to Google Sheets:", err.message);
  }
}

export async function syncUpdatedEntryToGoogleSheets(entry: any) {
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      console.warn("[Google Sheets] Google credentials are missing. Skipping updating entry in Google Sheets.");
      return;
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    const spreadsheetId = await resolveSpreadsheetId(drive);

    if (!spreadsheetId) {
        console.error("Spreadsheet not found.");
        return;
    }

    const rollId = entry.RollID;
    if (!rollId) {
      console.error("RollID is missing in entry.");
      return;
    }

    const sheetTitle = await getProductionSheetTitle(sheets, spreadsheetId);

    // 2. Fetch the Roll ID column B to locate the row
    const rollIdsRes = await sheets.spreadsheets.values.get({
       spreadsheetId,
       range: `${sheetTitle}!B:B`
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
    const piDetailsMap = await getPendingOrderDetailsMap(sheets, spreadsheetId);
    const match = getMatchedDetails(piDetailsMap, entry.PINumber);

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
       entry.RollLocation || '',
       match.retailer || '',
       match.customer || '',
       entry.DataUpdateTime || '',
       entry.Fingerprint || '',
       entry.EnteredBy || '',
       entry.ProductionYear || '',
       entry.ProductionMonth || ''
    ];

    // 4. Update the exact row range (e.g. A22:Z22)
    await enqueueSheetSync(() => sheets.spreadsheets.values.update({
       spreadsheetId,
       range: `${sheetTitle}!A${rowIndex}:Z${rowIndex}`,
       valueInputOption: 'USER_ENTERED',
       requestBody: {
          values: [rowData]
       }
    }));

    console.log(`[Google Sheets Update Sync] Successfully updated Roll ID ${rollId} at row ${rowIndex} in sheet "${sheetTitle}".`);
  } catch (err: any) {
    console.error("Error updating entry in Google Sheets:", err.message);
  }
}

export async function uploadPendingOrdersToGoogleSheets(base64Content: string, filename: string) {
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      throw new Error("Google credentials are missing. Google Sheets integration has not been configured (no GOOGLE_SERVICE_ACCOUNT_CREDENTIALS or google-credentials.json found).");
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find the spreadsheet
    const spreadsheetId = await resolveSpreadsheetId(drive);

    if (!spreadsheetId) {
      throw new Error("Spreadsheet 'Production Records (Lifetime)' not found. Please ensure it exists and is shared or configure its ID in settings.");
    }

    // 2. Ensure "Pending Orders" exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = spreadsheet.data.sheets || [];
    const hasSheet = sheetsList.some(s => s.properties?.title === 'Pending Orders');

    const requests: any[] = [];
    if (!hasSheet) {
      requests.push({
        addSheet: {
          properties: { title: 'Pending Orders' }
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
    const auth = getGoogleAuth();
    if (!auth) {
      throw new Error("Google credentials are missing. Google Sheets integration has not been configured (no GOOGLE_SERVICE_ACCOUNT_CREDENTIALS or google-credentials.json found).");
    }
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Find spreadsheet
    const spreadsheetId = await resolveSpreadsheetId(drive);

    if (!spreadsheetId) return false;

    // Clear the rows in "Pending Orders" tab
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Pending Orders!A1:Z50000'
    });

    return true;
  } catch (err: any) {
    console.error("Error deleting pending orders sheet:", err.message);
    throw err;
  }
}


