import React, { useState, useEffect } from 'react';
import { 
  Factory, 
  BarChart3, 
  Settings, 
  Users, 
  LayoutDashboard, 
  PlusCircle, 
  History,
  AlertCircle,
  Clock,
  TrendingUp,
  Package,
  Layers,
  Container,
  User as UserIcon,
  Hash,
  Ruler,
  Weight,
  MapPin,
  Calendar as CalendarIcon,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Box,
  Activity,
  ChevronDown,
  Database,
  RefreshCw,
  LogOut,
  CalendarDays,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from './lib/utils';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');

// Types
interface ProductionEntry {
  ProductionDate: string;
  Shift: string;
  ProductionType: string;
  OperatorID: string;
  MachineNo: string;
  Year: string;
  PINumber: string;
  TubeSize: string;
  UOM: string;
  Material: string;
  Micron: string;
  InLinePrint: string;
  FinishedMeter: string;
  FinishedKgs: string;
  RollLocation: string;
  RollID?: string;
  ScrapKgs: string;
  OperatorName: string;
  MachineStatus: string;
  DataUpdateTime?: string;
  Fingerprint?: string;
  EnteredBy?: string;
  ProductionYear?: string;
  ProductionMonth?: string;
}

interface MachineSummary {
  MachineNo: string;
  TargetKgs: number;
  TotalRolls: number;
  TotalMeter: number;
  TotalProductionKgs: number;
  Status: 'Running' | 'Idle' | 'Breakdown';
  Reason?: string;
  LastUpdate: string;
}

interface MachineMaster {
  id: string;
  type: string;
  target: number;
  status: 'Running' | 'Idle' | 'Breakdown';
  reason: string;
}

interface OperatorMaster {
  id: string;
  name: string;
  email: string;
}

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

// Mock trend data
const trendData = [
  { time: '08:00', prod: 240 },
  { time: '09:00', prod: 310 },
  { time: '10:00', prod: 450 },
  { time: '11:00', prod: 380 },
  { time: '12:00', prod: 520 },
  { time: '13:00', prod: 480 },
  { time: '14:00', prod: 610 },
  { time: '15:00', prod: 720 },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'entry' | 'dashboard' | 'history' | 'machines' | 'master-config' | 'operators' | 'master-production-record'>('dashboard');
  const [formData, setFormData] = useState<ProductionEntry>({
    ProductionDate: formatDate(new Date()),
    Shift: 'A',
    ProductionType: 'Commercial',
    OperatorID: '',
    MachineNo: '',
    Year: '2026',
    PINumber: '',
    TubeSize: '',
    UOM: '',
    Material: '',
    Micron: '',
    InLinePrint: '',
    FinishedMeter: '',
    FinishedKgs: '',
    RollLocation: '',
    ScrapKgs: '',
    OperatorName: '',
    MachineStatus: 'Running'
  });

  const [dashboardData, setDashboardData] = useState<{ summary: MachineSummary[], dailyTotals: any } | null>(null);
  const [machines, setMachines] = useState<MachineMaster[]>([]);
  const [operators, setOperators] = useState<OperatorMaster[]>([]);
  const [productionRecords, setProductionRecords] = useState<ProductionEntry[]>([]);
  const [recentEntries, setRecentEntries] = useState<any[]>([]);
  const [nextRollId, setNextRollId] = useState<string>('');
  const [previousRollId, setPreviousRollId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [masterStore, setMasterStore] = useState<any>({
    shifts: [],
    productionTypes: [],
    uoms: [],
    materials: [],
    inlinePrintOptions: [],
    years: []
  });

  const [modalConfig, setModalConfig] = useState<{ isOpen: boolean, type: string, title: string } | null>(null);
  const [newMasterItem, setNewMasterItem] = useState("");
  
  // Auth & Sheets State
  const [user, setUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(sessionStorage.getItem('google_access_token'));
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    fetchSheetConfig();
    return () => unsubscribe();
  }, []);

  const fetchSheetConfig = async () => {
    try {
      const res = await fetch('/api/sheets/config');
      const data = await res.json();
      setSpreadsheetId(data.spreadsheetId);
    } catch (err) {
      console.error("Failed to fetch sheet config", err);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      setGoogleToken(token);
      if (token) {
        sessionStorage.setItem('google_access_token', token);
      }
      showToast("Signed in with Google successfully", 'success');
    } catch (error) {
      console.error("Google Sign In Error:", error);
      showToast("Failed to sign in with Google", 'error');
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      setGoogleToken(null);
      sessionStorage.removeItem('google_access_token');
      showToast("Signed out successfully", 'success');
    } catch (error) {
      showToast("Failed to sign out", 'error');
    }
  };

  const handleInitSheet = async () => {
    if (!googleToken) {
      showToast("Please sign in with Google first", 'error');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/sheets/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: googleToken })
      });
      const data = await res.json();
      if (data.spreadsheetId) {
        setSpreadsheetId(data.spreadsheetId);
        showToast("Google Sheet connected successfully!", 'success');
        // Initial sync of master data
        fetch('/api/sheets/sync-master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: googleToken })
        }).catch(e => console.error("Initial master sync failed", e));
      }
    } catch (err) {
      showToast("Failed to connect sheet", 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFullSync = async () => {
    if (!googleToken || !spreadsheetId) {
      showToast("Connect to Google Sheets first", 'error');
      return;
    }
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sheets/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: googleToken })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Full database sync completed", 'success');
      } else {
        showToast(data.error || "Sync failed", 'error');
      }
    } catch (err) {
      showToast("Network error during sync", 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncMasterData = async () => {
    if (!googleToken || !spreadsheetId) {
      showToast("Connect to Google Sheets first", 'error');
      return;
    }
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sheets/sync-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: googleToken })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Master tables synced to Cloud successfully!", 'success');
      } else {
        showToast(data.error || "Master Sync Failed", 'error');
      }
    } catch (err) {
      showToast("Network failure", 'error');
    } finally {
      setIsSyncing(false);
    }
  };
  
  const [machineFormData, setMachineFormData] = useState({
    id: '',
    type: '',
    target: ''
  });

  useEffect(() => {
    fetchDashboard();
    fetchMachines();
    fetchOperators();
    fetchRecentEntries();
    fetchProductionRecords();
    fetchNextRollId();
    fetchPreviousRollId();
    fetchMasterStore();
    const interval = setInterval(() => {
      fetchDashboard();
      fetchRecentEntries();
      fetchNextRollId();
      fetchPreviousRollId();
    }, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchMasterStore = async () => {
    try {
      const res = await fetch('/api/master-store');
      const data = await res.json();
      setMasterStore(data);
    } catch (err) {
      console.error("Failed to fetch master store", err);
    }
  };

  const fetchDashboard = async () => {
    try {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      setDashboardData(data);
    } catch (err) {
      console.error("Failed to fetch dashboard", err);
    }
  };

  const fetchRecentEntries = async () => {
    try {
      const res = await fetch('/api/production');
      const data = await res.json();
      // Sort by timestamp descending and take last 3
      const sorted = [...data].sort((a, b) => new Date(b.EntryTimestamp).getTime() - new Date(a.EntryTimestamp).getTime());
      setRecentEntries(sorted.slice(0, 5)); // We can show 3-5
    } catch (err) {
      console.error("Failed to fetch recent entries", err);
    }
  };

  const fetchProductionRecords = async () => {
    try {
      const res = await fetch('/api/production');
      const data = await res.json();
      const sorted = [...data].sort((a, b) => new Date(b.EntryTimestamp).getTime() - new Date(a.EntryTimestamp).getTime());
      setProductionRecords(sorted);
    } catch (err) {
      console.error("Failed to fetch production records", err);
    }
  };

  const fetchNextRollId = async () => {
    try {
      const res = await fetch('/api/next-roll-id');
      const data = await res.json();
      setNextRollId(data.nextId);
    } catch (err) {
      console.error("Failed to fetch next roll id", err);
    }
  };

  const fetchPreviousRollId = async () => {
    try {
      const res = await fetch('/api/previous-roll-id');
      const data = await res.json();
      setPreviousRollId(data.previousId);
    } catch (err) {
      console.error("Failed to fetch previous roll id", err);
    }
  };

  const fetchMachines = async () => {
    try {
      const res = await fetch('/api/machines');
      const data = await res.json();
      setMachines(data);
    } catch (err) {
      console.error("Failed to fetch machines", err);
    }
  };

  const fetchOperators = async () => {
    try {
      const res = await fetch('/api/operators');
      const data = await res.json();
      setOperators(data);
    } catch (err) {
      console.error("Failed to fetch operators", err);
    }
  };

  const updateMachineStatus = async (id: string, updates: Partial<MachineMaster>) => {
    try {
      const res = await fetch('/api/machines/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates })
      });
      if (res.ok) {
        showToast("Machine updated successfully", 'success');
        fetchMachines();
        fetchDashboard();
      }
    } catch (err) {
      showToast("Update failed", 'error');
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    // Auto-fill operator name if OperatorID is changed
    if (name === 'OperatorID') {
      const operator = operators.find(o => o.id === value);
      if (operator) {
        setFormData(prev => ({ 
          ...prev, 
          OperatorID: value,
          OperatorName: operator.name 
        }));
        return;
      }
    }
    
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const isFormValid = formData.OperatorID && 
                      formData.FinishedKgs && 
                      formData.Micron && 
                      formData.TubeSize && 
                      formData.FinishedMeter &&
                      formData.PINumber;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation: Only check mandatory fields visible to user
    const mandatoryFields = [
      'ProductionType', 'OperatorID', 'MachineNo', 'Year', 'PINumber', 
      'TubeSize', 'UOM', 'Material', 'Micron', 'InLinePrint', 
      'FinishedMeter', 'FinishedKgs', 'ScrapKgs', 'RollLocation'
    ];
    
    const isAnyFieldBlank = mandatoryFields.some(key => {
      const val = (formData as any)[key];
      return val === undefined || val === null || val === '';
    });

    if (isAnyFieldBlank) {
      showToast("Please complete all required fields before transmitting data.", 'error');
      return;
    }

    setIsLoading(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (googleToken) {
        headers['x-google-access-token'] = googleToken;
      }

      const res = await fetch('/api/production', {
        method: 'POST',
        headers,
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (res.ok) {
        if (data.syncStatus === 'success') {
          showToast("Entry saved & synced to Google Sheets!", 'success');
        } else if (data.syncStatus === 'error') {
          showToast("Entry saved locally, but Cloud sync failed.", 'error');
        } else {
          showToast("Production Entry Saved Successfully", 'success');
        }
        
        fetchDashboard();
        fetchRecentEntries();
        fetchNextRollId();
        fetchPreviousRollId();
        // Reset form but keep shift/date/machine as requested
        setFormData(prev => ({
          ...prev,
          PINumber: '',
          FinishedMeter: '',
          FinishedKgs: '',
          ScrapKgs: '',
          RollID: '',
          RollLocation: '',
          MachineNo: '',
          UOM: '',
          Material: '',
          InLinePrint: ''
        }));
      } else {
        showToast(data.message || "Error saving entry", 'error');
      }
    } catch (err) {
      showToast("Network error", 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex text-slate-800 industrial-grid">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-brand-border flex flex-col z-20 overflow-hidden sticky top-0 h-screen sidebar-glow">
        <div className="p-6 border-b border-brand-border flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-primary rounded-lg flex items-center justify-center shadow-lg shadow-brand-primary/20 relative">
            <Factory className="text-white" size={20} />
          </div>
          <div>
            <h1 className="font-display font-black text-xl leading-none tracking-tighter text-brand-primary">MAINETTI</h1>
            <p className="text-[8px] text-slate-400 uppercase tracking-[0.3em] font-black mt-1">Industrial Systems</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <SidebarLink 
            icon={<LayoutDashboard size={18} />} 
            label="DASHBOARD" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <SidebarLink 
            icon={<PlusCircle size={18} />} 
            label="ENTRY PORTAL" 
            active={activeTab === 'entry'} 
            onClick={() => setActiveTab('entry')} 
          />
          <SidebarLink 
            icon={<History size={18} />} 
            label="LOGBOOK" 
            active={activeTab === 'history'} 
            onClick={() => setActiveTab('history')} 
          />
          <div className="pt-6 pb-2">
            <p className="px-4 text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">MASTER DATA</p>
            <SidebarLink 
              icon={<Layers size={18} />} 
              label="MACHINES" 
              active={activeTab === 'machines'}
              onClick={() => setActiveTab('machines')}
            />
            <SidebarLink 
              icon={<Settings size={18} />} 
              label="MASTER TABLES" 
              active={activeTab === 'master-config'}
              onClick={() => setActiveTab('master-config')}
            />
            <SidebarLink 
              icon={<Database size={18} />} 
              label="MASTER PRODUCTION RECORD" 
              active={activeTab === 'master-production-record'}
              onClick={() => setActiveTab('master-production-record')}
            />
            <SidebarLink 
              icon={<Users size={18} />} 
              label="OPERATORS" 
              active={activeTab === 'operators'}
              onClick={() => setActiveTab('operators')}
            />
          </div>
        </nav>

        <div className="p-4 border-t border-brand-border space-y-3">
          {user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-50 border border-indigo-100 group transition-all">
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center overflow-hidden border border-indigo-200 shadow-sm">
                  {user.photoURL ? <img src={user.photoURL} alt="avatar" /> : <UserIcon size={16} className="text-indigo-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Connected</p>
                  <p className="text-xs font-bold truncate text-slate-900">{user.displayName || 'User'}</p>
                </div>
              </div>
              <button 
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-black uppercase tracking-widest text-rose-500 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-100"
              >
                <LogOut size={14} />
                Disconnect Cloud
              </button>
            </div>
          ) : (
            <button 
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 p-3 rounded-xl bg-white border border-slate-200 group hover:border-brand-primary/30 transition-all shadow-sm"
            >
              <div className="w-6 h-6 flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">Connect Sheets</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        <header className="h-16 bg-white/90 backdrop-blur-md border-b border-brand-border flex items-center justify-between px-8 sticky top-0 z-10 shadow-sm shadow-slate-100/50">
          <div className="flex items-center gap-5">
            <h2 className="font-display font-black text-xl tracking-tight text-slate-900 uppercase">
              {activeTab === 'dashboard' ? 'Real-Time Operations' : 
               activeTab === 'entry' ? 'Production Entry' : 
               activeTab === 'history' ? 'Operation Logs' : 
               activeTab === 'master-config' ? 'Master Data Table' : 
               activeTab === 'operators' ? 'Operator Management' : 'Asset Registry'}
            </h2>
            <div className="h-4 w-[1px] bg-slate-200" />
            <div className="flex items-center gap-2 text-slate-400 text-[10px] font-mono font-bold uppercase">
              <Clock size={14} className="text-brand-primary" />
              <span className="tracking-widest">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {dashboardData && (
              <div className="hidden xl:flex items-center gap-8">
                <MetricHead label="TOTAL KG" value={`${dashboardData.dailyTotals.totalKgs}`} unit="KG" />
                <MetricHead label="EFFICIENCY" value="94.2" unit="%" color="text-brand-success" />
                <MetricHead label="ACTIVE" value={`${dashboardData.summary.filter(m => m.Status === 'Running').length}/${dashboardData.summary.length}`} unit="NODES" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button className="p-2.5 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-slate-600 transition-all relative group shadow-sm">
                <div className="absolute top-2 right-2 w-1.5 h-1.5 bg-brand-danger rounded-full border border-white" />
                <AlertCircle size={18} />
              </button>
            </div>
          </div>
        </header>

        <section className="flex-1 p-8 overflow-y-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                   <StatCard 
                    title="Shift Production" 
                    value={dashboardData ? `${dashboardData.dailyTotals.totalKgs}` : '--'} 
                    unit="KGS" 
                    trend="+12% from avg" 
                    icon={<TrendingUp className="text-emerald-400" />} 
                  />
                   <StatCard 
                    title="Completed Rolls" 
                    value={dashboardData ? `${dashboardData.dailyTotals.totalRolls}` : '--'} 
                    unit="ROLLS" 
                    trend="Ahead of target" 
                    icon={<Package className="text-blue-400" />} 
                  />
                   <StatCard 
                    title="Total Meterage" 
                    value={dashboardData ? `${dashboardData.dailyTotals.totalMeter}` : '--'} 
                    unit="METER" 
                    trend="Steady run rate" 
                    icon={<Ruler className="text-amber-400" />} 
                  />
                   <StatCard 
                    title="Plant Status" 
                    value="Optimal" 
                    unit="HEALTH" 
                    trend="No major alerts" 
                    icon={<CheckCircle2 className="text-emerald-400" />} 
                  />
                </div>

                {/* Machine Monitoring */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display font-semibold text-lg flex items-center gap-2">
                      <Layers size={20} className="text-slate-400" />
                      Machine-wise Live Summary
                    </h3>
                    <div className="flex gap-2">
                      <StatusLegend color="bg-emerald-500" label="Running" />
                      <StatusLegend color="bg-amber-500" label="Idle" />
                      <StatusLegend color="bg-rose-500" label="Breakdown" />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {dashboardData?.summary.map((machine) => (
                      <MachineCard key={machine.MachineNo} machine={machine} />
                    ))}
                  </div>
                </div>

                {/* Performance Chart */}
                <div className="glass-panel p-6">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="font-display font-semibold text-lg">Production Velocity</h3>
                      <p className="text-slate-500 text-sm">Hourly output across all machines (Kgs)</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500" />
                        <span className="text-xs text-slate-400">Target Output</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                        <span className="text-xs text-slate-400">Actual Production</span>
                      </div>
                    </div>
                  </div>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData}>
                        <defs>
                          <linearGradient id="colorProd" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis 
                          dataKey="time" 
                          stroke="#94a3b8" 
                          fontSize={12} 
                          tickLine={false} 
                          axisLine={false} 
                          dy={10}
                        />
                        <YAxis 
                          stroke="#94a3b8" 
                          fontSize={12} 
                          tickLine={false} 
                          axisLine={false} 
                          tickFormatter={(value) => `${value}kg`}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          itemStyle={{ color: '#0284c7', fontWeight: 'bold' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="prod" 
                          stroke="#0284c7" 
                          strokeWidth={3}
                          fillOpacity={1} 
                          fill="url(#colorProd)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'entry' && (
              <motion.div 
                key="entry"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1500px] mx-auto p-4 lg:p-6"
              >
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                  {/* Left Column: Form */}
                  <div className="xl:col-span-8 glass-panel p-6 border-slate-100">
                    <form onSubmit={handleSubmit} className="space-y-6">
                      {/* Form Header (As per Sch 1) */}
                      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 pb-6 mb-4 gap-6">
                        <div className="flex-1">
                          {spreadsheetId && (
                            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${googleToken ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100 animate-pulse'}`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${googleToken ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                              <span className={`text-[9px] font-black uppercase tracking-widest ${googleToken ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {googleToken ? 'Cloud Sync Active' : 'Cloud Sync Idle - Reconecting...'}
                              </span>
                              {!googleToken && (
                                <button 
                                  onClick={handleGoogleSignIn}
                                  className="ml-2 text-[8px] font-black text-amber-700 underline uppercase tracking-tighter"
                                >
                                  Reconnect
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Moved Inputs: Production Date and Shift */}
                        <div className="flex flex-wrap items-center gap-4 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                          <div className="min-w-[160px]">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">PRODUCTION DATE</label>
                            <div className="relative">
                              <input 
                                type="date" 
                                name="ProductionDate"
                                value={formData.ProductionDate}
                                onChange={handleInputChange}
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all"
                              />
                            </div>
                          </div>
                          <div className="min-w-[100px]">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">SHIFT</label>
                            <select 
                              name="Shift"
                              value={formData.Shift}
                              onChange={handleInputChange}
                              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all appearance-none"
                            >
                              {masterStore.shifts.map((s: string) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="bg-brand-primary/5 border border-brand-primary/10 px-4 py-2 rounded-xl">
                            <p className="text-[10px] text-brand-primary uppercase tracking-widest font-black mb-0.5">PREV_ROLL_ID</p>
                            <p className="font-mono text-base font-black text-brand-primary leading-tight">{previousRollId || '----'}</p>
                          </div>
                        </div>
                      </div>

                      {/* Main Form Body */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
                        <SelectField label="Production Type" name="ProductionType" value={formData.ProductionType} onChange={handleInputChange} options={masterStore.productionTypes} icon={<Package size={14} />} />
                        <div className="relative">
                          <InputField label="Operator ID" name="OperatorID" type="number" value={formData.OperatorID} onChange={handleInputChange} icon={<Hash size={14} />} placeholder="100" required />
                          <div className="hidden">
                            <InputField label="Operator Name" name="OperatorName" value={formData.OperatorName} onChange={handleInputChange} icon={<UserIcon size={14} />} placeholder="Name" />
                          </div>
                        </div>
                        <SelectField label="Machine No" name="MachineNo" value={formData.MachineNo} onChange={handleInputChange} options={machines.map(m => m.id)} icon={<Container size={14} />} placeholder="Select..." />
                        
                        <SelectField label="Year" name="Year" value={formData.Year} onChange={handleInputChange} options={masterStore.years} icon={<CalendarIcon size={14} />} />
                        <InputField label="PI Number" name="PINumber" type="number" value={formData.PINumber} onChange={handleInputChange} icon={<Hash size={14} />} placeholder="#0000" />
                        <InputField label="Tube Size" name="TubeSize" type="number" step="0.01" value={formData.TubeSize} onChange={handleInputChange} icon={<Ruler size={14} />} placeholder="450" />
                        
                        <SelectField label="UOM" name="UOM" value={formData.UOM} onChange={handleInputChange} options={masterStore.uoms} icon={<Ruler size={14} />} placeholder="Select..." />
                        <SelectField label="Raw Material" name="Material" value={formData.Material} onChange={handleInputChange} options={masterStore.materials} icon={<Layers size={14} />} placeholder="Select..." />
                        <InputField label="Micron" name="Micron" type="number" value={formData.Micron} onChange={handleInputChange} icon={<Box size={14} />} placeholder="30" />
                        
                        <SelectField label="In-Line Print" name="InLinePrint" value={formData.InLinePrint} onChange={handleInputChange} options={masterStore.inlinePrintOptions} icon={<CheckCircle2 size={14} />} placeholder="Select..." />
                        <InputField label="Finished Meter" name="FinishedMeter" type="number" value={formData.FinishedMeter} onChange={handleInputChange} icon={<Ruler size={14} />} placeholder="0" />
                        <InputField label="Finished KG" name="FinishedKgs" type="number" step="0.01" value={formData.FinishedKgs} onChange={handleInputChange} icon={<Weight size={14} />} placeholder="0.00" required />
                        
                        <InputField label="Waste (KG)" name="ScrapKgs" type="number" step="0.01" value={formData.ScrapKgs} onChange={handleInputChange} icon={<AlertTriangle size={14} />} placeholder="0.00" />
                        <InputField label="Roll Location" name="RollLocation" value={formData.RollLocation} onChange={handleInputChange} icon={<MapPin size={14} />} placeholder="G-1" />
                        <div />
                      </div>

                      {/* Form Footer */}
                      <div className="flex items-center justify-between pt-6 border-t border-slate-100">
                        <div className="min-h-[60px] flex items-center">
                          <div className="bg-brand-primary/5 border border-brand-primary/10 px-5 py-2.5 rounded-xl">
                            <p className="text-[10px] text-brand-primary uppercase tracking-widest font-black mb-1 leading-none">CURRENT_ROLL_ID</p>
                            <p className="font-mono text-2xl font-black text-brand-primary leading-none">
                              {formData.RollLocation ? nextRollId : '-------'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <button 
                            type="button" 
                            onClick={() => setActiveTab('dashboard')}
                            className="px-6 py-2.5 rounded-xl text-slate-400 hover:text-slate-600 transition-colors text-xs font-black uppercase tracking-[0.2em]"
                          >
                            Cancel
                          </button>
                          <button 
                            type="submit" 
                            disabled={isLoading}
                            className={cn(
                              "px-10 py-3 rounded-xl bg-brand-primary text-white font-black shadow-xl shadow-brand-primary/10 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 flex items-center gap-3 text-xs uppercase tracking-[0.2em]",
                              "disabled:opacity-50 group"
                            )}
                          >
                            {isLoading ? (
                              <div className="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin" />
                            ) : (
                              <>
                                <TrendingUp size={16} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                                Transmit Data
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>

                  {/* Right Column: High-Density Feed */}
                  <div className="xl:col-span-4 space-y-4">
                    <div className="flex items-center justify-between px-1">
                       <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                         <Activity size={14} className="text-brand-primary" />
                         Live Feed
                       </h3>
                       <p className="text-[9px] font-mono text-slate-400">SESSION_SYNC: OK</p>
                    </div>

                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                      {recentEntries.length === 0 ? (
                        <div className="glass-panel p-10 flex flex-col items-center text-center space-y-3 opacity-40">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                            <Clock size={24} />
                          </div>
                          <p className="text-[10px] font-bold uppercase tracking-wider">Awaiting Stream</p>
                        </div>
                      ) : (
                        recentEntries.map((entry, idx) => (
                          <motion.div 
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            key={entry.RollID || idx}
                            className={cn(
                              "glass-panel p-4 border-slate-100 border-l-4 group transition-all",
                              idx === 0 ? "border-l-brand-primary bg-brand-primary/[0.01]" : "border-l-slate-200"
                            )}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-2">
                                <p className="font-mono text-xs font-black text-slate-900 tracking-tighter">{entry.RollID}</p>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">{entry.MachineNo}</span>
                              </div>
                              <p className="text-[10px] font-bold text-brand-primary">{entry.FinishedKgs} kg</p>
                            </div>
                            
                            <div className="flex items-center justify-between opacity-70 group-hover:opacity-100 transition-opacity">
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400">
                                  <UserIcon size={10} />
                                  {entry.OperatorID}
                                </div>
                                <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400">
                                  <Box size={10} />
                                  {entry.Material}
                                </div>
                              </div>
                              <p className="text-[9px] font-mono text-slate-400">{new Date(entry.EntryTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-inner">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp size={14} className="text-emerald-600" />
                        <h4 className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Shift Metrics</h4>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold text-slate-400 uppercase">Yield Sum</p>
                          <p className="text-sm font-mono font-bold text-slate-800">
                            {recentEntries.reduce((acc, curr) => acc + (Number(curr.FinishedKgs) || 0), 0).toFixed(1)}k
                          </p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold text-slate-400 uppercase">Avg Waste</p>
                          <p className="text-sm font-mono font-bold text-rose-600">
                            {(recentEntries.reduce((acc, curr) => acc + (Number(curr.ScrapKgs) || 0), 0) / (recentEntries.length || 1)).toFixed(2)}k
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'master-config' && (
              <motion.div 
                key="master-config"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="space-y-10"
              >
                {/* Reference Tables Section */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                        <BarChart3 size={18} />
                      </div>
                      <h3 className="text-lg font-display font-bold text-slate-900 uppercase tracking-tight">Reference Tables</h3>
                    </div>
                    {spreadsheetId && (
                       <button 
                        onClick={handleSyncMasterData}
                        disabled={isSyncing || !googleToken}
                        className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center gap-2 disabled:opacity-50"
                      >
                        {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
                        Sync All Master to Google Sheets
                      </button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                    {Object.keys(masterStore).map((key) => (
                      <div key={key} className="glass-panel p-6 space-y-4 hover:shadow-lg transition-all duration-300">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest leading-none">{key.replace(/([A-Z])/g, ' $1').trim()}</h3>
                            <button 
                              onClick={() => {
                                setModalConfig({ 
                                  isOpen: true, 
                                  type: key, 
                                  title: `Add ${key.replace(/([A-Z])/g, ' $1').trim()}` 
                                });
                              }}
                              className="p-1 w-6 h-6 flex items-center justify-center rounded-lg bg-brand-primary text-white hover:scale-110 active:scale-95 transition-all shadow-md shadow-brand-primary/20"
                            >
                              <PlusCircle size={14} />
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {masterStore[key].map((item: string, idx: number) => (
                              <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 group hover:border-brand-primary/30 transition-all">
                                  {item}
                                  <button 
                                    onClick={async () => {
                                      const updated = { ...masterStore, [key]: masterStore[key].filter((_: any, i: number) => i !== idx) };
                                      setMasterStore(updated);
                                      await fetch('/api/master-store', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(updated)
                                      });
                                      showToast("Item removed", 'success');
                                    }}
                                    className="text-slate-300 hover:text-rose-500 transition-colors"
                                  >
                                    <XCircle size={12} />
                                  </button>
                              </div>
                            ))}
                          </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Machine Master Entry Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                      <Layers size={18} />
                    </div>
                    <h3 className="text-lg font-display font-bold text-slate-900 uppercase tracking-tight">Machine Master Registry</h3>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                    {/* Add Machine Form */}
                    <div className="xl:col-span-4 glass-panel p-6 border-slate-200 shadow-xl shadow-slate-200/20">
                      <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-3">
                        <PlusCircle size={16} className="text-brand-primary" />
                        <h4 className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Register New Asset</h4>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">MACHINE ID</label>
                          <input 
                            type="text" 
                            placeholder="e.g. Ext-20-LD800"
                            value={machineFormData.id}
                            onChange={(e) => setMachineFormData(prev => ({ ...prev, id: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-brand-primary/5 transition-all"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">MACHINE TYPE</label>
                          <input 
                            type="text" 
                            placeholder="e.g. LD800"
                            value={machineFormData.type}
                            onChange={(e) => setMachineFormData(prev => ({ ...prev, type: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-brand-primary/5 transition-all"
                          />
                        </div>
                        
                        <button 
                          onClick={async () => {
                            if (!machineFormData.id || !machineFormData.type) {
                              showToast("ID and Type are required", 'error');
                              return;
                            }
                            try {
                              const res = await fetch('/api/machines', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(machineFormData)
                              });
                              if (res.ok) {
                                showToast("Machine registered successfully", 'success');
                                setMachineFormData({ id: '', type: '', target: '' });
                                fetchMachines();
                              } else {
                                const err = await res.json();
                                showToast(err.message, 'error');
                              }
                            } catch (err) {
                              showToast("Network error", 'error');
                            }
                          }}
                          className="w-full py-3 bg-brand-primary text-white rounded-xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-brand-primary/20 hover:brightness-110 transition-all flex items-center justify-center gap-2 group"
                        >
                          <PlusCircle size={14} className="group-hover:rotate-90 transition-transform" />
                          Commit Registry
                        </button>
                      </div>
                    </div>

                    {/* Machine List Summary */}
                    <div className="xl:col-span-8 glass-panel overflow-hidden border-slate-200">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100">
                              <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">IDENTIFIER</th>
                              <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">TYPE</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {machines.slice(-5).reverse().map((m) => (
                              <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <p className="text-xs font-bold text-slate-900">{m.id}</p>
                                </td>
                                <td className="px-6 py-4">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">{m.type}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="p-4 bg-slate-50/50 border-t border-slate-100 text-center">
                        <button 
                          onClick={() => setActiveTab('machines')}
                          className="text-[10px] font-black text-brand-primary uppercase tracking-[0.2em] hover:underline"
                        >
                          View Full Hardware Registry
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="glass-panel p-8 bg-brand-primary/[0.02] border-brand-primary/10 flex items-start gap-6">
                  <div className="w-12 h-12 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary shrink-0">
                    <AlertCircle size={24} />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-slate-800">Master Data Integrity Protocol</h4>
                    <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">
                      These tables serve as the authoritative root for all operational parameters. 
                      Changes instantly synchronize across all client nodes and analytical modules. 
                      Exercise caution when removing items as it may affect historical log validation. 
                      Machine identifiers should follow the standard hierarchy (Section-Node-Spec) for optimal database indexing.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'machines' && (
              <motion.div 
                key="machines"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                   <h3 className="text-xl font-display font-bold flex items-center gap-3 text-slate-900">
                     <div className="w-10 h-10 rounded-xl bg-brand-primary/5 flex items-center justify-center text-brand-primary border border-brand-primary/10">
                       <Layers size={22} />
                     </div>
                     Hardware Infrastructure Registry
                   </h3>
                   <div className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] bg-white px-4 py-2 rounded-xl border border-slate-100 shadow-sm">
                     AUTO-SYNC: <span className="text-brand-success ml-1">ENABLED</span>
                   </div>
                </div>

                <div className="glass-panel shadow-md border-slate-100">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/50">
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">MACHINE ID</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">SPECIFICATION</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">TARGET (KG)</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">CURRENT STATE</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">LOGS / REMARKS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {machines.map((m) => (
                           <tr key={m.id} className="hover:bg-slate-50/50 transition-colors group">
                             <td className="px-8 py-5">
                               <p className="font-bold text-slate-900 tracking-tight">{m.id}</p>
                               <p className="text-[10px] text-slate-400 font-mono tracking-tighter">NODE-00{m.id.split('-')[1] || 'X'}</p>
                             </td>
                             <td className="px-8 py-5">
                               <span className="text-[10px] px-2 py-1 bg-slate-50 border border-slate-100 rounded font-mono text-slate-500 font-bold tracking-widest">{m.type}</span>
                             </td>
                             <td className="px-8 py-5">
                               <input 
                                 type="number" 
                                 defaultValue={m.target}
                                 onBlur={(e) => updateMachineStatus(m.id, { target: Number(e.target.value) })}
                                 className="w-32 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary/50 transition-all font-mono text-slate-700"
                               />
                             </td>
                             <td className="px-8 py-5">
                               <div className="relative">
                                 <select 
                                   value={m.status}
                                   onChange={(e) => updateMachineStatus(m.id, { status: e.target.value as any })}
                                   className={cn(
                                     "w-44 bg-slate-50 border rounded-xl px-4 py-2 text-[10px] font-bold transition-all appearance-none cursor-pointer tracking-widest shadow-sm",
                                     m.status === 'Running' ? 'border-brand-success/20 text-brand-success' : 
                                     m.status === 'Idle' ? 'border-brand-warning/20 text-brand-warning' : 'border-brand-danger/20 text-brand-danger'
                                   )}
                                 >
                                   <option value="Running">STATE_RUNNING</option>
                                   <option value="Idle">STATE_IDLE</option>
                                   <option value="Breakdown">STATE_BREAKDOWN</option>
                                 </select>
                                 <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30" />
                               </div>
                             </td>
                             <td className="px-8 py-5">
                               <input 
                                 type="text" 
                                 value={m.reason}
                                 onChange={(e) => {
                                   const newReason = e.target.value;
                                   setMachines(prev => prev.map(mach => mach.id === m.id ? { ...mach, reason: newReason } : mach));
                                 }}
                                 onBlur={(e) => updateMachineStatus(m.id, { reason: e.target.value })}
                                 className={cn(
                                   "w-full max-w-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs transition-all font-medium",
                                   m.status === 'Running' ? 'opacity-20 cursor-not-allowed' : 'opacity-100 hover:border-slate-300 focus:border-brand-primary/50'
                                 )}
                                 placeholder={m.status === 'Running' ? "NO_ALERTS" : "Specify reason for state change..."}
                                 disabled={m.status === 'Running'}
                               />
                             </td>
                           </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                   <h3 className="text-xl font-display font-bold flex items-center gap-3 text-slate-900">
                     <div className="w-10 h-10 rounded-xl bg-brand-primary/5 flex items-center justify-center text-brand-primary border border-brand-primary/10">
                       <History size={22} />
                     </div>
                     Factory Operational Logs
                   </h3>
                   <div className="flex gap-4">
                     <button className="px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-900 hover:border-slate-300 transition-all shadow-sm">CSV-EXPORT</button>
                     <button className="px-6 py-2.5 rounded-xl bg-brand-primary text-white text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-brand-primary/20 hover:scale-[1.02] transition-transform">REPORT_GENERATOR</button>
                   </div>
                </div>

                <div className="glass-panel border-slate-100">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/50">
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">BATCH_ID</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">TIMESTAMP</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">RESOURCE</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">OPERATOR</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">CLASS</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">YIELD (KG)</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">VALIDITY</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {[1, 2, 3, 4, 5, 8, 9].map((i) => (
                           <tr key={i} className="hover:bg-slate-50 transition-colors group cursor-pointer">
                             <td className="px-8 py-5">
                               <p className="font-mono text-xs text-brand-primary font-bold tracking-widest">R-174{i}2-26</p>
                             </td>
                             <td className="px-8 py-5">
                               <p className="text-sm font-bold text-slate-700 uppercase">17 MAY 2026</p>
                               <p className="text-[10px] text-slate-400 font-mono tracking-tighter">09:{20 + i}:42 AM</p>
                             </td>
                             <td className="px-8 py-5">
                               <span className="px-3 py-1 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-500 font-mono">EXT-0{i % 4 + 2}</span>
                             </td>
                             <td className="px-8 py-5">
                               <p className="text-xs font-bold text-slate-700">OP-50{i}</p>
                               <p className="text-[10px] text-slate-500">{i % 2 === 0 ? 'John Resnick' : 'Sarah Connor'}</p>
                             </td>
                             <td className="px-8 py-5 text-[10px] font-bold text-slate-400 tracking-widest">COMMERCIAL</td>
                             <td className="px-8 py-5 text-right font-mono font-bold text-sm text-slate-900">{340 + i * 15}.20</td>
                             <td className="px-8 py-5">
                               <div className="flex justify-center">
                                 <div className="w-2.5 h-2.5 bg-brand-success rounded-full shadow-[0_0_12px_rgba(5,150,105,0.2)]" />
                               </div>
                             </td>
                           </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-6 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <p>RECORDS_STREAM: <span className="text-slate-900 font-mono">5 / 1,240 ENTRIES</span></p>
                    <div className="flex gap-4">
                       <button className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-all font-bold">PREVIOUS_SET</button>
                       <button className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-all font-bold">NEXT_SET</button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'operators' && (
              <motion.div 
                key="operators"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                      <Users size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-display font-black text-slate-900 uppercase">Operator Master Table</h3>
                      <p className="text-sm text-slate-500 font-medium tracking-tight">Personnel authority and authentication records</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                  {/* Operator Form */}
                  <div className="xl:col-span-4 glass-panel p-6 border-slate-200">
                     <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-6 pb-2 border-b border-slate-100">
                       Register / Update Operator
                     </h4>
                     <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">OPERATOR ID</label>
                          <input 
                            type="text" 
                            placeholder="e.g. 500"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-brand-primary/5 transition-all"
                            id="op-id-input"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">FULL NAME</label>
                          <input 
                            type="text" 
                            placeholder="e.g. John Doe"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-brand-primary/5 transition-all"
                            id="op-name-input"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">EMAIL ADDRESS</label>
                          <input 
                            type="email" 
                            placeholder="john@mainetti.com"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-brand-primary/5 transition-all"
                            id="op-email-input"
                          />
                        </div>

                        <button 
                          onClick={async () => {
                            const idInput = document.getElementById('op-id-input') as HTMLInputElement;
                            const nameInput = document.getElementById('op-name-input') as HTMLInputElement;
                            const emailInput = document.getElementById('op-email-input') as HTMLInputElement;
                            
                            if (!idInput?.value || !nameInput?.value) {
                              showToast("ID and Name are required", 'error');
                              return;
                            }

                            try {
                              const res = await fetch('/api/operators', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  id: idInput.value,
                                  name: nameInput.value,
                                  email: emailInput.value
                                })
                              });
                              if (res.ok) {
                                showToast("Operator record updated", 'success');
                                idInput.value = '';
                                nameInput.value = '';
                                emailInput.value = '';
                                fetchOperators();
                              }
                            } catch (err) {
                              showToast("Network failure", 'error');
                            }
                          }}
                          className="w-full py-3 bg-brand-primary text-white rounded-xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-brand-primary/20 hover:brightness-110 transition-all flex items-center justify-center gap-2 group"
                        >
                          <Users size={14} className="group-hover:scale-110 transition-transform" />
                          Save Personnel Data
                        </button>
                     </div>
                  </div>

                  {/* Operator List */}
                  <div className="xl:col-span-8 glass-panel overflow-hidden border-slate-200">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">OPERATOR ID</th>
                            <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">OPERATOR NAME</th>
                            <th className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">EMAIL ID</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {operators.map((op) => (
                            <tr key={op.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => {
                              const idInput = document.getElementById('op-id-input') as HTMLInputElement;
                              const nameInput = document.getElementById('op-name-input') as HTMLInputElement;
                              const emailInput = document.getElementById('op-email-input') as HTMLInputElement;
                              if (idInput) idInput.value = op.id;
                              if (nameInput) nameInput.value = op.name;
                              if (emailInput) emailInput.value = op.email;
                            }}>
                              <td className="px-6 py-4">
                                <span className="font-mono text-xs font-black text-brand-primary">{op.id}</span>
                              </td>
                              <td className="px-6 py-4">
                                <p className="text-xs font-bold text-slate-900">{op.name}</p>
                              </td>
                              <td className="px-6 py-4">
                                <p className="text-[10px] font-medium text-slate-400">{op.email || 'N/A'}</p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'master-production-record' && (
              <motion.div 
                key="master-records"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                      <Database size={22} />
                    </div>
                    <div>
                      <h3 className="text-xl font-display font-black text-slate-900 uppercase">Master Production Record</h3>
                      <p className="text-sm text-slate-500 font-medium tracking-tight">Full historical database of all manufacturing cycles</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => fetchProductionRecords()}
                    className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-2"
                  >
                    <RefreshCw size={14} />
                    Sync Data
                  </button>
                </div>

                {/* Google Sheets Sync Card */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1 glass-panel p-6 border-indigo-100 bg-indigo-50/30">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-indigo-500 shadow-sm border border-indigo-100">
                        <FileSpreadsheet size={24} />
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${spreadsheetId ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                        {spreadsheetId ? 'Linked' : 'Not Linked'}
                      </div>
                    </div>
                    <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-1">Google Sheets Database</h4>
                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed mb-6">
                      Sync every production cycle automatically to a private Google Spreadsheet for advanced analysis and reporting.
                    </p>
                    
                    {!spreadsheetId ? (
                      <div className="space-y-3">
                        {user && !googleToken && (
                           <button 
                            onClick={handleGoogleSignIn}
                            className="w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all"
                          >
                            Grant API Permissions
                          </button>
                        )}
                        <button 
                          onClick={handleInitSheet}
                          disabled={isLoading || !user || !googleToken}
                          className="w-full py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:opacity-50"
                        >
                          {isLoading ? 'Connecting...' : (googleToken ? 'Initialize / Link Sheet' : 'Sign in to Link')}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {googleToken ? (
                          <div className="space-y-3">
                            <button 
                              onClick={handleFullSync}
                              disabled={isSyncing}
                              className="w-full py-3 bg-white border border-indigo-200 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                              Push full Database
                            </button>
                            <button 
                              onClick={handleSyncMasterData}
                              disabled={isSyncing}
                              className="w-full py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-100 disabled:opacity-50"
                            >
                              <Database size={14} />
                              Sync All Master Tables
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={handleGoogleSignIn}
                            className="w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all flex items-center justify-center gap-2"
                          >
                            Reconnect for Sync
                          </button>
                        )}
                        <a 
                          href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="w-full py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                        >
                          Open Spreadsheet
                        </a>
                      </div>
                    )}
                    {!user && (
                      <p className="text-[9px] text-center mt-3 text-rose-500 font-black uppercase tracking-widest italic animate-pulse">
                        Sign in required for sync
                      </p>
                    )}
                  </div>

                  <div className="lg:col-span-2 glass-panel p-6 border-slate-200">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                        <Activity size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Sync Activity</h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Real-time update stream</p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      {productionRecords.length > 0 ? productionRecords.slice(0, 4).map((record, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                          <div className="flex items-center gap-4">
                            <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center font-mono text-[10px] font-black text-slate-400">
                              {i+1}
                            </div>
                            <div>
                              <p className="text-[11px] font-black text-slate-800">{record.RollID}</p>
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{record.DataUpdateTime}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                             {/* Since we don't store sync state per record in masterData yet, 
                                 we show "Available" if linked, but we acknowledge the link status */}
                            <div className={`w-2 h-2 rounded-full ${spreadsheetId ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                              {spreadsheetId ? 'Live Sync' : 'Offline'}
                            </span>
                          </div>
                        </div>
                      )) : (
                        <div className="py-8 text-center border-2 border-dashed border-slate-100 rounded-2xl">
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No recent activity</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="glass-panel overflow-hidden border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[3000px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Roll ID</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Production Date</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Shift</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Production Type</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Operator ID</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Machine No</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Year</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">PI Number</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Tube Size</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">UOM</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Material</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Micron</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">InLine Print</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Finished Meter</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Finished KG</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Roll Location</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Data Update Time</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Fingerprint</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Entered By</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Operator Name</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Scrap Kgs</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Production Year</th>
                          <th className="px-4 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Production Month</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {productionRecords.map((record, idx) => (
                          <tr key={record.RollID || idx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3"><span className="font-mono text-[11px] font-black text-brand-primary">{record.RollID}</span></td>
                            <td className="px-4 py-3 text-[11px] font-bold text-slate-700">{record.ProductionDate}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.Shift}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.ProductionType}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.OperatorID}</td>
                            <td className="px-4 py-3 text-[11px] font-bold text-slate-900">{record.MachineNo}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.Year}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.PINumber || 'N/A'}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.TubeSize} mm</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.UOM}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.Material}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.Micron}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.InLinePrint}</td>
                            <td className="px-4 py-3 text-[11px] font-bold text-slate-900">{record.FinishedMeter} M</td>
                            <td className="px-4 py-3 text-[11px] font-bold text-brand-primary">{record.FinishedKgs} KG</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-900">{record.RollLocation}</td>
                            <td className="px-4 py-3 text-[10px] font-mono font-medium text-slate-400">{record.DataUpdateTime}</td>
                            <td className="px-4 py-3 text-[10px] font-mono text-slate-400">{record.Fingerprint}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-500">{record.EnteredBy}</td>
                            <td className="px-4 py-3 text-[11px] font-bold text-slate-900">{record.OperatorName}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-rose-500 font-bold">{record.ScrapKgs} KG</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-600">{record.ProductionYear}</td>
                            <td className="px-4 py-3 text-[11px] font-medium text-slate-600">{record.ProductionMonth}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Master Item Modal */}
      <AnimatePresence>
        {modalConfig && modalConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setModalConfig(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden relative z-10"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                      <PlusCircle size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-display font-bold text-slate-900 tracking-tight">{modalConfig.title}</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Adding Reference Entry</p>
                    </div>
                  </div>
                  <button onClick={() => setModalConfig(null)} className="text-slate-300 hover:text-slate-500 transition-colors">
                    <XCircle size={24} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">VALUE / LABEL</label>
                    <input 
                      type="text" 
                      autoFocus
                      placeholder="Enter value..."
                      value={newMasterItem}
                      onChange={(e) => setNewMasterItem(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          const key = modalConfig.type;
                          const updated = { ...masterStore, [key]: [...masterStore[key], newMasterItem] };
                          setMasterStore(updated);
                          await fetch('/api/master-store', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(updated)
                          });
                          showToast("Entry saved successfully", 'success');
                          setNewMasterItem("");
                          setModalConfig(null);
                        }
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-brand-primary/5 transition-all"
                    />
                  </div>
                  
                    <button 
                      onClick={async () => {
                        if (!newMasterItem) return;
                        const key = modalConfig.type;
                        const updated = { ...masterStore, [key]: [...masterStore[key], newMasterItem] };
                        setMasterStore(updated);
                        await fetch('/api/master-store', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(updated)
                        });
                        showToast("Entry saved successfully", 'success');
                        setNewMasterItem("");
                        setModalConfig(null);
                      }}
                      className="w-full py-4 bg-brand-primary text-white rounded-2xl text-xs font-black uppercase tracking-[0.2em] shadow-xl shadow-brand-primary/20 hover:brightness-110 transition-all"
                    >
                      Commit Entry
                    </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <div className={cn(
              "px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border",
              toast.type === 'success' ? "bg-emerald-500 text-slate-950 border-emerald-400" : "bg-rose-500 text-white border-rose-400"
            )}>
              {toast.type === 'success' ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
              <span className="font-bold">{toast.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Sub-components
function SidebarLink({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all group relative overflow-hidden",
        active 
          ? "bg-brand-primary/5 text-brand-primary font-bold shadow-sm" 
          : "text-slate-400 hover:bg-slate-50 hover:text-slate-700"
      )}
    >
      {active && (
        <motion.div 
          layoutId="sidebar-active"
          className="absolute left-0 top-0 bottom-0 w-1.5 bg-brand-primary rounded-r-full"
        />
      )}
      <span className={cn("transition-colors duration-300", active ? "text-brand-primary" : "group-hover:text-brand-primary")}>
        {icon}
      </span>
      <span className="text-[11px] font-bold tracking-widest uppercase">{label}</span>
    </button>
  );
}

function MetricHead({ label, value, unit, color = "text-slate-900" }: { label: string, value: string, unit: string, color?: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold mb-1">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={cn("text-lg font-mono font-bold leading-none", color)}>{value}</span>
        <span className="text-[10px] font-bold text-slate-300 font-mono">{unit}</span>
      </div>
    </div>
  );
}

function StatCard({ title, value, unit, trend, icon }: { title: string, value: string, unit: string, trend: string, icon: React.ReactNode }) {
  return (
    <div className="glass-panel p-8 group hover:border-brand-primary/20 transition-all duration-300 panel-glow relative shadow-sm border-slate-100">
      <div className="flex justify-between items-start mb-6">
        <div className="w-12 h-12 rounded-xl bg-white border border-slate-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-500 shadow-sm shadow-slate-200/50">
          {icon}
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">{unit}</p>
        </div>
      </div>
      <div className="space-y-1">
        <h4 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-2">{title}</h4>
        <div className="flex items-baseline gap-2">
          <p className="text-4xl font-display font-bold text-slate-900 tracking-tighter transition-all">{value}</p>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-2">
        <div className="px-2 py-0.5 rounded-md bg-emerald-500/5 border border-emerald-500/10 text-[9px] font-bold text-brand-success uppercase tracking-wider">
          {trend}
        </div>
      </div>
    </div>
  );
}

function MachineCard({ machine }: { machine: MachineSummary, key?: string | number }) {
  const statusColors = {
    Running: 'text-brand-success border-brand-success/10 bg-brand-success/5',
    Idle: 'text-brand-warning border-brand-warning/10 bg-brand-warning/5',
    Breakdown: 'text-brand-danger border-brand-danger/10 bg-brand-danger/5'
  };

  const statusGlow = {
    Running: 'status-running-glow',
    Idle: 'status-idle-glow',
    Breakdown: 'status-breakdown-glow'
  };

  return (
    <div className="glass-panel p-6 group hover:border-brand-primary/20 transition-all duration-500 relative panel-glow shadow-sm border-slate-100">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h4 className="text-lg font-display font-bold text-slate-900 tracking-tight">{machine.MachineNo}</h4>
            <div className={cn(
              "status-indicator",
              statusGlow[machine.Status],
              machine.Status === 'Running' ? 'bg-brand-success' : machine.Status === 'Idle' ? 'bg-brand-warning' : 'bg-brand-danger'
            )} />
          </div>
          <div className={cn(
            "inline-flex px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border",
            statusColors[machine.Status]
          )}>
            {machine.Status}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">REFRESHED</p>
          <p className="text-[10px] font-mono text-slate-400">
            {machine.LastUpdate === 'N/A' ? 'OFFLINE' : new Date(machine.LastUpdate).toLocaleTimeString()}
          </p>
        </div>
      </div>

      {machine.Reason && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-orange-50 border border-orange-100 flex items-center gap-2">
          <AlertTriangle size={12} className="text-brand-warning" />
          <p className="text-[10px] font-medium text-brand-warning italic line-clamp-1">
            {machine.Reason}
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6 border-y border-slate-100 py-4 mb-4">
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-[0.1em] mb-1">PROD</p>
          <p className="text-sm font-mono font-bold text-slate-700">{machine.TotalProductionKgs}<span className="text-[10px] ml-1 opacity-40">KG</span></p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-[0.1em] mb-1">SPEED</p>
          <p className="text-sm font-mono font-bold text-slate-700">{machine.TotalMeter}<span className="text-[10px] ml-1 opacity-40">M</span></p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-[0.1em] mb-1">BATCH</p>
          <p className="text-sm font-mono font-bold text-slate-700">{machine.TotalRolls}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-end">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">QUOTA PROGRESS</span>
          <span className="text-[10px] font-mono font-bold text-brand-primary leading-none">
            {Math.round((machine.TotalProductionKgs / machine.TargetKgs) * 100)}%
          </span>
        </div>
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((machine.TotalProductionKgs / machine.TargetKgs) * 100, 100)}%` }}
            className={cn(
              "h-full transition-all duration-1000",
              machine.Status === 'Running' ? 'bg-brand-primary' : 'bg-slate-300'
            )}
          />
        </div>
      </div>
    </div>
  );
}

function StatusLegend({ color, label }: { color: string, label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-slate-100 shadow-sm">
      <div className={cn("w-2 h-2 rounded-full", color)} />
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  );
}

function InputField({ label, name, icon, ...props }: any) {
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
        {icon}
        {label}
      </label>
      <input 
        name={name}
        {...props}
        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-200 focus:outline-none focus:ring-4 focus:ring-brand-primary/5 focus:border-brand-primary/30 transition-all font-medium"
      />
    </div>
  );
}

function SelectField({ label, name, icon, options, placeholder, ...props }: any) {
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
        {icon}
        {label}
      </label>
      <div className="relative">
        <select 
          name={name}
          {...props}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-4 focus:ring-brand-primary/5 focus:border-brand-primary/30 transition-all font-medium appearance-none"
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map((opt: string) => (
            <option key={opt} value={opt} className="bg-white">{opt}</option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
          <ChevronDown size={12} />
        </div>
      </div>
    </div>
  );
}

