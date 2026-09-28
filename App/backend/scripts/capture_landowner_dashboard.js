const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

async function capture() {
  console.log('Capturing Land Owner Dashboard Screenshot...');

  // 1. Authenticate and get token
  const loginRes = await fetch('http://localhost:9000/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ id: 'LAND-001', password: 'Pass@1234' })
  });
  const loginJson = await loginRes.json();
  const token = loginJson.data?.token;

  if (!token) throw new Error('Could not get auth token');

  // 2. Launch headless Edge
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--window-size=1440,960',
    'about:blank'
  ]);

  // Wait 1.5s for port to open
  await new Promise(r => setTimeout(r, 1500));

  // 3. Connect to CDP
  const listRes = await fetch('http://127.0.0.1:9222/json/list');
  const pages = await listRes.json();
  const wsUrl = pages[0].webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);

  let msgId = 1;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = msgId++;
    const handler = (data) => {
      const res = JSON.parse(data.toString());
      if (res.id === id) {
        ws.off('message', handler);
        resolve(res.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise(r => ws.on('open', r));

  // 4. Set Cookie for localhost:9000
  await send('Network.enable');
  await send('Network.setCookie', {
    name: 'token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true
  });

  // 5. Navigate to Dashboard
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:9000/dashboard/land-owner' });

  // Wait 3.5s for Leaflet map & animations to render completely
  await new Promise(r => setTimeout(r, 3500));

  // 6. Capture full screenshot
  const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
  const outPath = 'C:\\Users\\rehan\\.gemini\\antigravity\\brain\\187e92c3-2712-4ee4-b78c-b8781c80ee35\\landowner_dashboard_verified.png';
  fs.writeFileSync(outPath, Buffer.from(screenshotRes.data, 'base64'));

  console.log('✅ Screenshot saved to:', outPath);

  ws.close();
  edge.kill();
  process.exit(0);
}

capture().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
