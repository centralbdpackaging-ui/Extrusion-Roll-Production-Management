import express from "express";
import path from "path";
import fs from "fs";
import { syncToGoogleSheets, syncMultipleToGoogleSheets, syncMachineLogToGoogleSheets, syncMultipleMachineLogsToGoogleSheets, syncDashboardToGoogleSheets, syncUpdatedEntryToGoogleSheets, uploadPendingOrdersToGoogleSheets, deletePendingOrdersFromGoogleSheets, getPendingOrderDetailsByPi, getPendingOrderDetailsMapDirect, getMatchedDetails, cleanPi, getServiceAccountEmail, getGoogleAuth, getProductionSheetTitle, resolveSpreadsheetId } from "./google_sheets.js";
import { initializeApp, getApp, getApps } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  query, 
  orderBy, 
  limit, 
  writeBatch,
  where,
  deleteDoc
} from "firebase/firestore";

import { fileURLToPath } from 'node:url';

const app = express();
// Simple ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let firebaseApp: any;
let dbInstance: any;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Hardcoded Fallback Config (from your firebase-applet-config.json)
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

const initializeFirebase = () => {
  if (dbInstance) return dbInstance;
  try {
    let config: any = null;

    // 1. Try Environment Variable first
    if (process.env.FIREBASE_CONFIG_JSON) {
       console.log("[Firebase] Config from ENV");
       config = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
    } 
    // 2. Try Local File Paths
    else {
      const paths = [
        path.join(process.cwd(), "firebase-applet-config.json"),
        path.join(__dirname, "firebase-applet-config.json"),
        path.join(__dirname, "..", "firebase-applet-config.json")
      ];
      
      console.log("[Firebase] Checking paths for config:", paths);
      for (const p of paths) {
        if (fs.existsSync(p)) {
          console.log("[Firebase] Loading from file:", p);
          try {
            config = JSON.parse(fs.readFileSync(p, "utf-8"));
            console.log("[Firebase] Successfully parsed config file.");
            break;
          } catch(e) {
            console.error("[Firebase] Failed to parse config file:", e);
          }
        } else {
          console.log("[Firebase] File not found at:", p);
        }
      }
    }

    // 3. Last Resort: Use hardcoded fallback
    if (!config || !config.apiKey) {
      console.warn("[Firebase] Config not found in ENV or FILES. Using Fallback.");
      config = FALLBACK_CONFIG;
    } else {
      console.log("[Firebase] Config loaded successfully. Project ID:", config.projectId);
    }

    if (config && config.apiKey) {
      const appName = config.projectId || "[DEFAULT]";
      const existingApp = getApps().find(a => a.name === appName || a.name === "[DEFAULT]");
      firebaseApp = existingApp || initializeApp(config, appName);
      
      const dbId = config.firestoreDatabaseId === "(default)" ? undefined : config.firestoreDatabaseId;
      dbInstance = getFirestore(firebaseApp, dbId);
      console.log("[Firebase] Initialized:", config.projectId);
      return dbInstance;
    }
  } catch (error: any) {
    console.error("[Firebase] Init failed:", error.message);
  }
  return null;
};

const backfillRetailerCustomerInFirestore = async () => {
  const db = initializeFirebase();
  if (!db) return;
  try {
    const piDetailsMap = await getPendingOrderDetailsMapDirect();
    
    const recordsSnapshot = await getDocs(collection(db, "production_records"));
    let batch = writeBatch(db);
    let batchOperationCount = 0;
    let updatedCount = 0;

    for (const docSnap of recordsSnapshot.docs) {
      const data = docSnap.data();
      const piVal = data.PINumber || '';
      const updates: any = {};
      
      if (piVal && piDetailsMap && piDetailsMap.size > 0) {
        const match = getMatchedDetails(piDetailsMap, piVal);
        const currentRetailer = data.Retailer || '';
        const currentCustomer = data.Customer || '';
        
        if (match.retailer !== currentRetailer) {
          updates.Retailer = match.retailer || '';
        }
        if (match.customer !== currentCustomer) {
          updates.Customer = match.customer || '';
        }
      }

      // Check missing metadata fields to ensure Google Sheets column sync gets full data
      const dateObj = data.ProductionDate ? new Date(data.ProductionDate) : new Date();
      
      if (!data.EntryTimestamp) {
        updates.EntryTimestamp = data.ProductionDate ? `${data.ProductionDate}T12:00:00.000Z` : new Date().toISOString();
      }
      if (!data.DataUpdateTime) {
        updates.DataUpdateTime = dateObj.toLocaleString();
      }
      if (!data.Fingerprint) {
        updates.Fingerprint = Math.random().toString(36).substring(2, 10).toUpperCase();
      }
      if (!data.EnteredBy) {
        updates.EnteredBy = "Plant Admin";
      }
      if (!data.ProductionYear) {
        updates.ProductionYear = dateObj.getFullYear().toString();
      }
      if (!data.ProductionMonth) {
        updates.ProductionMonth = dateObj.toLocaleString('default', { month: 'long' });
      }

      if (Object.keys(updates).length > 0) {
        batch.update(docSnap.ref, updates);
        batchOperationCount++;
        updatedCount++;
        
        if (batchOperationCount === 450) {
          await batch.commit();
          batch = writeBatch(db);
          batchOperationCount = 0;
        }
      }
    }
    
    if (batchOperationCount > 0) {
      await batch.commit();
    }
    console.log(`[Backfill] Successfully updated/backfilled ${updatedCount} records in Firestore with Retailer, Customer, and missing metadata fields.`);
  } catch (err: any) {
    console.error("[Backfill Error]:", err.message);
  }
};

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Global Error]", err);
  if (!res.headersSent) {
    res.status(500).json({ 
      error: "Internal Server Error", 
      message: err.message,
      path: req.path,
      vercel: !!process.env.VERCEL
    });
  }
});

app.get("/api/diag", (req, res) => {
  res.json({
    status: "online",
    vercel: !!process.env.VERCEL,
    env_keys: Object.keys(process.env),
    firebase_env_present: !!process.env.FIREBASE_CONFIG_JSON,
    cwd: process.cwd(),
    dirname: __dirname
  });
});

app.get("/api/debug/firebase", async (req, res) => {
  const db = initializeFirebase();
  res.json({
    initialized: !!db,
    project: firebaseApp?.options?.projectId,
    env: { NODE_ENV: process.env.NODE_ENV }
  });
});

app.get("/api/debug/test-sync-details", async (req, res) => {
  const steps: string[] = [];
  try {
    steps.push("Step 1: Initializing Firebase...");
    const db = initializeFirebase();
    if (!db) throw new Error("Firebase initialization failed");
    steps.push("Firebase initialized successfully.");

    steps.push("Step 2: Getting Google Auth...");
    const auth = getGoogleAuth();
    if (!auth) throw new Error("Google credentials are missing in process.env or google-credentials.json");
    steps.push("Google Auth client created.");

    steps.push("Step 3: Initializing Google Sheets & Drive client...");
    const { google } = await import("googleapis");
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    steps.push("Google API clients imported and initialized.");

    steps.push("Step 4: Locating spreadsheet...");
    const { resolveSpreadsheetId } = await import("./google_sheets.js");
    const spreadsheetId = await resolveSpreadsheetId(drive);
    steps.push(`Spreadsheet ID resolved to: "${spreadsheetId}"`);
    if (!spreadsheetId) throw new Error("Spreadsheet was not resolved. Please ensure a sheet is configured or shared.");

    steps.push("Step 5: Inspecting spreadsheet tabs...");
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = spreadsheet.data.sheets || [];
    const titles = sheetsList.map((s: any) => s.properties?.title);
    steps.push(`Tabs in sheet: ${JSON.stringify(titles)}`);

    steps.push("Step 6: Running active sheet resolution...");
    const sheetTitle = await getProductionSheetTitle(sheets, spreadsheetId);
    steps.push(`Active sheet title resolved: "${sheetTitle}"`);

    steps.push("Step 7: Testing reading Pending Orders tab...");
    try {
      const resVal = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Pending Orders!A1:C5'
      });
      steps.push(`Pending Orders read success, rows found: ${resVal.data.values?.length || 0}`);
    } catch (e: any) {
      steps.push(`Pending Orders check failed: ${e.message}`);
    }

    steps.push("Step 8: Reading document counts from Firestore 'production_records'...");
    const recordsSnapshot = await getDocs(
      query(collection(db, "production_records"), orderBy("EntryTimestamp", "asc"), limit(3))
    );
    steps.push(`Firestore production_records sample fetch size: ${recordsSnapshot.size}`);

    res.json({
      success: true,
      steps,
      details: {
        spreadsheetId,
        sheetTitle,
        allSheets: titles
      }
    });

  } catch (err: any) {
    steps.push(`ERROR: ${err.message}`);
    res.status(500).json({
      success: false,
      error: err.message,
      steps,
      stack: err.stack
    });
  }
});

  app.post("/api/debug/seed", async (req, res) => {
    try {
      await seedInitialData();
      res.json({ message: "Seeding check completed successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/health", async (req, res) => {
    let dbStatus = "Checking...";
    try {
      const db = initializeFirebase();
      if (!db) {
        dbStatus = "Undefined - Initialization failed";
      } else {
        await setDoc(doc(db, 'health_test', 'ping'), { lastPing: new Date().toISOString() });
        dbStatus = "Connected & Writing";
      }
    } catch (err: any) {
      dbStatus = "Error: " + err.message;
    }

    res.json({ 
      status: "ok", 
      time: new Date().toISOString(), 
      databaseStatus: dbStatus
    });
  });

  const seedInitialData = async () => {
    try {
      const db = initializeFirebase();
      if (!db) return;
      
      console.log("[Seeding] Starting check...");
      const masterDoc = await getDoc(doc(db, 'master_store', 'dropdowns'));
      if (!masterDoc.exists()) {
        await setDoc(doc(db, 'master_store', 'dropdowns'), {
          shifts: ['Day', 'Night', 'A', 'B', 'C'],
          productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
          uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
          materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
          inlinePrintOptions: ['Yes', 'No'],
          years: ['2023', '2024', '2025', '2026', '2027'],
          breakdownReasons: ['Mechanical', 'Electrical', 'Pneumatic', 'Hydraulic', 'Sensor Failure', 'Heater Band Burnout'],
          idleReasons: ['No Material', 'No Operator', 'Power Interruption', 'Core Shortage', 'Routine Clean-up', 'Awaiting Maintenance Handover']
        });
      } else {
        // Partially sync to add Day/Night or missing tables
        const existingData = masterDoc.data() || {};
        let updated = false;

        const existingShifts = existingData.shifts || [];
        if (!existingShifts.includes('Day') || !existingShifts.includes('Night')) {
          existingData.shifts = Array.from(new Set(['Day', 'Night', ...existingShifts]));
          updated = true;
        }

        if (!existingData.breakdownReasons) {
          existingData.breakdownReasons = ['Mechanical', 'Electrical', 'Pneumatic', 'Hydraulic', 'Sensor Failure', 'Heater Band Burnout'];
          updated = true;
        }

        if (!existingData.idleReasons) {
          existingData.idleReasons = ['No Material', 'No Operator', 'Power Interruption', 'Core Shortage', 'Routine Clean-up', 'Awaiting Maintenance Handover'];
          updated = true;
        }

        if (updated) {
          await setDoc(doc(db, 'master_store', 'dropdowns'), existingData, { merge: true });
        }
      }
      console.log("[Seeding] Database check completed.");
    } catch (error: any) {
      console.error("[Seeding] Error:", error.message);
    }
  };

  const getRollSettings = async () => {
    const db = initializeFirebase();
    if (!db) return { LAST_ROLL_NO: 17413, PREFIX: "R", CURRENT_YEAR: "26" };
    const d = await getDoc(doc(db, 'app_config', 'roll_settings'));
    return d.data() || { LAST_ROLL_NO: 17413, PREFIX: "R", CURRENT_YEAR: "26" };
  };

  const getMasterStore = async () => {
    const db = initializeFirebase();
    const defaults = {
      shifts: ['Day', 'Night', 'A', 'B', 'C'],
      productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
      uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
      materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
      inlinePrintOptions: ['Yes', 'No'],
      years: ['2023', '2024', '2025', '2026', '2027'],
      breakdownReasons: ['Mechanical', 'Electrical', 'Pneumatic', 'Hydraulic', 'Sensor Failure', 'Heater Band Burnout'],
      idleReasons: ['No Material', 'No Operator', 'Power Interruption', 'Core Shortage', 'Routine Clean-up', 'Awaiting Maintenance Handover']
    };
    if (!db) return defaults;
    const d = await getDoc(doc(db, 'master_store', 'dropdowns'));
    if (!d.exists()) {
      return defaults;
    }
    const data = d.data() || {};
    return {
      ...defaults,
      ...data
    };
  };

  const checkAndResetDailyStats = async () => {
    try {
      const db = initializeFirebase();
      if (!db) return;

      const d = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' });
      const parts = formatter.formatToParts(d);
      const pm: any = {};
      parts.forEach(p => pm[p.type] = p.value);
      
      const pYear = parseInt(pm.year, 10);
      const pMonth = parseInt(pm.month, 10) - 1; // JS month 0-11
      const pDay = parseInt(pm.day, 10);
      const pHour = parseInt(pm.hour, 10);
      
      const dhakaTimeDate = new Date(pYear, pMonth, pDay);
      if (pHour < 8) {
        dhakaTimeDate.setDate(dhakaTimeDate.getDate() - 1);
      }
      
      const currentProdDateStr = `${dhakaTimeDate.getFullYear()}-${String(dhakaTimeDate.getMonth()+1).padStart(2,'0')}-${String(dhakaTimeDate.getDate()).padStart(2,'0')}`;

      const configDocRef = doc(db, 'app_config', 'daily_reset');
      const configDoc = await getDoc(configDocRef);
      const lastReset = configDoc.exists() ? configDoc.data().lastResetDate : null;

      if (lastReset !== currentProdDateStr) {
        console.log(`[Daily Reset] Rolling over from ${lastReset} to ${currentProdDateStr}`);
        const machineSnap = await getDocs(collection(db, 'machines'));
        
        let batch = writeBatch(db);
        let count = 0;
        
        machineSnap.docs.forEach(docSnap => {
          batch.update(docSnap.ref, {
            target: 0,
            numIdle: 0,
            numBreakdown: 0,
            idleTime: 0,
            breakdownTime: 0
          });
          count++;
          // Firestore batches are limited to 500 operations, but we probably have <100 machines
        });
        
        await batch.commit();
        await setDoc(configDocRef, { lastResetDate: currentProdDateStr }, { merge: true });
        console.log(`[Daily Reset] Successfully reset ${count} machines' daily statistics.`);
      }
    } catch (err: any) {
      console.error("[Daily Reset Error]:", err.message);
    }
  };

  const getMachines = async () => {

    const db = initializeFirebase();
    if (!db) return [];
    const s = await getDocs(collection(db, 'machines'));
    return s.docs.map(d => d.data());
  };

  const getOperators = async () => {
    const db = initializeFirebase();
    if (!db) return [];
    const s = await getDocs(collection(db, 'operators'));
    return s.docs.map(d => d.data());
  };

  const syncProductionRecords = async () => {
    const db = initializeFirebase();
    if (!db) return [];
    const s = await getDocs(query(collection(db, 'production_records'), orderBy('EntryTimestamp', 'asc')));
    return s.docs.map(d => d.data());
  };

const safeHandler = (fn: (req: any, res: any) => Promise<void>) => async (req: any, res: any, next: any) => {
  try {
    const db = initializeFirebase();
    if (!db && !req.path.includes('/health') && !req.path.includes('/diag')) {
      console.error("[Database Error] DB not initialized for path:", req.path);
      return res.status(503).json({ 
        error: "Database Connection Failed", 
        message: "Firebase is NOT initialized on the server.",
        info: "Check server logs for config/initialization errors."
      });
    }
    await fn(req, res);
  } catch (err: any) {
    console.error(`[Route Error] ${req.method} ${req.path}:`, err);
    res.status(500).json({ 
      error: "Internal Server Error", 
      details: err.message,
      path: req.path
    });
  }
};

  // API Routes
  app.get("/api/master-store", safeHandler(async (req, res) => {
    const masterStore = await getMasterStore();
    res.json(masterStore);
  }));

  app.post("/api/master-store", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const masterStore = req.body;
    await setDoc(doc(db, 'master_store', 'dropdowns'), masterStore);
    res.json({ message: "Master Store updated successfully", masterStore });
  }));

  const calculateNextRollId = async () => {
    const settings = await getRollSettings();
    let lastNo = (settings as any).LAST_ROLL_NO || 0;
    return `${(settings as any).PREFIX}-${lastNo + 1}-${(settings as any).CURRENT_YEAR}`;
  };

  const calculateNextSamplePI = async (yearStr: string) => {
    const db = initializeFirebase();
    if (!db) return `SMPL/00001/${yearStr}`;
    
    const configRef = doc(db, 'app_config', 'sample_settings');
    const configDoc = await getDoc(configRef);
    let nextSerial = 1;
    
    if (configDoc.exists()) {
      nextSerial = (configDoc.data().LAST_SAMPLE_SERIAL || 0) + 1;
    } else {
      const q = query(
        collection(db, 'production_records'),
        where('ProductionType', '==', 'Sample')
      );
      const snapshot = await getDocs(q);
      let maxSerial = 0;
      snapshot.forEach(doc => {
        const d = doc.data();
        const pi = d.PINumber;
        if (pi && typeof pi === 'string' && pi.toUpperCase().startsWith('SMPL/')) {
          const parts = pi.split('/');
          if (parts.length >= 2) {
            const serialNum = parseInt(parts[1], 10);
            if (!isNaN(serialNum) && serialNum > maxSerial) {
              maxSerial = serialNum;
            }
          }
        }
      });
      nextSerial = maxSerial + 1;
    }
    
    const padded = String(nextSerial).padStart(5, '0');
    return `SMPL/${padded}/${yearStr}`;
  };

  app.get("/api/operators", safeHandler(async (req, res) => {
    const operatorMaster = await getOperators();
    res.json(operatorMaster);
  }));

  app.post("/api/operators", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const { id, name, email } = req.body;
    if (!id || !name) {
      return res.status(400).json({ message: "ID and Name are required" });
    }
    const operator = { id, name, email: email || "" };
    await setDoc(doc(db, 'operators', id), operator);
    res.json({ message: "Operator saved successfully", operator });
  }));

  app.get("/api/machines", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const dateQuery = req.query.date as string;
    
    const machineSnapshot = await getDocs(collection(db, 'machines'));
    const baseMachines = machineSnapshot.docs.map(d => d.data());
    
    if (dateQuery) {
      const statsQuery = query(collection(db, 'machine_daily_stats'), where('date', '==', dateQuery));
      const statsSnapshot = await getDocs(statsQuery);
      const dailyStatsMap = new Map();
      statsSnapshot.docs.forEach(d => {
        const data = d.data();
        dailyStatsMap.set(data.machineId, data);
      });
      
      const merged = baseMachines.map((m: any) => {
        const stats = dailyStatsMap.get(m.id) || { target: 0, numIdle: 0, numBreakdown: 0, idleTime: 0, breakdownTime: 0 };
        return {
          ...m,
          ...stats,
          id: m.id
        };
      });
      return res.json(merged);
    }
    
    res.json(baseMachines);
  }));

  app.post("/api/machines", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const { id, type, target } = req.body;
    if (!id || !type) {
      return res.status(400).json({ message: "ID and Type are required" });
    }
    
    const d = await getDoc(doc(db, 'machines', id));
    if (d.exists()) {
      return res.status(400).json({ message: "Machine ID already exists" });
    }

    const newMachine = {
      id,
      type,
      target: Number(target) || 0,
      status: "Idle",
      reason: "Initial Setup",
      numIdle: 0,
      numBreakdown: 0,
      idleTime: 0,
      breakdownTime: 0,
      lastStatusChange: new Date().toISOString()
    };
    await setDoc(doc(db, 'machines', id), newMachine);
    
    triggerDashboardSheetsSync().catch(err => {
      console.error("[POST /api/machines Sync Error]:", err.message);
    });

    res.json({ message: "Machine created successfully", machine: newMachine });
  }));

  function getShiftAndDateForDhaka(date: Date = new Date()): { productionDate: string, shift: string } {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const parts = formatter.formatToParts(date);
      const partMap: Record<string, string> = {};
      parts.forEach(p => {
        partMap[p.type] = p.value;
      });
      
      const year = parseInt(partMap.year, 10);
      const month = parseInt(partMap.month, 10) - 1;
      const day = parseInt(partMap.day, 10);
      const hour = parseInt(partMap.hour, 10);
      
      const dhakaTime = new Date(year, month, day, hour, parseInt(partMap.minute || "0", 10));
      let productionDate = new Date(dhakaTime.getTime());
      let shift = 'Day';
      
      if (hour < 8) {
        productionDate.setDate(productionDate.getDate() - 1);
        shift = 'Night';
      } else if (hour >= 8 && hour < 20) {
        shift = 'Day';
      } else {
        shift = 'Night';
      }
      
      const yyyy = productionDate.getFullYear();
      const mm = String(productionDate.getMonth() + 1).padStart(2, '0');
      const dd = String(productionDate.getDate()).padStart(2, '0');
      
      return {
        productionDate: `${yyyy}-${mm}-${dd}`,
        shift
      };
    } catch (err) {
      const hour = date.getHours();
      let productionDate = new Date(date.getTime());
      let shift = 'Day';
      if (hour < 8) {
        productionDate.setDate(productionDate.getDate() - 1);
        shift = 'Night';
      } else if (hour >= 8 && hour < 20) {
        shift = 'Day';
      } else {
        shift = 'Night';
      }
      const yyyy = productionDate.getFullYear();
      const mm = String(productionDate.getMonth() + 1).padStart(2, '0');
      const dd = String(productionDate.getDate()).padStart(2, '0');
      return {
        productionDate: `${yyyy}-${mm}-${dd}`,
        shift
      };
    }
  }

  app.post("/api/machines/status", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const { id, date, status, reason, target, numIdle, numBreakdown, idleTime, breakdownTime, lastStatusChange } = req.body;
    const docRef = doc(db, 'machines', id);
    const d = await getDoc(docRef);
    if (d.exists()) {
      const oldMachine = d.data();
      const oldStatus = oldMachine.status;
      const oldReason = oldMachine.reason || '';

      const baseUpdates: any = {};
      if (status) baseUpdates.status = status;
      if (reason !== undefined) baseUpdates.reason = reason;
      if (lastStatusChange !== undefined) baseUpdates.lastStatusChange = lastStatusChange;
      if (target !== undefined) baseUpdates.target = Number(target) || 0;
      
      if (Object.keys(baseUpdates).length > 0) {
        await updateDoc(docRef, baseUpdates);
      }

      // Handle Immediate Downtime Tracking & Status Transitions
      if (status && status !== oldStatus) {
        // Transition AWAY from downtime -> finalize the ongoing log
        if (oldStatus === 'Idle' || oldStatus === 'Breakdown') {
          if (oldReason && oldReason !== "" && oldReason !== "NO_ALERTS") {
            const ongoingQuery = query(
              collection(db, 'machine_logs'), 
              where('machineId', '==', id), 
              where('endTime', '==', 'Ongoing')
            );
            const ongoingSnapshot = await getDocs(ongoingQuery);
            for (const logDoc of ongoingSnapshot.docs) {
              const logData = logDoc.data();
              const startTimeStr = logData.startTime;
              const endTimeStr = lastStatusChange || new Date().toISOString();
              
              // Calc duration
              const elapsedMs = new Date(endTimeStr).getTime() - new Date(startTimeStr).getTime();
              const elapsedHours = Number(Math.max(0, elapsedMs / (1000 * 60 * 60)).toFixed(3));

              const updatedLog = {
                endTime: endTimeStr,
                durationHrs: elapsedHours
              };

              await updateDoc(logDoc.ref, updatedLog);

              // Sync finalized log to Google Sheets automatically!
              await syncMachineLogToGoogleSheets({
                ...logData,
                ...updatedLog,
                id: logDoc.id
              });
            }
          }
        }

        // Transition INTO a downtime -> create new ongoing log instantly (ONLY IF reason is selected!)
        if (status === 'Idle' || status === 'Breakdown') {
          let finalReason = reason !== undefined ? reason : (oldMachine.reason || '');
          if (finalReason && finalReason !== "" && finalReason !== "NO_ALERTS") {
            const finalDate = date || getShiftAndDateForDhaka(new Date()).productionDate;
            const newLog = {
              machineId: id,
              date: finalDate,
              status: status,
              reason: finalReason,
              durationHrs: 0,
              startTime: lastStatusChange || new Date().toISOString(),
              endTime: 'Ongoing'
            };
            const docRef = await addDoc(collection(db, 'machine_logs'), newLog);
            await syncMachineLogToGoogleSheets({
              ...newLog,
              id: docRef.id
            });
          }
        }
      } else if (reason !== undefined && reason !== oldReason && (oldStatus === 'Idle' || oldStatus === 'Breakdown')) {
        // Machine remains in downtime, but the reason is changed (or is being set for the first time!)
        // 1. Finalize any existing ongoing logs for the OLD reason
        if (oldReason && oldReason !== "" && oldReason !== "NO_ALERTS") {
          const ongoingQuery = query(
            collection(db, 'machine_logs'), 
            where('machineId', '==', id), 
            where('endTime', '==', 'Ongoing')
          );
          const ongoingSnapshot = await getDocs(ongoingQuery);
          const nowStr = lastStatusChange || new Date().toISOString();

          for (const logDoc of ongoingSnapshot.docs) {
            const logData = logDoc.data();
            const startTimeStr = logData.startTime;
            
            // Calculate duration for this slice
            const elapsedMs = new Date(nowStr).getTime() - new Date(startTimeStr).getTime();
            const elapsedHours = Number(Math.max(0, elapsedMs / (1000 * 60 * 60)).toFixed(3));

            const updatedLog = {
              endTime: nowStr,
              durationHrs: elapsedHours
            };

            await updateDoc(logDoc.ref, updatedLog);

            // Sync finalized log to Google Sheets automatically!
            await syncMachineLogToGoogleSheets({
              ...logData,
              ...updatedLog,
              id: logDoc.id
            });
          }
        }

        // 2. Start a new ongoing log for the NEW reason
        if (reason && reason !== "" && reason !== "NO_ALERTS") {
          const finalDate = date || getShiftAndDateForDhaka(new Date()).productionDate;
          const newLog = {
            machineId: id,
            date: finalDate,
            status: oldStatus,
            reason: reason,
            durationHrs: 0,
            startTime: lastStatusChange || new Date().toISOString(),
            endTime: 'Ongoing'
          };
          const docRef = await addDoc(collection(db, 'machine_logs'), newLog);
          await syncMachineLogToGoogleSheets({
            ...newLog,
            id: docRef.id
          });
        }
      }
      
      // Update daily stats if a date is provided
      if (date) {
         const statsRef = doc(db, 'machine_daily_stats', `${id}_${date}`);
         const statsDoc = await getDoc(statsRef);
         const statsUpdates: any = {};
         if (target !== undefined) statsUpdates.target = target;
         if (numIdle !== undefined) statsUpdates.numIdle = Number(numIdle) || 0;
         if (numBreakdown !== undefined) statsUpdates.numBreakdown = Number(numBreakdown) || 0;
         if (idleTime !== undefined) statsUpdates.idleTime = Number(idleTime) || 0;
         if (breakdownTime !== undefined) statsUpdates.breakdownTime = Number(breakdownTime) || 0;
         
         if (Object.keys(statsUpdates).length > 0) {
            if (statsDoc.exists()) {
               await updateDoc(statsRef, statsUpdates);
            } else {
               await setDoc(statsRef, {
                 machineId: id,
                 date: date,
                 ...statsUpdates
               });
            }
         }
      }

      // Fetch the merged object back to return to the client
      const updatedBase = await getDoc(docRef);
      let mergedData = updatedBase.data();
      if (date) {
         const statsDocFinal = await getDoc(doc(db, 'machine_daily_stats', `${id}_${date}`));
         if (statsDocFinal.exists()) {
            mergedData = { ...mergedData, ...statsDocFinal.data() };
         }
      }
      
      triggerDashboardSheetsSync().catch(err => {
        console.error("[POST /api/machines/status Sync Error]:", err.message);
      });

      res.json({ message: "Machine updated successfully", machine: mergedData });
    } else {
      res.status(404).json({ message: "Machine not found" });
    }
  }));

  app.get("/api/settings", safeHandler(async (req, res) => {
    const settings = await getRollSettings();
    res.json(settings);
  }));

  app.get("/api/settings/google-service-account", safeHandler(async (req, res) => {
    res.json({ email: getServiceAccountEmail() });
  }));

  app.get("/api/settings/google-sheet-config", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.json({ spreadsheetId: "" });
    const d = await getDoc(doc(db, 'app_config', 'sheet'));
    const data = d.data() || {};
    res.json({ spreadsheetId: data.spreadsheetId || "" });
  }));

  app.post("/api/settings/google-sheet-config", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.status(500).json({ error: "No Database" });
    const { spreadsheetId } = req.body;
    await setDoc(doc(db, 'app_config', 'sheet'), { spreadsheetId });
    // Update the memory cache in google_sheets too so that it takes effect immediately!
    const { setCachedSpreadsheetId } = await import("./google_sheets.js");
    setCachedSpreadsheetId(spreadsheetId);
    res.json({ message: "Google Sheet Config updated", spreadsheetId });
  }));

  app.post("/api/settings/test-google-sheets", safeHandler(async (req, res) => {
    try {
      const auth = getGoogleAuth();
      if (!auth) {
        return res.status(400).json({ 
          success: false, 
          error: "Google credentials are missing. Please configure service account credentials on server environment." 
        });
      }
      
      const { google } = await import("googleapis");
      const drive = google.drive({ version: 'v3', auth });
      const sheets = google.sheets({ version: 'v4', auth });
      
      const spreadsheetId = await resolveSpreadsheetId(drive);
      if (!spreadsheetId) {
        return res.status(400).json({ 
          success: false, 
          error: "Spreadsheet ID is not configured. Please save a Spreadsheet ID first." 
        });
      }
      
      // Attempt to fetch spreadsheet metadata to test connectivity and permission
      let spreadsheetMeta;
      try {
        spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
      } catch (err: any) {
        console.error("Test connect failed:", err.message);
        return res.status(400).json({
          success: false,
          error: `Google Sheets Permission Error: Could not access the sheet. Please make sure you have shared your Google Sheet with the Service Account email and set "Editor" permissions.\nDetails: ${err.message}`
        });
      }
      
      const title = spreadsheetMeta.data.properties?.title || "Untitled Spreadsheet";
      const tabs = (spreadsheetMeta.data.sheets || []).map((s: any) => s.properties?.title || "");
      
      // Trigger a dashboard sync immediately to populate the sheet
      await triggerDashboardSheetsSync();
      
      return res.json({
        success: true,
        title,
        tabs,
        message: "Successfully connected to Google Sheet! Initial machine status dashboard sync has been run. / গুগল শীটের সাথে সফলভাবে সংযোগ স্থাপন করা হয়েছে!"
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Unexpected error during test: ${err.message}`
      });
    }
  }));

  app.get("/api/settings/date-filter", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.json({ dateFilter: "" });
    const d = await getDoc(doc(db, 'app_config', 'date_filter'));
    const data = d.data() || {};
    res.json({ dateFilter: data.dateFilter || "" });
  }));

  app.post("/api/settings/date-filter", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.status(500).json({ error: "No Database" });
    const { dateFilter } = req.body;
    await setDoc(doc(db, 'app_config', 'date_filter'), { dateFilter });
    res.json({ message: "Date filter stored", dateFilter });
  }));

  app.get("/api/next-roll-id", safeHandler(async (req, res) => {
    res.json({ nextId: await calculateNextRollId() });
  }));

  app.get("/api/next-sample-pi", safeHandler(async (req, res) => {
    const year = req.query.year ? String(req.query.year) : new Date().getFullYear().toString();
    res.json({ nextPI: await calculateNextSamplePI(year) });
  }));

  app.get("/api/previous-roll-id", safeHandler(async (req, res) => {
    const settings = await getRollSettings();
    let lastNo = (settings as any).LAST_ROLL_NO || 0;
    const previousId = `${(settings as any).PREFIX}-${lastNo}-${(settings as any).CURRENT_YEAR}`;
    res.json({ previousId });
  }));

  app.get("/api/production/recent", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.json([]);
    const s = await getDocs(query(collection(db, 'production_records'), orderBy('EntryTimestamp', 'desc'), limit(50)));
    res.json(s.docs.map(d => d.data()));
  }));

  app.get("/api/production", safeHandler(async (req, res) => {
    const masterData = await syncProductionRecords();
    res.json(masterData);
  }));

  app.post("/api/sync-all-sheets", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    
    // First update Firestore with correct retailer/customer information
    await backfillRetailerCustomerInFirestore();
    
    const recordsSnapshot = await getDocs(
      query(collection(db, "production_records"), orderBy("EntryTimestamp", "asc"))
    );
    const records = recordsSnapshot.docs.map(doc => doc.data());
    
    if (records.length > 0) {
      await syncMultipleToGoogleSheets(records);
    }
    
    res.json({ message: `Sent ${records.length} records to Google Sheets syncing mechanism.` });
  }));

  const formatPINumber = (pi: any, year: any, isSample: boolean = false): string => {
    if (!pi) return '';
    const piStr = String(pi).trim();
    const prefix = isSample ? 'SMPL' : 'MPBL';
    const yearStr = String(year || new Date().getFullYear()).trim();

    // Match patterns like 'MPBL/03500/2026' or 'SMPL/00021/2026' or 'mpbl/123/2022'
    const regex = /^(mpbl|smpl)\/(\d+)\/(\d{4})$/i;
    const match = piStr.match(regex);
    if (match) {
      const rawDigits = match[2];
      const matchYear = match[3];
      return `${prefix}/${rawDigits.padStart(5, '0')}/${matchYear}`;
    }

    // Match if it's just raw digits (e.g. 3500)
    if (/^\d+$/.test(piStr)) {
      return `${prefix}/${piStr.padStart(5, '0')}/${yearStr}`;
    }

    // Otherwise, clean characters and try to extract digits
    const onlyDigits = piStr.replace(/\D/g, '');
    if (onlyDigits) {
      return `${prefix}/${onlyDigits.padStart(5, '0')}/${yearStr}`;
    }

    return piStr.toUpperCase();
  };

  app.post("/api/production", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const entry = req.body;
    
    // Auto-generate unique Roll ID on server
    const newRollId = await calculateNextRollId();
    
    // Update settings.LAST_ROLL_NO to keep it in sync
    const parts = newRollId.split('-');
    if (parts.length === 3) {
      const newLastNo = parseInt(parts[1]);
      await setDoc(doc(db, 'app_config', 'roll_settings'), { LAST_ROLL_NO: newLastNo, PREFIX: parts[0], CURRENT_YEAR: parts[2] }, { merge: true });
    }
    
    const date = new Date(entry.ProductionDate || new Date());
    
    const isSample = entry.ProductionType === 'Sample';
    const formattedPI = formatPINumber(entry.PINumber, entry.Year || date.getFullYear().toString(), isSample);
    
    if (isSample) {
      const smplParts = formattedPI.split('/');
      if (smplParts.length >= 2) {
        const serialVal = parseInt(smplParts[1], 10);
        if (!isNaN(serialVal)) {
          await setDoc(doc(db, 'app_config', 'sample_settings'), { LAST_SAMPLE_SERIAL: serialVal }, { merge: true });
        }
      }
    }

    const piDetails = await getPendingOrderDetailsByPi(formattedPI);

    const newEntry = {
      ...entry,
      PINumber: formattedPI,
      Retailer: piDetails.retailer || '',
      Customer: piDetails.customer || '',
      RollID: newRollId,
      EntryTimestamp: new Date().toISOString(),
      DataUpdateTime: new Date().toLocaleString(),
      Fingerprint: Math.random().toString(36).substring(2, 10).toUpperCase(),
      EnteredBy: "Plant Admin", 
      ProductionYear: date.getFullYear().toString(),
      ProductionMonth: date.toLocaleString('default', { month: 'long' })
    };
    
    const cleanEntry = Object.fromEntries(
      Object.entries(newEntry).filter(([_, v]) => v !== undefined)
    );
    
    await addDoc(collection(db, 'production_records'), cleanEntry);

    // Sync to Google Sheets using the service account credential
    await syncToGoogleSheets(cleanEntry);

    triggerDashboardSheetsSync().catch(err => {
      console.error("[POST /api/production Sync Error]:", err.message);
    });

    res.status(201).json({ 
      message: "Production Entry Saved Successfully", 
      entry: newEntry 
    });
  }));

  app.post("/api/utils/normalize-dates", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const snap = await getDocs(collection(db, 'production_records'));
    const batch = writeBatch(db);
    let count = 0;
    
    // We need normalizeDateString here on the server
    const normalizeDate = (dateStr: string | number) => {
      if (!dateStr) return '';
      if (typeof dateStr === 'number') {
        const d = new Date((dateStr - (25567 + 2)) * 86400 * 1000);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      }
      const str = String(dateStr).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
      try {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      } catch (e) {}
      return str;
    };

    snap.docs.forEach(d => {
      const data = d.data();
      const nDate = normalizeDate(data.ProductionDate);
      if (nDate && nDate !== data.ProductionDate) {
        batch.update(d.ref, { ProductionDate: nDate });
        count++;
      }
    });

    await batch.commit();
    res.json({ message: `Normalized ${count} records` });
  }));

  app.post("/api/production/bulk", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const entries = req.body;
    
    if (!Array.isArray(entries)) {
      return res.status(400).json({ message: "Payload must be an array of entries" });
    }

    const normalizeDate = (dateStr: string | number) => {
      if (!dateStr) return '';
      if (typeof dateStr === 'number') {
        const d = new Date((dateStr - (25567 + 2)) * 86400 * 1000);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      }
      const str = String(dateStr).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
      try {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      } catch (e) {}
      return str;
    };

    let lastRollNo = 0;
    
    // Process in chunks of 450 to avoid Firestore's 500 limit
    const chunkSize = 450;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      
      for (const entry of chunk) {
        if (!entry.RollID) {
           entry.RollID = `EXT-IMPORTED-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
        } else {
          const parts = entry.RollID.split('-');
          if (parts.length === 3) {
            const num = parseInt(parts[1]);
            if (!isNaN(num) && num > lastRollNo) {
              lastRollNo = num;
            }
          }
        }
        
        const newRef = doc(collection(db, 'production_records'));
        batch.set(newRef, {
          ...entry,
          ProductionDate: normalizeDate(entry.ProductionDate),
          EntryTimestamp: entry.EntryTimestamp || new Date().toISOString(),
          DataUpdateTime: entry.DataUpdateTime || new Date().toLocaleString(),
          Fingerprint: entry.Fingerprint || Math.random().toString(36).substring(2, 10).toUpperCase(),
          EnteredBy: entry.EnteredBy || "Imported Data",
        });
      }
      
      await batch.commit();
    }
    
    // Also update settings.LAST_ROLL_NO if we imported larger roll numbers
    if (lastRollNo > 0) {
      const settingsRef = doc(db, 'app_config', 'roll_settings');
      const docSnap = await getDoc(settingsRef);
      let currentNo = 0;
      if (docSnap.exists()) {
        currentNo = docSnap.data().LAST_ROLL_NO || 0;
      }
      if (lastRollNo > currentNo) {
        await setDoc(settingsRef, { LAST_ROLL_NO: lastRollNo }, { merge: true });
      }
    }

    triggerDashboardSheetsSync().catch(err => {
      console.error("[POST /api/production/bulk Sync Error]:", err.message);
    });

    // Also run full resync to Google Sheets so all imported records are written
    getDocs(query(collection(db, "production_records"), orderBy("EntryTimestamp", "asc")))
      .then(async (recordsSnapshot) => {
        const records = recordsSnapshot.docs.map(doc => doc.data());
        if (records.length > 0) {
          console.log(`[Bulk Import] Running full sheets resync with ${records.length} records.`);
          await syncMultipleToGoogleSheets(records);
        }
      })
      .catch(err => {
        console.error("[Bulk Import Google Sheets Sync Error]:", err.message);
      });

    res.status(201).json({ 
      message: `${entries.length} records imported successfully`
    });
  }));

  app.post("/api/production/update", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const { RollID, ...updates } = req.body;
    if (!RollID) {
      return res.status(400).json({ message: "RollID is required for update" });
    }

    // Find the document in the database
    const q = query(collection(db, 'production_records'), where('RollID', '==', RollID));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return res.status(404).json({ message: `Production report with RollID ${RollID} not found` });
    }

    const docId = snapshot.docs[0].id;
    const originalData = snapshot.docs[0].data();
    const docRef = doc(db, 'production_records', docId);

    // Filter updates
    const cleanedUpdates: any = { ...updates };
    const checkType = updates.ProductionType || originalData.ProductionType;
    const isSample = checkType === 'Sample';
    
    let piToUse = updates.PINumber || originalData.PINumber || '';
    const yearToUse = updates.Year || originalData.Year || new Date().getFullYear().toString();
    
    if (updates.PINumber || updates.Year || updates.ProductionType) {
      const formatted = formatPINumber(piToUse, yearToUse, isSample);
      cleanedUpdates.PINumber = formatted;
      
      const piDetails = await getPendingOrderDetailsByPi(formatted);
      cleanedUpdates.Retailer = piDetails.retailer || '';
      cleanedUpdates.Customer = piDetails.customer || '';
      
      if (isSample) {
        const smplParts = formatted.split('/');
        if (smplParts.length >= 2) {
          const serialVal = parseInt(smplParts[1], 10);
          if (!isNaN(serialVal)) {
            await setDoc(doc(db, 'app_config', 'sample_settings'), { LAST_SAMPLE_SERIAL: serialVal }, { merge: true });
          }
        }
      }
    }
    if (updates.ProductionDate) {
      const date = new Date(updates.ProductionDate);
      cleanedUpdates.ProductionYear = date.getFullYear().toString();
      cleanedUpdates.ProductionMonth = date.toLocaleString('default', { month: 'long' });
    }
    cleanedUpdates.DataUpdateTime = new Date().toLocaleString();

    await updateDoc(docRef, cleanedUpdates);

    // Get the fully updated production entry to sync with Google Sheets
    const updatedDocSnap = await getDoc(docRef);
    if (updatedDocSnap.exists()) {
      const fullUpdatedData = updatedDocSnap.data();
      await syncUpdatedEntryToGoogleSheets(fullUpdatedData);
    }

    triggerDashboardSheetsSync().catch(err => {
      console.error("[POST /api/production/update Sync Error]:", err.message);
    });

    res.json({ message: "Production entry updated successfully" });
  }));

  app.get("/api/machine-logs", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.json([]);
    const s = await getDocs(query(collection(db, 'machine_logs'), orderBy('endTime', 'desc')));
    res.json(s.docs.map(d => ({ id: d.id, ...d.data() })));
  }));

  app.get("/api/pending-orders/current", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.json(null);
    const docRef = doc(db, 'pending_orders_info', 'current');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return res.json(docSnap.data());
    }
    return res.json(null);
  }));

  app.post("/api/pending-orders/upload", safeHandler(async (req, res) => {
    const { base64Content, filename } = req.body;
    if (!base64Content || !filename) {
      return res.status(400).json({ error: "Missing file content or filename" });
    }

    const uploadResult = await uploadPendingOrdersToGoogleSheets(base64Content, filename);
    if (uploadResult) {
      const db = initializeFirebase();
      if (db) {
        const docRef = doc(db, 'pending_orders_info', 'current');
        await setDoc(docRef, uploadResult);
        
        // Asynchronously backfill Firestore in the background
        backfillRetailerCustomerInFirestore().catch(err => {
          console.error("Delayed backfill error after upload:", err.message);
        });
      }
    }
    res.json(uploadResult);
  }));

  app.delete("/api/pending-orders/current", safeHandler(async (req, res) => {
    await deletePendingOrdersFromGoogleSheets();
    const db = initializeFirebase();
    if (db) {
      const docRef = doc(db, 'pending_orders_info', 'current');
      await deleteDoc(docRef);
    }
    res.json({ message: "Successfully cleared pending orders from Google Sheet and database" });
  }));

  app.post("/api/sync-all-breakdown-sheets", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const recordsSnapshot = await getDocs(
      query(collection(db, "machine_logs"), orderBy("endTime", "asc"))
    );
    const records = recordsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    if (records.length > 0) {
      await syncMultipleMachineLogsToGoogleSheets(records);
    }
    
    res.json({ message: `Sent ${records.length} breakdown logs to Google Sheets syncing mechanism.` });
  }));

  app.post("/api/machine-logs", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.status(500).json({ error: "No DB" });
    const log = req.body;
    const docRef = await addDoc(collection(db, 'machine_logs'), log);
    
    // Sync this single log to Google Sheets Breakdown Logs tab
    await syncMachineLogToGoogleSheets({
      ...log,
      id: docRef.id
    });

    triggerDashboardSheetsSync().catch(err => {
      console.error("[POST /api/machine-logs Sync Error]:", err.message);
    });

    res.json({ message: "Log created", id: docRef.id });
  }));

  app.post("/api/utils/clear-breakdown", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.status(500).json({ error: "No DB" });
    
    // Clear machine_logs
    const logsSnap = await getDocs(collection(db, 'machine_logs'));
    let batch = writeBatch(db);
    let countLogs = 0;
    logsSnap.docs.forEach(d => {
      batch.delete(d.ref);
      countLogs++;
    });
    
    // Reset machines
    const machinesSnap = await getDocs(collection(db, 'machines'));
    machinesSnap.docs.forEach(d => {
      batch.update(d.ref, {
        status: "Running",
        reason: "",
        idleTime: 0,
        breakdownTime: 0,
        numIdle: 0,
        numBreakdown: 0,
        lastStatusChange: new Date().toISOString()
      });
    });

    // Reset machine_daily_stats
    const statsSnap = await getDocs(collection(db, 'machine_daily_stats'));
    statsSnap.docs.forEach(d => {
       batch.update(d.ref, {
         target: 0,
         idleTime: 0,
         breakdownTime: 0,
         numIdle: 0,
         numBreakdown: 0
       });
    });
    
    if (countLogs > 0 || machinesSnap.docs.length > 0 || statsSnap.docs.length > 0) {
       await batch.commit();
    }

    triggerDashboardSheetsSync().catch(err => {
      console.error("[POST /api/utils/clear-breakdown Sync Error]:", err.message);
    });
    
    res.json({ message: `Cleared ${countLogs} logs, reset machines and stats.` });
  }));

  app.get("/api/dashboard", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const dateQuery = req.query.date as string;
    console.log(`[GET /api/dashboard] dateQuery: ${dateQuery}`);
    if (!db) throw new Error("Database not initialized");

    const machineSnapshot = await getDocs(collection(db, 'machines'));
    const baseMachines = machineSnapshot.docs.map(d => d.data());
    
    // Fetch daily stats to merge target
    const dailyStatsMap = new Map();
    if (dateQuery) {
        const statsQuery = query(collection(db, 'machine_daily_stats'), where('date', '==', dateQuery));
        const statsSnapshot = await getDocs(statsQuery);
        statsSnapshot.docs.forEach(d => {
            const data = d.data();
            dailyStatsMap.set(data.machineId, data);
        });
    }

    // Fetch production records (always fetch all for now, to ensure filtering works correctly)
    const productionSnapshot = await getDocs(query(collection(db, 'production_records')));
    let masterData = productionSnapshot.docs.map(d => d.data());
    
    // Manual filtering
    if (dateQuery) {
        masterData = masterData.filter(d => d.ProductionDate === dateQuery);
    }
    
    // Debug: log first few dates
    console.log(`[GET /api/dashboard] Found ${masterData.length} records. First 3 dates:`, masterData.slice(0, 3).map(d => d.ProductionDate));

    const summary = baseMachines.map((m: any) => {
      const machineProduction = masterData.filter((d: any) => d.MachineNo === m.id);
      const dailyStats = dailyStatsMap.get(m.id) || { 
        target: 0,
        numBreakdown: 0,
        breakdownTime: 0,
        numIdle: 0,
        idleTime: 0
      };

      // Calculate real-time idle and breakdown count and duration (in minutes after multiplying hours by 60)
      let idleNoOfTimes = dailyStats.numIdle || m.numIdle || 0;
      let idleTimeHrs = dailyStats.idleTime || m.idleTime || 0;
      let breakdownNoOfTimes = dailyStats.numBreakdown || m.numBreakdown || 0;
      let breakdownTimeHrs = dailyStats.breakdownTime || m.breakdownTime || 0;

      // Handle ongoing/active downtime directly or if state is current
      if (m.status === 'Idle') {
        if (idleNoOfTimes === 0) {
          idleNoOfTimes = 1;
        }
        if (m.lastStatusChange && !isNaN(Date.parse(m.lastStatusChange))) {
          const elapsedMs = Date.now() - new Date(m.lastStatusChange).getTime();
          const elapsedHrs = Math.max(0, elapsedMs / (1000 * 60 * 60));
          idleTimeHrs += elapsedHrs;
        }
      } else if (m.status === 'Breakdown') {
        if (breakdownNoOfTimes === 0) {
          breakdownNoOfTimes = 1;
        }
        if (m.lastStatusChange && !isNaN(Date.parse(m.lastStatusChange))) {
          const elapsedMs = Date.now() - new Date(m.lastStatusChange).getTime();
          const elapsedHrs = Math.max(0, elapsedMs / (1000 * 60 * 60));
          breakdownTimeHrs += elapsedHrs;
        }
      }

      const idleDurationMins = Number((idleTimeHrs * 60).toFixed(2));
      const breakdownDurationMins = Number((breakdownTimeHrs * 60).toFixed(2));
      
      return {
        Date: dateQuery || new Date().toISOString().split('T')[0],
        MachineNo: m.id || 'Unknown',
        TargetKgs: dailyStats.target || 0,
        TotalRolls: machineProduction.length || 0,
        TotalMeter: machineProduction.reduce((acc, curr) => acc + (Number(curr.FinishedMeter) || 0), 0),
        TotalProductionKgs: machineProduction.reduce((acc, curr) => acc + (Number(curr.FinishedKgs) || 0), 0),
        MachineStatus: m.status || 'Idle',
        BreakdownType: (m.status === 'Breakdown' && m.reason !== 'NO_ALERTS' && m.reason !== 'Initial Setup') ? (m.reason || '') : '',
        ReasonOfIdle: (m.status === 'Idle' && m.reason !== 'NO_ALERTS' && m.reason !== 'Initial Setup') ? (m.reason || '') : '',
        LastUpdateTime: m.lastStatusChange || (machineProduction.length > 0 ? machineProduction[machineProduction.length - 1].DataUpdateTime : "N/A"),
        BreakdownNoOfTimes: breakdownNoOfTimes,
        BreakdownDurationMins: breakdownDurationMins,
        IdleNoOfTimes: idleNoOfTimes,
        IdleDurationMins: idleDurationMins,
        LastUpdate: m.lastStatusChange || (machineProduction.length > 0 ? machineProduction[machineProduction.length - 1].DataUpdateTime : "N/A"),
        Reason: (m.reason === 'NO_ALERTS' || m.reason === 'Initial Setup') ? '' : (m.reason || '')
      };
    });

    // Save/Sync to Firebase collection "dashboard_table"
    // Optimization: disable auto-syncing every dashboard fetch to save DB quota
    /* 
    await Promise.all(summary.map(async (row) => {
       const docRef = doc(db, 'dashboard_table', `${row.Date}_${row.MachineNo}`);
       await setDoc(docRef, row);
    }));
    */

    res.json({
      summary,
      dailyTotals: {
        totalKgs: masterData.reduce((acc, curr) => acc + (Number(curr.FinishedKgs) || 0), 0),
        totalRolls: masterData.length,
        totalMeter: masterData.reduce((acc, curr) => acc + (Number(curr.FinishedMeter) || 0), 0)
      }
    });
  }));

  // Auto-run database check on startup to merge any new tables securely
  seedInitialData().catch(err => {
    console.error("[Startup Seeding Check Failed]:", err);
  });

  async function triggerDashboardSheetsSync() {
    try {
      const db = initializeFirebase();
      if (!db) {
        console.warn("[Auto-Sync] Firestore database not ready.");
        return;
      }

      const { productionDate } = getShiftAndDateForDhaka(new Date());
      
      // Fetch machines
      const machineSnapshot = await getDocs(collection(db, 'machines'));
      const baseMachines = machineSnapshot.docs.map(d => d.data());
      
      // Fetch daily stats for today
      const dailyStatsMap = new Map();
      const statsQuery = query(collection(db, 'machine_daily_stats'), where('date', '==', productionDate));
      const statsSnapshot = await getDocs(statsQuery);
      statsSnapshot.docs.forEach(d => {
          const data = d.data();
          dailyStatsMap.set(data.machineId, data);
      });

      // Fetch production records for today
      const productionQuery = query(collection(db, 'production_records'), where('ProductionDate', '==', productionDate));
      const productionSnapshot = await getDocs(productionQuery);
      const masterData = productionSnapshot.docs.map(d => d.data());

      // Generate summary array exactly like GET /api/dashboard
      const summary = baseMachines.map((m: any) => {
        const machineProduction = masterData.filter((d: any) => d.MachineNo === m.id);
        const dailyStats = dailyStatsMap.get(m.id) || { 
          target: 0,
          numBreakdown: 0,
          breakdownTime: 0,
          numIdle: 0,
          idleTime: 0
        };

        // Calculate real-time idle and breakdown count and duration (in minutes after multiplying hours by 60)
        let idleNoOfTimes = dailyStats.numIdle || m.numIdle || 0;
        let idleTimeHrs = dailyStats.idleTime || m.idleTime || 0;
        let breakdownNoOfTimes = dailyStats.numBreakdown || m.numBreakdown || 0;
        let breakdownTimeHrs = dailyStats.breakdownTime || m.breakdownTime || 0;

        // Handle ongoing/active downtime directly or if state is current
        if (m.status === 'Idle') {
          if (idleNoOfTimes === 0) {
            idleNoOfTimes = 1;
          }
          if (m.lastStatusChange && !isNaN(Date.parse(m.lastStatusChange))) {
            const elapsedMs = Date.now() - new Date(m.lastStatusChange).getTime();
            const elapsedHrs = Math.max(0, elapsedMs / (1000 * 60 * 60));
            idleTimeHrs += elapsedHrs;
          }
        } else if (m.status === 'Breakdown') {
          if (breakdownNoOfTimes === 0) {
            breakdownNoOfTimes = 1;
          }
          if (m.lastStatusChange && !isNaN(Date.parse(m.lastStatusChange))) {
            const elapsedMs = Date.now() - new Date(m.lastStatusChange).getTime();
            const elapsedHrs = Math.max(0, elapsedMs / (1000 * 60 * 60));
            breakdownTimeHrs += elapsedHrs;
          }
        }

        const idleDurationMins = Number((idleTimeHrs * 60).toFixed(2));
        const breakdownDurationMins = Number((breakdownTimeHrs * 60).toFixed(2));
        
        return {
          Date: productionDate,
          MachineNo: m.id || 'Unknown',
          TargetKgs: dailyStats.target || 0,
          TotalRolls: machineProduction.length || 0,
          TotalMeter: machineProduction.reduce((acc: number, curr: any) => acc + (Number(curr.FinishedMeter) || 0), 0),
          TotalProductionKgs: machineProduction.reduce((acc: number, curr: any) => acc + (Number(curr.FinishedKgs) || 0), 0),
          MachineStatus: m.status || 'Idle',
          BreakdownType: (m.status === 'Breakdown' && m.reason !== 'NO_ALERTS' && m.reason !== 'Initial Setup') ? (m.reason || '') : '',
          ReasonOfIdle: (m.status === 'Idle' && m.reason !== 'NO_ALERTS' && m.reason !== 'Initial Setup') ? (m.reason || '') : '',
          LastUpdateTime: m.lastStatusChange || (machineProduction.length > 0 ? machineProduction[machineProduction.length - 1].DataUpdateTime : "N/A"),
          BreakdownNoOfTimes: breakdownNoOfTimes,
          BreakdownDurationMins: breakdownDurationMins,
          IdleNoOfTimes: idleNoOfTimes,
          IdleDurationMins: idleDurationMins,
          LastUpdate: m.lastStatusChange || (machineProduction.length > 0 ? machineProduction[machineProduction.length - 1].DataUpdateTime : "N/A"),
          Reason: (m.reason === 'NO_ALERTS' || m.reason === 'Initial Setup') ? '' : (m.reason || '')
        };
      });

      // Sync to Google Sheets
      await syncDashboardToGoogleSheets(summary);
    } catch (error: any) {
      console.error("[Auto-Sync Error]:", error.message);
    }
  };

  // Run initial sync and backfill after a short delay (10 seconds) on server startup
  setTimeout(() => {
    console.log("[Auto-Sync] Running initial startup dashboard sync & firestore backfill...");
    backfillRetailerCustomerInFirestore().catch(console.error);
    triggerDashboardSheetsSync().catch(console.error);
  }, 10000);

  // Auto sync every 2 hours in continuous server environment to conserve database read quota
  if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
    setInterval(() => {
      console.log("[Auto-Sync] Running 2-hour interval dashboard sync...");
      triggerDashboardSheetsSync().catch(console.error);
    }, 7200000); // 2 hours = 7,200,000 ms
  }

export default app;

