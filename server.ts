import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import admin from "firebase-admin";

import { getFirestore } from "firebase-admin/firestore";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize Firebase Admin inside startServer for better error isolation
  let databaseId: string | undefined;
  let dbInstance: any;

  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      databaseId = config.firestoreDatabaseId;
      if (!admin.apps.length) {
        admin.initializeApp({
          projectId: config.projectId,
        });
      }
      console.log("[Firebase] Config loaded. Project:", config.projectId, "Database:", databaseId);
    } else {
      console.warn("[Firebase] No config file found, using environment defaults");
      if (!admin.apps.length) admin.initializeApp();
    }
    
    // In many environments, using the default database is safer if the named one fails
    try {
      dbInstance = getFirestore(databaseId || "(default)");
      // Test the connection immediately
      await dbInstance.collection('health_test').doc('ping').set({ lastPing: new Date().toISOString() });
      console.log("[Firebase] Database connection successful to:", databaseId || "(default)");
    } catch (testError) {
      console.error("[Firebase] Failed to connect to specific database, trying default...");
      dbInstance = getFirestore();
      await dbInstance.collection('health_test').doc('ping').set({ lastPing: new Date().toISOString() });
      console.log("[Firebase] Database connection successful to default database");
    }
  } catch (error) {
    console.error("[Firebase] Initialization failed:", error);
  }

  // Global Error Handler to prevent process crashes
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Global Error]", err);
    res.status(500).json({ error: "Internal Server Error", message: err.message });
  });

  // API routes
  app.get("/api/health", async (req, res) => {
    let dbStatus = "Checking...";
    let writeTest = "Skipped";
    try {
      if (!dbInstance) {
        dbStatus = "Undefined - Initialization failed";
      } else {
        await dbInstance.collection('health_test').doc('ping').set({ lastPing: new Date().toISOString() });
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
      writeTest: writeTest,
      projectId: admin.apps[0]?.options.projectId || "unknown",
      databaseId: databaseId || "default"
    });
  });

  // Firestore Helpers
  const seedInitialData = async () => {
    try {
      if (!dbInstance) {
        console.error("[Seeding] Cannot seed: dbInstance is undefined");
        return;
      }
      
      console.log("[Seeding] Starting initial data population...");
      const masterDoc = await dbInstance.collection('master_store').doc('dropdowns').get();
      if (!masterDoc.exists) {
        console.log("[Seeding] Populating master_store...");
        await dbInstance.collection('master_store').doc('dropdowns').set({
          shifts: ['A', 'B', 'C'],
          productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
          uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
          materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
          inlinePrintOptions: ['Yes', 'No'],
          years: ['2024', '2025', '2026', '2027']
        });
      }

      const machineSnapshot = await dbInstance.collection('machines').limit(1).get();
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
        const batch = dbInstance.batch();
        for (const m of initialMachines) {
          batch.set(dbInstance.collection('machines').doc(m.id), m);
        }
        await batch.commit();
      }

      const operatorSnapshot = await dbInstance.collection('operators').limit(1).get();
      if (operatorSnapshot.empty) {
        console.log("[Seeding] Populating operators collection...");
        const initialOperators = [
          { id: "1", name: "Md. Shahid Hossain", email: "shahidmainetti@gmail.com" },
          { id: "14", name: "Md. Layes Ali", email: "mdlayeshossain5@gmail.com" },
          { id: "110", name: "Md. Rabiul Islam", email: "mdrobilislam19@gmail.com" },
        ];
        const batch = dbInstance.batch();
        for (const o of initialOperators) {
          batch.set(dbInstance.collection('operators').doc(o.id), o);
        }
        await batch.commit();
      }
      console.log("[Seeding] Initial data check completed successfully.");
    } catch (error: any) {
      console.error("[Seeding] FATAL ERROR during seeding:", error.message);
    }
  };

  // Seed initial data asynchronously without blocking startup
  seedInitialData();

  const getAppConfig = async () => {
    const doc = await dbInstance.collection('app_config').doc('sheet').get();
    return doc.data() || { spreadsheetId: null };
  };

  const getRollSettings = async () => {
    const doc = await dbInstance.collection('app_config').doc('roll_settings').get();
    return doc.data() || { LAST_ROLL_NO: 17413, PREFIX: "R", CURRENT_YEAR: "26" };
  };

  const getMasterStore = async () => {
    const doc = await dbInstance.collection('master_store').doc('dropdowns').get();
    return doc.data() || {
      shifts: ['A', 'B', 'C'],
      productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
      uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
      materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
      inlinePrintOptions: ['Yes', 'No'],
      years: ['2024', '2025', '2026', '2027']
    };
  };

  const getMachines = async () => {
    const snapshot = await dbInstance.collection('machines').get();
    if (snapshot.empty) return [];
    return snapshot.docs.map((doc: any) => doc.data());
  };

  const getOperators = async () => {
    const snapshot = await dbInstance.collection('operators').get();
    if (snapshot.empty) return [];
    return snapshot.docs.map((doc: any) => doc.data());
  };

  const syncProductionRecords = async () => {
    if (!dbInstance) throw new Error("Database not initialized");
    const snapshot = await dbInstance.collection('production_records').orderBy('EntryTimestamp', 'asc').get();
    return snapshot.docs.map((doc: any) => doc.data());
  };

  // Google Sheets Helper
  const getSheetsClient = (accessToken: string) => {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.sheets({ version: "v4", auth });
  };

  const getDriveClient = (accessToken: string) => {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: "v3", auth });
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
      await fn(req, res);
    } catch (err: any) {
      console.error("[Route Error]", err);
      res.status(500).json({ error: err.message });
    }
  };

  app.get("/api/sheets/config", safeHandler(async (req, res) => {
    const config = await getAppConfig();
    res.json({ spreadsheetId: config.spreadsheetId });
  }));

  app.post("/api/sheets/init", safeHandler(async (req, res) => {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(401).json({ error: "No access token" });

    const drive = getDriveClient(accessToken);
    const sheets = getSheetsClient(accessToken);
    const sheetName = "Master Production Record";

    // Search for existing sheet with this name
    const searchResponse = await drive.files.list({
      q: `name = '${sheetName}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
      fields: "files(id, name)",
      spaces: "drive"
    });

    const existingFile = searchResponse.data.files?.[0];
    let currentSpreadsheetId = existingFile?.id || null;

    if (!currentSpreadsheetId) {
      // Create new spreadsheet if not found
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: sheetName },
          sheets: [
            { properties: { title: "Records" } },
            { properties: { title: "Machines" } },
            { properties: { title: "Operators" } },
            { properties: { title: "Dropdown_Config" } }
          ]
        }
      });
      currentSpreadsheetId = createResponse.data.spreadsheetId || null;

      if (currentSpreadsheetId) {
        // Initialize Headers
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: currentSpreadsheetId,
          requestBody: {
            valueInputOption: "RAW",
            data: [
              { range: "Records!A1", values: [PRODUCTION_COLUMNS] },
              { range: "Machines!A1", values: [MACHINE_COLUMNS] },
              { range: "Operators!A1", values: [OPERATOR_COLUMNS] },
              { range: "Dropdown_Config!A1", values: [CONFIG_COLUMNS] }
            ]
          }
        });
      }
    }

    if (currentSpreadsheetId) {
      await dbInstance.collection('app_config').doc('sheet').set({ spreadsheetId: currentSpreadsheetId });
    }

    res.json({ spreadsheetId: currentSpreadsheetId, message: existingFile ? "Connected to existing sheet" : "New sheet created and initialized" });
  }));

  app.post("/api/sheets/sync-all", safeHandler(async (req, res) => {
    const { accessToken } = req.body;
    const config = await getAppConfig();
    const spreadsheetId = config.spreadsheetId;

    if (!accessToken) return res.status(401).json({ error: "No access token" });
    if (!spreadsheetId) return res.status(400).json({ error: "No sheet initialized" });

    const sheets = getSheetsClient(accessToken);
    const masterData = await syncProductionRecords();
    
    const values = masterData.map((entry: any) => [
      entry.RollID, entry.ProductionDate, entry.Shift, entry.ProductionType, entry.OperatorID,
      entry.MachineNo, entry.Year, entry.PINumber, entry.TubeSize, entry.UOM, entry.Material,
      entry.Micron, entry.InLinePrint, entry.FinishedMeter, entry.FinishedKgs, entry.RollLocation,
      entry.DataUpdateTime, entry.Fingerprint, entry.EnteredBy, entry.OperatorName,
      entry.ScrapKgs, entry.ProductionYear, entry.ProductionMonth
    ]);

    // Clear existing and rewrite
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Records!A2:Z10000" });
    
    if (values.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Records!A2",
        valueInputOption: "RAW",
        requestBody: { values }
      });
    }

    res.json({ message: "Full sync completed" });
  }));

  app.post("/api/sheets/sync-master", safeHandler(async (req, res) => {
    const { accessToken } = req.body;
    const config = await getAppConfig();
    const spreadsheetId = config.spreadsheetId;

    if (!accessToken) return res.status(401).json({ error: "No access token" });
    if (!spreadsheetId) return res.status(400).json({ error: "No sheet initialized" });

    const sheets = getSheetsClient(accessToken);
    const machineMaster = await getMachines();
    const operatorMaster = await getOperators();
    const masterStore = await getMasterStore();

    // Verify tabs exist, create if missing
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = spreadsheet.data.sheets?.map(s => s.properties?.title) || [];
    const requiredTabs = ["Machines", "Operators", "Dropdown_Config"];
    const missingTabs = requiredTabs.filter(t => !existingTitles.includes(t));

    if (missingTabs.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: missingTabs.map(title => ({
            addSheet: { properties: { title } }
          }))
        }
      });
    }

    // Prepare Data
    const machineValues = machineMaster.map((m: any) => [m.id, m.type, m.target, m.status, m.reason]);
    const operatorValues = operatorMaster.map((o: any) => [o.id, o.name, o.email]);
    const configValues = [
      ["Shifts", (masterStore as any).shifts.join(", ")],
      ["Production Types", (masterStore as any).productionTypes.join(", ")],
      ["UOMs", (masterStore as any).uoms.join(", ")],
      ["Materials", (masterStore as any).materials.join(", ")],
      ["Inline Print", (masterStore as any).inlinePrintOptions.join(", ")],
      ["Years", (masterStore as any).years.join(", ")]
    ];

    // Perform updates
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: "Machines!A1", values: [MACHINE_COLUMNS, ...machineValues] },
          { range: "Operators!A1", values: [OPERATOR_COLUMNS, ...operatorValues] },
          { range: "Dropdown_Config!A1", values: [CONFIG_COLUMNS, ...configValues] }
        ]
      }
    });

    res.json({ message: "Master Data synced successfully" });
  }));

  // API Routes
  app.get("/api/master-store", safeHandler(async (req, res) => {
    const masterStore = await getMasterStore();
    res.json(masterStore);
  }));

  app.post("/api/master-store", safeHandler(async (req, res) => {
    const masterStore = req.body;
    await dbInstance.collection('master_store').doc('dropdowns').set(masterStore);
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
    const { id, name, email } = req.body;
    if (!id || !name) {
      return res.status(400).json({ message: "ID and Name are required" });
    }
    const operator = { id, name, email: email || "" };
    await dbInstance.collection('operators').doc(id).set(operator);
    res.json({ message: "Operator saved successfully", operator });
  }));

  app.get("/api/machines", safeHandler(async (req, res) => {
    const machineMaster = await getMachines();
    res.json(machineMaster);
  }));

  app.post("/api/machines", safeHandler(async (req, res) => {
    const { id, type, target } = req.body;
    if (!id || !type) {
      return res.status(400).json({ message: "ID and Type are required" });
    }
    
    const doc = await dbInstance.collection('machines').doc(id).get();
    if (doc.exists) {
      return res.status(400).json({ message: "Machine ID already exists" });
    }

    const newMachine = {
      id,
      type,
      target: Number(target) || 0,
      status: "Idle",
      reason: "Initial Setup"
    };
    await dbInstance.collection('machines').doc(id).set(newMachine);
    res.json({ message: "Machine created successfully", machine: newMachine });
  }));

  app.post("/api/machines/status", safeHandler(async (req, res) => {
    const { id, status, reason, target } = req.body;
    const docRef = dbInstance.collection('machines').doc(id);
    const doc = await docRef.get();
    if (doc.exists) {
      const updates: any = {};
      if (status) updates.status = status;
      if (reason !== undefined) updates.reason = reason;
      if (target) updates.target = target;
      await docRef.update(updates);
      const updated = await docRef.get();
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
    const entry = req.body;
    
    // Auto-generate unique Roll ID on server
    const newRollId = await calculateNextRollId();
    
    // Update settings.LAST_ROLL_NO to keep it in sync
    const parts = newRollId.split('-');
    if (parts.length === 3) {
      const newLastNo = parseInt(parts[1]);
      await dbInstance.collection('app_config').doc('roll_settings').set({ LAST_ROLL_NO: newLastNo, PREFIX: parts[0], CURRENT_YEAR: parts[2] }, { merge: true });
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
    
    const recordRef = await dbInstance.collection('production_records').add(newEntry);

    // Sync to Sheet if token is present
    const accessToken = req.headers["x-google-access-token"] as string;
    const config = await getAppConfig();
    const spreadsheetId = config.spreadsheetId;
    let syncStatus = 'skipped';
    
    if (accessToken && spreadsheetId) {
      try {
        const sheets = getSheetsClient(accessToken);
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Records!A1",
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: {
            values: [[
              newEntry.RollID, newEntry.ProductionDate, newEntry.Shift, newEntry.ProductionType, newEntry.OperatorID,
              newEntry.MachineNo, newEntry.Year, newEntry.PINumber, newEntry.TubeSize, newEntry.UOM, newEntry.Material,
              newEntry.Micron, newEntry.InLinePrint, newEntry.FinishedMeter, newEntry.FinishedKgs, newEntry.RollLocation,
              newEntry.DataUpdateTime, newEntry.Fingerprint, newEntry.EnteredBy, newEntry.OperatorName,
              newEntry.ScrapKgs, newEntry.ProductionYear, newEntry.ProductionMonth
            ]]
          }
        });
        syncStatus = 'success';
        await recordRef.update({ syncStatus: 'success' });
      } catch (err: any) {
        console.error("[Sync] Auto Sync Error:", err.message);
        syncStatus = 'error';
        await recordRef.update({ syncStatus: 'error' });
      }
    } else {
      await recordRef.update({ syncStatus: 'skipped' });
    }

    res.status(201).json({ 
      message: "Production Entry Saved Successfully", 
      entry: { ...newEntry, syncStatus },
      syncStatus 
    });
  }));

  app.get("/api/dashboard", safeHandler(async (req, res) => {
    const machineMaster = await getMachines();
    const masterData = await syncProductionRecords();

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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
