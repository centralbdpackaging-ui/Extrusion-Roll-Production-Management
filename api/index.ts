import express from "express";
import path from "path";
import fs from "fs";
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
          years: ['2023', '2024', '2025', '2026', '2027']
        });
      } else {
        // Partially sync to add Day and Night if they are missing
        const existingData = masterDoc.data() || {};
        const existingShifts = existingData.shifts || [];
        if (!existingShifts.includes('Day') || !existingShifts.includes('Night')) {
          const updatedShifts = Array.from(new Set(['Day', 'Night', ...existingShifts]));
          await setDoc(doc(db, 'master_store', 'dropdowns'), {
            ...existingData,
            shifts: updatedShifts
          }, { merge: true });
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
    if (!db) return {
      shifts: ['Day', 'Night', 'A', 'B', 'C'],
      productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
      uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
      materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
      inlinePrintOptions: ['Yes', 'No'],
      years: ['2023', '2024', '2025', '2026', '2027']
    };
    const d = await getDoc(doc(db, 'master_store', 'dropdowns'));
    return d.data() || {
      shifts: ['Day', 'Night', 'A', 'B', 'C'],
      productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
      uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
      materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
      inlinePrintOptions: ['Yes', 'No'],
      years: ['2023', '2024', '2025', '2026', '2027']
    };
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
    const masterData = await syncProductionRecords();

    let lastNo = (settings as any).LAST_ROLL_NO;
    if (masterData.length > 0) {
      const rollNums = masterData.map((d: any) => {
        if (typeof d.RollID === 'string') {
          const parts = d.RollID.split('-');
          if (parts.length === 3) return parseInt(parts[1]);
        }
        return 0;
      });
      const maxInDb = Math.max(...rollNums || [0]);
      if (maxInDb > lastNo) lastNo = maxInDb;
    }
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
    const machineMaster = await getMachines();
    res.json(machineMaster);
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
      reason: "Initial Setup"
    };
    await setDoc(doc(db, 'machines', id), newMachine);
    res.json({ message: "Machine created successfully", machine: newMachine });
  }));

  app.post("/api/machines/status", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    const { id, status, reason, target } = req.body;
    const docRef = doc(db, 'machines', id);
    const d = await getDoc(docRef);
    if (d.exists()) {
      const updates: any = {};
      if (status) updates.status = status;
      if (reason !== undefined) updates.reason = reason;
      if (target) updates.target = target;
      await updateDoc(docRef, updates);
      const updated = await getDoc(docRef);
      res.json({ message: "Machine updated successfully", machine: updated.data() });
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
    const masterData = await syncProductionRecords();
    
    let lastNo = (settings as any).LAST_ROLL_NO;
    if (masterData.length > 0) {
      const rollNums = masterData.map((d: any) => {
        if (typeof d.RollID === 'string') {
          const parts = d.RollID.split('-');
          if (parts.length === 3) return parseInt(parts[1]);
        }
        return 0;
      });
      const maxInDb = Math.max(...rollNums || [0]);
      if (maxInDb > lastNo) lastNo = maxInDb;
    }
    const previousId = `${(settings as any).PREFIX}-${lastNo}-${(settings as any).CURRENT_YEAR}`;
    res.json({ previousId });
  }));

  app.get("/api/production", safeHandler(async (req, res) => {
    const masterData = await syncProductionRecords();
    res.json(masterData);
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

    res.status(201).json({ 
      message: "Production Entry Saved Successfully", 
      entry: newEntry 
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

  app.get("/api/dashboard", safeHandler(async (req, res) => {
    const db = initializeFirebase();
    if (!db) throw new Error("Database not initialized");

    const machineSnapshot = await getDocs(collection(db, 'machines'));
    const machineMaster = machineSnapshot.docs.map(d => d.data());
    
    const productionSnapshot = await getDocs(query(collection(db, 'production_records'), orderBy('EntryTimestamp', 'asc')));
    const masterData = productionSnapshot.docs.map(d => d.data());

    const summary = machineMaster.map((m: any) => {
      const machineProduction = masterData.filter((d: any) => d.MachineNo === m.id);
      return {
        MachineNo: m.id,
        TargetKgs: m.target,
        TotalRolls: machineProduction.length,
        TotalMeter: machineProduction.reduce((acc, curr) => acc + (Number(curr.FinishedMeter) || 0), 0),
        TotalProductionKgs: machineProduction.reduce((acc, curr) => acc + (Number(curr.FinishedKgs) || 0), 0),
        Status: m.status,
        Reason: m.reason,
        LastUpdate: machineProduction.length > 0 ? machineProduction[machineProduction.length - 1].DataUpdateTime : "N/A"
      };
    });

    res.json({
      summary,
      dailyTotals: {
        totalKgs: masterData.reduce((acc, curr) => acc + (Number(curr.FinishedKgs) || 0), 0),
        totalRolls: masterData.length,
        totalMeter: masterData.reduce((acc, curr) => acc + (Number(curr.FinishedMeter) || 0), 0)
      }
    });
  }));

export { app };
export default app;
