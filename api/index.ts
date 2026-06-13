import express from "express";
import path from "path";
import fs from "fs";
import { syncToGoogleSheets, syncMultipleToGoogleSheets } from "./google_sheets.js";
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
  where
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
      
      for (const p of paths) {
        if (fs.existsSync(p)) {
          console.log("[Firebase] Loading from file:", p);
          config = JSON.parse(fs.readFileSync(p, "utf-8"));
          break;
        }
      }
    }

    // 3. Last Resort: Use hardcoded fallback
    if (!config || !config.apiKey) {
      console.warn("[Firebase] Config not found in ENV or FILES. Using Fallback.");
      config = FALLBACK_CONFIG;
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
    res.json({ message: "Machine created successfully", machine: newMachine });
  }));

  app.post("/api/machines/status", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const { id, date, status, reason, target, numIdle, numBreakdown, idleTime, breakdownTime, lastStatusChange } = req.body;
    const docRef = doc(db, 'machines', id);
    const d = await getDoc(docRef);
    if (d.exists()) {
      const baseUpdates: any = {};
      if (status) baseUpdates.status = status;
      if (reason !== undefined) baseUpdates.reason = reason;
      if (lastStatusChange !== undefined) baseUpdates.lastStatusChange = lastStatusChange;
      
      if (Object.keys(baseUpdates).length > 0) {
        await updateDoc(docRef, baseUpdates);
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
      
      res.json({ message: "Machine updated successfully", machine: mergedData });
    } else {
      res.status(404).json({ message: "Machine not found" });
    }
  }));

  app.get("/api/settings", safeHandler(async (req, res) => {
    const settings = await getRollSettings();
    res.json(settings);
  }));

  app.get("/api/next-roll-id", safeHandler(async (req, res) => {
    res.json({ nextId: await calculateNextRollId() });
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
    const recordsSnapshot = await getDocs(
      query(collection(db, "production_records"), orderBy("EntryTimestamp", "asc"))
    );
    const records = recordsSnapshot.docs.map(doc => doc.data());
    
    if (records.length > 0) {
      await syncMultipleToGoogleSheets(records);
    }
    
    res.json({ message: `Sent ${records.length} records to Google Sheets syncing mechanism.` });
  }));

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
    const newEntry = {
      ...entry,
      RollID: newRollId,
      EntryTimestamp: new Date().toISOString(),
      DataUpdateTime: new Date().toLocaleString(),
      Fingerprint: Math.random().toString(36).substring(2, 10).toUpperCase(),
      EnteredBy: "Plant Admin", 
      ProductionYear: date.getFullYear().toString(),
      ProductionMonth: date.toLocaleString('default', { month: 'long' })
    };
    
    await addDoc(collection(db, 'production_records'), newEntry);

    // Sync to Google Sheets using the service account credential
    await syncToGoogleSheets(newEntry);

    res.status(201).json({ 
      message: "Production Entry Saved Successfully", 
      entry: newEntry 
    });

    // Cleanup data older than 48 hours from Firestore
    (async () => {
      try {
         const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
         const oldQuery = query(collection(db, 'production_records'), where('EntryTimestamp', '<', twoDaysAgo));
         const oldDocs = await getDocs(oldQuery);
         if (!oldDocs.empty) {
            const batch = writeBatch(db);
            oldDocs.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            console.log(`Cleaned up ${oldDocs.docs.length} old records from Firestore.`);
         }
      } catch (err) {
         console.error('Failed to cleanup old records:', err);
      }
    })();
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
    const docRef = doc(db, 'production_records', docId);

    // Filter updates
    const cleanedUpdates: any = { ...updates };
    if (updates.ProductionDate) {
      const date = new Date(updates.ProductionDate);
      cleanedUpdates.ProductionYear = date.getFullYear().toString();
      cleanedUpdates.ProductionMonth = date.toLocaleString('default', { month: 'long' });
    }
    cleanedUpdates.DataUpdateTime = new Date().toLocaleString();

    await updateDoc(docRef, cleanedUpdates);

    res.json({ message: "Production entry updated successfully" });
  }));

  app.get("/api/machine-logs", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.json([]);
    const s = await getDocs(query(collection(db, 'machine_logs'), orderBy('endTime', 'desc')));
    res.json(s.docs.map(d => ({ id: d.id, ...d.data() })));
  }));

  app.post("/api/machine-logs", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) return res.status(500).json({ error: "No DB" });
    const log = req.body;
    const docRef = await addDoc(collection(db, 'machine_logs'), log);
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
    
    res.json({ message: `Cleared ${countLogs} logs, reset machines and stats.` });
  }));

  app.get("/api/dashboard", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const dateQuery = req.query.date as string;
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

    const productionQuery = dateQuery 
      ? query(collection(db, 'production_records'), where('ProductionDate', '==', dateQuery))
      : query(collection(db, 'production_records'));
      
    const productionSnapshot = await getDocs(productionQuery);
    const masterData = productionSnapshot.docs.map(d => d.data());

    const summary = baseMachines.map((m: any) => {
      const machineProduction = masterData.filter((d: any) => d.MachineNo === m.id);
      const dailyStats = dailyStatsMap.get(m.id) || { 
        target: m.target || 0,
        numBreakdown: 0,
        breakdownTime: 0,
        numIdle: 0,
        idleTime: 0
      };
      
      return {
        Date: dateQuery || new Date().toISOString().split('T')[0],
        MachineNo: m.id || 'Unknown',
        TargetKgs: dailyStats.target || 0,
        TotalRolls: machineProduction.length || 0,
        TotalMeter: machineProduction.reduce((acc, curr) => acc + (Number(curr.FinishedMeter) || 0), 0),
        TotalProductionKgs: machineProduction.reduce((acc, curr) => acc + (Number(curr.FinishedKgs) || 0), 0),
        MachineStatus: m.status || 'Idle',
        BreakdownType: m.status === 'Breakdown' ? (m.reason || '') : '',
        ReasonOfIdle: m.status === 'Idle' ? (m.reason || '') : '',
        LastUpdateTime: m.lastStatusChange || (machineProduction.length > 0 ? machineProduction[machineProduction.length - 1].DataUpdateTime : "N/A"),
        BreakdownNoOfTimes: dailyStats.numBreakdown || 0,
        BreakdownDurationMins: dailyStats.breakdownTime || 0,
        IdleNoOfTimes: dailyStats.numIdle || 0,
        IdleDurationMins: dailyStats.idleTime || 0,
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

export { app };
export default app;
