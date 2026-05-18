import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";

const CONFIG_PATH = path.join(process.cwd(), "sheet-config.json");

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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

  let spreadsheetId: string | null = null;
  // Load persisted config
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      spreadsheetId = config.spreadsheetId;
    } catch (e) {
      console.error("Failed to load sheet config", e);
    }
  }

  app.get("/api/sheets/config", (req, res) => {
    res.json({ spreadsheetId });
  });

  app.post("/api/sheets/init", async (req, res) => {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(401).json({ error: "No access token" });

    try {
      const drive = getDriveClient(accessToken);
      const sheets = getSheetsClient(accessToken);
      const sheetName = "Master Production Record";

      // 1. Search for existing sheet with this name
      const searchResponse = await drive.files.list({
        q: `name = '${sheetName}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
        fields: "files(id, name)",
        spaces: "drive"
      });

      const existingFile = searchResponse.data.files?.[0];

      if (existingFile?.id) {
        spreadsheetId = existingFile.id;
      } else {
        // 2. Create new spreadsheet if not found
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
        spreadsheetId = createResponse.data.spreadsheetId || null;

        if (spreadsheetId) {
          // Initialize Headers
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
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

      if (spreadsheetId) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({ spreadsheetId }));
      }

      res.json({ spreadsheetId, message: existingFile ? "Connected to existing sheet" : "New sheet created and initialized" });
    } catch (err: any) {
      console.error("Sheets Init Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Master Data Store for Dropdowns
  let masterStore = {
    shifts: ['A', 'B', 'C'],
    productionTypes: ['Commercial', 'R&D', 'Trial', 'Sample'],
    uoms: ['Kgs', 'Rolls', 'Meter', 'INCH'],
    materials: ['LDPE', 'HDPE', 'LLDPE', 'PP', 'BOPP'],
    inlinePrintOptions: ['Yes', 'No'],
    years: ['2024', '2025', '2026', '2027']
  };

  app.post("/api/sheets/sync-all", async (req, res) => {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(401).json({ error: "No access token" });
    if (!spreadsheetId) return res.status(400).json({ error: "No sheet initialized" });

    try {
      const sheets = getSheetsClient(accessToken);
      
      const values = masterData.map(entry => [
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sheets/sync-master", async (req, res) => {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(401).json({ error: "No access token" });
    if (!spreadsheetId) return res.status(400).json({ error: "No sheet initialized" });

    try {
      const sheets = getSheetsClient(accessToken);
      const drive = getDriveClient(accessToken);

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
      const machineValues = machineMaster.map(m => [m.id, m.type, m.target, m.status, m.reason]);
      const operatorValues = operatorMaster.map(o => [o.id, o.name, o.email]);
      const configValues = [
        ["Shifts", masterStore.shifts.join(", ")],
        ["Production Types", masterStore.productionTypes.join(", ")],
        ["UOMs", masterStore.uoms.join(", ")],
        ["Materials", masterStore.materials.join(", ")],
        ["Inline Print", masterStore.inlinePrintOptions.join(", ")],
        ["Years", masterStore.years.join(", ")]
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
    } catch (err: any) {
      console.error("Master Sync Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API Routes
  app.get("/api/master-store", (req, res) => {
    res.json(masterStore);
  });

  app.post("/api/master-store", (req, res) => {
    masterStore = req.body;
    res.json({ message: "Master Store updated successfully", masterStore });
  });

  // Mock MASTER_DATA
  let masterData: any[] = [];
  let settings = {
    LAST_ROLL_NO: 17413,
    PREFIX: "R",
    CURRENT_YEAR: "26"
  };

  const calculateNextRollId = () => {
    // Determine last roll no from masterData if it's more current than settings
    let lastNo = settings.LAST_ROLL_NO;
    if (masterData.length > 0) {
      const rollNums = masterData.map(d => {
        if (typeof d.RollID === 'string') {
          const parts = d.RollID.split('-');
          if (parts.length === 3) return parseInt(parts[1]);
        }
        return 0;
      });
      const maxInDb = Math.max(...rollNums);
      if (maxInDb > lastNo) lastNo = maxInDb;
    }
    return `${settings.PREFIX}-${lastNo + 1}-${settings.CURRENT_YEAR}`;
  };

  // Machine Master State
  let machineMaster = [
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

  // Operator Master State
  let operatorMaster = [
    { id: "1", name: "Md. Shahid Hossain", email: "shahidmainetti@gmail.com" },
    { id: "14", name: "Md. Layes Ali", email: "mdlayeshossain5@gmail.com" },
    { id: "63", name: "Jagoron Chandra Ray", email: "" },
    { id: "82", name: "Md.Mizanur Rahman", email: "" },
    { id: "110", name: "Md. Rabiul Islam", email: "mdrobilislam19@gmail.com" },
    { id: "111", name: "Md. Millat Hossain", email: "" },
    { id: "172", name: "Abdul Mannan Khan", email: "" },
    { id: "237", name: "Md. Shakil Ahmed", email: "" },
    { id: "280", name: "Md. Ruhul Amin", email: "" },
    { id: "283", name: "Billal Hossain", email: "" },
    { id: "303", name: "Ariful Islam", email: "" },
    { id: "326", name: "Md. Abu Saeed", email: "" },
    { id: "366", name: "Md. Rakib Sikder", email: "" },
    { id: "384", name: "Shohel Rana", email: "" },
    { id: "462", name: "Md. Juel Rana", email: "" },
    { id: "464", name: "Ajid Robidas", email: "" },
    { id: "484", name: "Mominur Islam", email: "" },
    { id: "485", name: "Md. Emran Hasan", email: "" },
  ];

  app.get("/api/operators", (req, res) => {
    res.json(operatorMaster);
  });

  app.post("/api/operators", (req, res) => {
    const { id, name, email } = req.body;
    if (!id || !name) {
      return res.status(400).json({ message: "ID and Name are required" });
    }
    const idx = operatorMaster.findIndex(o => o.id === id);
    if (idx !== -1) {
      operatorMaster[idx] = { id, name, email: email || "" };
      return res.json({ message: "Operator updated successfully", operator: operatorMaster[idx] });
    }
    const newOperator = { id, name, email: email || "" };
    operatorMaster.push(newOperator);
    res.json({ message: "Operator created successfully", operator: newOperator });
  });

  app.get("/api/machines", (req, res) => {
    res.json(machineMaster);
  });

  app.post("/api/machines", (req, res) => {
    const { id, type, target } = req.body;
    if (!id || !type) {
      return res.status(400).json({ message: "ID and Type are required" });
    }
    const exists = machineMaster.find(m => m.id === id);
    if (exists) {
      return res.status(400).json({ message: "Machine ID already exists" });
    }
    const newMachine = {
      id,
      type,
      target: Number(target) || 0,
      status: "Idle",
      reason: "Initial Setup"
    };
    machineMaster.push(newMachine);
    res.json({ message: "Machine created successfully", machine: newMachine });
  });

  app.post("/api/machines/status", (req, res) => {
    const { id, status, reason, target } = req.body;
    const machine = machineMaster.find(m => m.id === id);
    if (machine) {
      if (status) machine.status = status;
      if (reason !== undefined) machine.reason = reason;
      if (target) machine.target = target;
      res.json({ message: "Machine updated successfully", machine });
    } else {
      res.status(404).json({ message: "Machine not found" });
    }
  });

  app.get("/api/settings", (req, res) => {
    res.json(settings);
  });

  app.get("/api/next-roll-id", (req, res) => {
    res.json({ nextId: calculateNextRollId() });
  });

  app.get("/api/previous-roll-id", (req, res) => {
    let lastNo = settings.LAST_ROLL_NO;
    if (masterData.length > 0) {
      const rollNums = masterData.map(d => {
        if (typeof d.RollID === 'string') {
          const parts = d.RollID.split('-');
          if (parts.length === 3) return parseInt(parts[1]);
        }
        return 0;
      });
      const maxInDb = Math.max(...rollNums);
      if (maxInDb > lastNo) lastNo = maxInDb;
    }
    const previousId = `${settings.PREFIX}-${lastNo}-${settings.CURRENT_YEAR}`;
    res.json({ previousId });
  });

  app.get("/api/production", (req, res) => {
    res.json(masterData);
  });

  app.post("/api/production", async (req, res) => {
    const entry = req.body;
    
    // Auto-generate unique Roll ID on server
    const newRollId = calculateNextRollId();
    
    // Update settings.LAST_ROLL_NO to keep it in sync
    const parts = newRollId.split('-');
    if (parts.length === 3) {
      settings.LAST_ROLL_NO = parseInt(parts[1]);
    }
    
    const date = new Date(entry.ProductionDate || new Date());
    const newEntry = {
      ...entry,
      SL: masterData.length + 1,
      RollID: newRollId,
      EntryTimestamp: new Date().toISOString(),
      DataUpdateTime: new Date().toLocaleString(),
      Fingerprint: Math.random().toString(36).substring(2, 10).toUpperCase(),
      EnteredBy: "Plant Admin", // Default system user
      ProductionYear: date.getFullYear().toString(),
      ProductionMonth: date.toLocaleString('default', { month: 'long' })
    };
    
    masterData.push(newEntry);

    // Sync to Sheet if token is present
    const accessToken = req.headers["x-google-access-token"] as string;
    let syncStatus = 'skipped';
    
    if (accessToken && spreadsheetId) {
      try {
        console.log(`[Sync] Attempting to append entry ${newEntry.RollID} to sheet ${spreadsheetId}`);
        const sheets = getSheetsClient(accessToken);
        const appendResponse = await sheets.spreadsheets.values.append({
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
        console.log(`[Sync] Successfully appended to sheet. Row: ${appendResponse.data.updates?.updatedRange}`);
        syncStatus = 'success';
        (newEntry as any).syncStatus = 'success';
      } catch (err: any) {
        console.error("[Sync] Auto Sync Error:", err.message);
        syncStatus = 'error';
        (newEntry as any).syncStatus = 'error';
      }
    } else {
      console.log(`[Sync] Skipped sync for ${newEntry.RollID}. Token: ${!!accessToken}, SheetID: ${!!spreadsheetId}`);
      (newEntry as any).syncStatus = 'skipped';
    }

    res.status(201).json({ 
      message: "Production Entry Saved Successfully", 
      entry: newEntry,
      syncStatus 
    });
  });

  app.get("/api/dashboard", (req, res) => {
    // Machine Summary Calculation
    const summary = machineMaster.map(m => {
      const machineProduction = masterData.filter(d => d.MachineNo === m.id);
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
  });

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
