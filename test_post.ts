import http from 'http';

const data = JSON.stringify({
  ProductionDate: "2026-06-13",
  Shift: "Day",
  ProductionType: "Sample",
  OperatorID: "32",
  MachineNo: "Ext-05-LD800",
  PINumber: "4545",
  TubeSize: "545",
  UOM: "CM",
  Material: "LLDPE",
  Micron: "45",
  InLinePrint: "Yes",
  FinishedMeter: "4444",
  FinishedKgs: "44",
  ScrapKgs: "44",
  RollLocation: "1"
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/production',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, body));
});

req.on('error', e => console.error('Error:', e.message));
req.write(data);
req.end();
