import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
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
  writeBatch 
} from "firebase/firestore";

import { fileURLToPath } from 'url';

const app = express();
// Fallback for __dirname and __filename in ESM
const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);

let firebaseApp: any;
let dbInstance: any;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const initializeFirebase = () => {
  if (dbInstance) return dbInstance;
  try {
    // 1. Try Environment Variable first (Best for Vercel)
    if (process.env.FIREBASE_CONFIG_JSON) {
       console.log("[Firebase] Initializing from Environment Variable...");
       const config = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
       firebaseApp = initializeApp(config);
       dbInstance = getFirestore(firebaseApp);
       return dbInstance;
    }

    // 2. Try Local File Paths
    const possiblePaths = [
      path.join(process.cwd(), "firebase-applet-config.json"),
      path.join(_dirname, "firebase-applet-config.json"),
      path.join(_dirname, "..", "firebase-applet-config.json")
    ];
    
    let configPath = "";
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        configPath = p;
        break;
      }
    }

    if (configPath) {
      console.log("[Firebase] Initializing from file:", configPath);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      firebaseApp = initializeApp(config);
      const dbId = config.firestoreDatabaseId === "(default)" ? undefined : config.firestoreDatabaseId;
      dbInstance = getFirestore(firebaseApp, dbId);
      return dbInstance;
    } else {
      console.error("[Firebase] CRITICAL: No config found. Set FIREBASE_CONFIG_JSON env var or provide config file.");
    }
  } catch (error) {
    console.error("[Firebase] Initialization failed:", error);
  }
  return null;
};

// Initialize early
initializeFirebase();

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Global Error]", err);
  if (!res.headersSent) {
    res.status(500).json({ 
      error: "Internal Server Error", 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

export { app };

const PORT = Number(process.env.PORT) || 3000;

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
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

  app.get("/api/health", async (req, res) => {
    let dbStatus = "Checking...";
    let writeTest = "Skipped";
    try {
      if (!dbInstance) {
        dbStatus = "Undefined - Initialization failed";
      } else {
        await setDoc(doc(dbInstance, 'health_test', 'ping'), { lastPing: new Date().toISOString() });
        dbStatus = "Connected & Writing";
        writeTest = "Success";
      }
    } catch (err: any) {
      dbStatus = "Error: " + err.message;
    }

    res.json({ 
      status: "ok", 
      time: new Date().toISOString(), 
      databaseStatus: dbStatus,
      writeTest: writeTest
    });
  });

  // Initialize Firestore Helpers (Updated for Client SDK)
  const seedInitialData = async () => {
    try {
      const db = initializeFirebase();
      if (!db) return;
      
      console.log("[Seeding] Starting check...");
      const masterDoc = await getDoc(doc(db, 'master_store', 'dropdowns'));
      if (!masterDoc.exists()) {
        console.log("[Seeding] Populating master_store...");
        await setDoc(doc(db, 'master_store', 'dropdowns'), {
          shifts: ['A', 'B', 'C'],
          productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
          uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
          materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
          inlinePrintOptions: ['Yes', 'No'],
          years: ['2023', '2024', '2025', '2026', '2027']
        });
      }

      const machineSnapshot = await getDocs(query(collection(db, 'machines'), limit(1)));
      if (machineSnapshot.empty) {
        console.log("[Seeding] Populating machines collection...");
        const initialMachines = [
          { id: "Ext-02-LD800", type: "LD800", target: 5000, status: "Running", reason: "" },
          { id: "Ext-03-LD800", type: "LD800", target: 5000, status: "Running", reason: "" },
          { id: "Ext-04-LD800", type: "LD800", target: 5000, status: "Running", reason: "" },
          { id: "Ext-05-LD800", type: "LD800", target: 5000, status: "Running", reason: "" },
          { id: "Ext-06-LD800", type: "LD800", target: 5000, status: "Idle", reason: "Wait for Material" },
          { id: "Ext-07-PPE1000", type: "PPE1000", target: 4500, status: "Running", reason: "" },
          { id: "Ext-08-PPE800", type: "PPE800", target: 4000, status: "Breakdown", reason: "Motor Issue" },
          { id: "Ext-09-LD1400", type: "LD1400", target: 6000, status: "Running", reason: "" },
          { id: "Ext-10-LD1400", type: "LD1400", target: 6000, status: "Running", reason: "" },
          { id: "Ext-11-LD1000", type: "LD1000", target: 5500, status: "Running", reason: "" },
          { id: "Ext-12-LD1000", type: "LD1000", target: 5500, status: "Running", reason: "" },
          { id: "Ext-13-LD1000", type: "LD1000", target: 5500, status: "Idle", reason: "Cleaning" },
          { id: "Ext-14-LD1000", type: "LD1000", target: 5500, status: "Running", reason: "" },
          { id: "Ext-15-LD1000", type: "LD1000", target: 5500, status: "Running", reason: "" },
          { id: "Ext-16-LD1000", type: "LD1000", target: 5500, status: "Running", reason: "" },
          { id: "Ext-17-LD1000", type: "LD1000", target: 5500, status: "Running", reason: "" },
          { id: "Ext-18-LD2000", type: "LD2000", target: 8000, status: "Running", reason: "" },
          { id: "Ext-19-LD801", type: "LD801", target: 5000, status: "Running", reason: "" },
          { id: "Zipper-01", type: "Zipper", target: 3000, status: "Running", reason: "" },
        ];
        const batch = writeBatch(db);
        for (const m of initialMachines) {
          batch.set(doc(db, 'machines', m.id), m);
        }
        await batch.commit();
      }

      const operatorSnapshot = await getDocs(query(collection(db, 'operators'), limit(1)));
      if (operatorSnapshot.empty) {
        console.log("[Seeding] Populating operators collection...");
        const initialOperators = [
          { id: "1", name: "Md. Shahid Hossain", email: "shahidmainetti@gmail.com" },
          { id: "14", name: "Md. Layes Ali", email: "mdlayeshossain5@gmail.com" },
          { id: "110", name: "Md. Rabiul Islam", email: "mdrobilislam19@gmail.com" },
        ];
        const batch = writeBatch(db);
        for (const o of initialOperators) {
          batch.set(doc(db, 'operators', o.id), o);
        }
        await batch.commit();
      }
      console.log("[Seeding] Database check completed.");
    } catch (error: any) {
      console.error("[Seeding] Error:", error.message);
    }
  };

// Seed manually via /api/debug/seed if needed
// seedInitialData();

  const getRollSettings = async () => {
    const db = initializeFirebase();
    const d = await getDoc(doc(db, 'app_config', 'roll_settings'));
    return d.data() || { LAST_ROLL_NO: 17413, PREFIX: "R", CURRENT_YEAR: "26" };
  };

  const getMasterStore = async () => {
    const db = initializeFirebase();
    const d = await getDoc(doc(db, 'master_store', 'dropdowns'));
    return d.data() || {
      shifts: ['A', 'B', 'C'],
      productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
      uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
      materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
      inlinePrintOptions: ['Yes', 'No'],
      years: ['2023', '2024', '2025', '2026', '2027']
    };
  };

  const getMachines = async () => {
    const db = initializeFirebase();
    const s = await getDocs(collection(db, 'machines'));
    return s.docs.map(d => d.data());
  };

  const getOperators = async () => {
    const db = initializeFirebase();
    const s = await getDocs(collection(db, 'operators'));
    return s.docs.map(d => d.data());
  };

  const syncProductionRecords = async () => {
    const db = initializeFirebase();
    const s = await getDocs(query(collection(db, 'production_records'), orderBy('EntryTimestamp', 'asc')));
    return s.docs.map(d => d.data());
  };

  const PRODUCTION_COLUMNS = [
  "Roll ID", "Production Date", "Shift", "Production Type", "Operator ID", 
  "Machine no", "Year", "PI NUMBER", "Tube Size", "UOM", "Material", 
  "Micron", "InLine Print", "Finished Meter", "Finished Kgs", "Roll Location", 
  "Data Update Time", "Fingerprint", "Entered By", "Operator Name", 
  "Scrap Kgs", "Production Year", "Production Month"
];

const MACHINE_COLUMNS = ["Machine ID", "Type", "Target (KG)", "Status", "Last Reason"];
const OPERATOR_COLUMNS = ["Operator ID", "Full Name", "Email Address"];
const CONFIG_COLUMNS = ["Category", "Options"];

const safeHandler = (fn: (req: any, res: any) => Promise<void>) => async (req: any, res: any, next: any) => {
  try {
    const db = initializeFirebase();
    if (!db && !req.path.includes('/health') && !req.path.includes('/debug')) {
      throw new Error("Database initialization failed. Check server logs.");
    }
    await fn(req, res);
  } catch (err: any) {
    console.error(`[Route Error] ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
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
      const maxInDb = Math.max(...rollNums);
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
      const maxInDb = Math.max(...rollNums);
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

(async () => {
  // Vite middleware for development - skip in Vercel environment where static is handled differently
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
})();
