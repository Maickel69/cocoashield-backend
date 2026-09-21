import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { exec } from 'child_process';
import https from 'https';
import http from 'http';
import { createRequire } from 'module';
import { getCasesFromDb, saveCaseToDb } from './dbClient.js';
const require = createRequire(import.meta.url);
let mkcert = null;
try {
  mkcert = require('mkcert');
} catch (e) {
  console.log('[TLS] mkcert no está disponible (modo producción nube)');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'db.json');
const CERT_PATH = path.join(__dirname, 'cert.pem');
const KEY_PATH = path.join(__dirname, 'key.pem');

const getSortedLocalIps = () => {
  const interfaces = os.networkInterfaces();
  const rawAddresses = [];
  for (const name of Object.keys(interfaces)) {
    const isVirtual = name.toLowerCase().includes('vmware') || 
                      name.toLowerCase().includes('virtualbox') || 
                      name.toLowerCase().includes('vbox') || 
                      name.toLowerCase().includes('wsl') || 
                      name.toLowerCase().includes('host-only') ||
                      name.toLowerCase().includes('tailscale');
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        rawAddresses.push({
          address: iface.address,
          isVirtual: isVirtual || 
                     iface.address.startsWith('192.168.56.') || 
                     iface.address.startsWith('192.168.30.') || 
                     iface.address.startsWith('192.168.81.')
        });
      }
    }
  }

  rawAddresses.sort((a, b) => {
    const isApipaA = a.address.startsWith('169.254.');
    const isApipaB = b.address.startsWith('169.254.');
    if (isApipaA && !isApipaB) return 1;
    if (!isApipaA && isApipaB) return -1;

    if (a.isVirtual && !b.isVirtual) return 1;
    if (!a.isVirtual && b.isVirtual) return -1;

    return 0;
  });

  return rawAddresses.map(item => item.address);
};

const app = express();
const PORT = process.env.PORT || 5000;
const HTTPS_PORT = 5443;

// CORS: allow all origins (critical for Vercel → local backend connection)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder'],
}));
app.use(express.json({ limit: '50mb' }));

// Serve the compiled mobile app frontend statically
const MOBILE_DIST_PATH = 'C:/Users/HP/Downloads/metodologia/movil/dist';
if (fs.existsSync(MOBILE_DIST_PATH)) {
  app.use(express.static(MOBILE_DIST_PATH));
  console.log(`[Static] ✅ Serviendo la aplicación móvil desde: ${MOBILE_DIST_PATH}`);
} else {
  console.warn(`[Static] ⚠️  Carpeta de distribución móvil no encontrada en: ${MOBILE_DIST_PATH}`);
}

// ─── Generate or load self-signed TLS certificate (async) ───────────────
let tlsOptions = null;
const initTls = async () => {
  if (!mkcert) return;
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    tlsOptions = { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
    console.log('[TLS] Certificado TLS cargado desde disco.');
    return;
  }
  try {
    console.log('[TLS] Generando certificado auto-firmado para HTTPS local...');
    const ca = await mkcert.createCA({
      organization: 'CocoaShield Local CA',
      countryCode: 'EC',
      state: 'Napo',
      locality: 'Tena',
      validity: 365
    });
    const cert = await mkcert.createCert({
      ca: { key: ca.key, cert: ca.cert },
      domains: ['127.0.0.1', 'localhost', '192.168.1.33', '192.168.1.24'],
      validity: 365
    });
    fs.writeFileSync(KEY_PATH, cert.key);
    fs.writeFileSync(CERT_PATH, `${cert.cert}\n${ca.cert}`);
    tlsOptions = { key: cert.key, cert: `${cert.cert}\n${ca.cert}` };
    console.log('[TLS] ✅ Certificado generado y guardado.');
  } catch (e) {
    console.error('[TLS] Error generando certificado:', e.message);
  }
};

let tunnelUrl = '';

const publishServerInfo = async () => {
  const sortedIps = getSortedLocalIps();

  const payload = {
    localIps: sortedIps,
    tunnelUrl: tunnelUrl,
    ports: { http: PORT, https: HTTPS_PORT },
    updatedAt: new Date().toISOString()
  };

  try {
    const res = await fetch('https://jsonbin-zeta.vercel.app/api/bins/7RpZP8VJpJ', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      console.log(`[Discovery] ✅ Servidor publicado en registro en la nube: ${JSON.stringify(payload)}`);
    } else {
      console.error(`[Discovery] ❌ Error publicando en registro en la nube:`, res.statusText);
    }
  } catch (err) {
    console.error(`[Discovery] ❌ Error de red al publicar en la nube:`, err.message);
  }
};

// API Endpoint to register the public tunnel URL
app.post('/api/server-info/tunnel', async (req, res) => {
  const { url } = req.body;
  tunnelUrl = url || '';
  console.log(`[Server] Tunnel público registrado: ${tunnelUrl}`);
  res.json({ success: true, tunnelUrl });
  await publishServerInfo();
});


// API Endpoint to get the server's local network IP addresses
app.get('/api/server-info', (req, res) => {
  const sortedIps = getSortedLocalIps();
  const localIp = sortedIps[0] || '127.0.0.1';
  res.json({
    localIp,
    allIps: sortedIps,
    port: PORT,
    httpsPort: HTTPS_PORT,
    httpsUrl: `https://${localIp}:${HTTPS_PORT}`,
    tunnelUrl: tunnelUrl
  });
});

// Middleware to log all incoming requests, client IP, and User-Agent (identifies the phone)
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
  const userAgent = req.headers['user-agent'] || 'Unknown Device';
  console.log(`[REQ] ${req.method} ${req.url} - IP: ${ip} - Device: ${userAgent}`);
  next();
});

// List of connected SSE clients
let sseClients = [];

// Helper to read database
const readDb = () => {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return [];
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database file:', error);
    return [];
  }
};

// Helper to write database
const writeDb = (data) => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error writing database file:', error);
    return false;
  }
};

// SSE Endpoint for real-time streaming to the dashboard
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send an initial handshake comment event to establish connection
  res.write(': connection established\n\n');

  const clientId = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
  const userAgent = req.headers['user-agent'] || 'Unknown Device';
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  console.log(`[SSE] Client connected: ${clientId} from IP: ${ip} (${userAgent}). Total: ${sseClients.length}`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
    console.log(`[SSE] Client disconnected: ${clientId} from IP: ${ip}. Total: ${sseClients.length}`);
  });
});

// Broadcast helper to send updates to all connected dashboards
const broadcastUpdate = (data) => {
  sseClients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
};

// API Endpoint: Get all cases
app.get('/api/cases', async (req, res) => {
  const cases = await getCasesFromDb();
  res.json(cases);
});

const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || Buffer.from('QVEuQWI4Uk42S1hXc1ZVOWhQOE1OejliTmVBREZsQ0VYVXE5djgxbXNqMXpDWTI3c2xiT1E=', 'base64').toString();

const FITO_SYSTEM_PROMPT = `Eres un fitopatólogo agrónomo experto de campo en diagnóstico fitosanitario de cacao (Theobroma cacao).
Analiza con rigor científico la fotografía y clasifica el estado en UNA de las 4 categorías fitosanitarias exclusivas:

1. 'Mazorca Negra' (Phytophthora spp.):
   - Necrosis de color marrón oscuro, café chocolate negruzco o negro carbón continuo y uniforme.
   - Suele originarse en el pedúnculo (base) extendiéndose hacia abajo, o en la punta del fruto hacia arriba, o envolver mazorcas enteras que se tornan oscuras, secas o momificadas.
   - La corteza se aprecia firme o de pudrición lisa/húmeda, y NO presenta la capa espesa aterciopelada de polvillo fúngico blanco harinoso de la Monilia.
   - BOLSAS DE ENFUNDE / PROTECCIÓN PLÁSTICA: Si la mazorca está cubierta o envuelta por una bolsa o funda plástica transparente de protección agrícola (enfunde), y el fruto dentro de la bolsa presenta tejido necrótico marrón oscuro o negro, clasifícala INDISCUTIBLEMENTE como 'Mazorca Negra'. Las arrugas del plástico, brillos por reflejo solar/flash y gotas de condensación de agua en la bolsa NO son polvillo fúngico.

2. 'Monilia' (Moniliophthora roreri):
   - Presencia de una CUBIERTA REAL, ESPESA Y PULVERULENTA DE POLVILLO O ESPORAS fúngicas blanquecinas, crema o cenicientas (aspecto de harina, ceniza o fieltro algodonoso espeso) que cubre manchas pardas sobre la corteza del fruto.
   - En frutos jóvenes, presencia característica de gibas, abultamientos o protuberancias irregulares (deformaciones asimétricas de la mazorca) con mancha chocolate y pudrición interna acuosa.
   - Nota: Si no hay polvillo fúngico blanco evidente y solo es tejido oscuro/negro bajo plástico o liso, clasifícalo como 'Mazorca Negra'.

3. 'Escoba de Bruja' (Moniliophthora perniciosa):
   - En ramas y brotes vegetativos: proliferación hipertrófica de ramillas laterales en forma de racimo o escoba de bruja, hojas secas de color pardo adheridas que no caen.
   - En frutos y cojinetes: manchas necróticas marrones de consistencia dura, seca y leñosa (coriáceas), acompañadas de maduración prematura anormal en mosaico ('islas verdes' o amarilleamiento disparejo), frutos acorazonados o deformes en 'chirimoya', o presencia de basidiocarpos (pequeñas setitas o sombreritos carnosos rojizos/rosados con pie que nacen del tejido muerto).

4. 'Sano':
   - Mazorcas, ramas y follaje vigoroso y limpio, de coloración verde o amarilla uniforme (o rojizo/morado natural según la variedad y maduración fisiológica), sin manchas necróticas ni pudriciones activas. Mazorcas sanas dentro de fundas plásticas sin lesiones oscuras se clasifican como Sano.

Responde ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "diagnosis": "Mazorca Negra" | "Monilia" | "Escoba de Bruja" | "Sano",
  "confidence": 96.0,
  "description": "Explicación agronómica detallada y signos visuales observados en la imagen",
  "treatment": "Protocolo de manejo cultural o fitosanitario inmediato recomendado"
}`;

async function diagnoseWithDirectGemini(base64Image, mimeExt, customKey) {
  const apiKey = (customKey || '').trim() || DEFAULT_GEMINI_KEY;
  const models = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
  const mimeType = mimeExt === 'png' ? 'image/png' : 'image/jpeg';

  let lastErr = null;
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: FITO_SYSTEM_PROMPT },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            response_mime_type: 'application/json'
          }
        }),
        signal: AbortSignal.timeout(18000)
      });

      if (!resp.ok) {
        throw new Error(`Gemini API HTTP ${resp.status} ${resp.statusText}`);
      }

      const data = await resp.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(rawText);

      let diagnosis = 'Sano';
      const diagStr = (parsed.diagnosis || '').toLowerCase();
      if (diagStr.includes('monilia')) diagnosis = 'Monilia';
      else if (diagStr.includes('escoba')) diagnosis = 'Escoba de Bruja';
      else if (diagStr.includes('negra') || diagStr.includes('phyto')) diagnosis = 'Mazorca Negra';
      else if (diagStr.includes('sano')) diagnosis = 'Sano';

      return {
        success: true,
        diagnosis: diagnosis,
        confidence: Number(parsed.confidence) || 95,
        details: {
          scientific_name: diagnosis === 'Monilia' ? 'Moniliophthora roreri' : (diagnosis === 'Escoba de Bruja' ? 'Moniliophthora perniciosa' : (diagnosis === 'Mazorca Negra' ? 'Phytophthora spp.' : 'Theobroma cacao')),
          severity: diagnosis === 'Sano' ? 'Ninguna' : (diagnosis === 'Monilia' ? 'Crítica' : 'Alta'),
          description: parsed.description || '',
          treatment: parsed.treatment || ''
        },
        model: `Google Gemini Vision (${model}) Instant Engine`
      };
    } catch (err) {
      console.warn(`[DirectGemini] Model ${model} failed:`, err.message);
      lastErr = err;
    }
  }
  throw lastErr || new Error('Direct Gemini Vision diagnosis failed');
}

// API Endpoint: Run AI diagnosis on server and register the case
app.post('/api/predict', (req, res) => {
  const { image, location, region, farmer, lat, lng, svgX, svgY } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'No image data provided' });
  }

  // Decode base64 image and save to temporary file
  const matches = image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
  let ext = 'jpg';
  let dataBuffer = null;
  let rawBase64 = image;

  if (matches && matches.length === 3) {
    ext = matches[1];
    rawBase64 = matches[2];
    dataBuffer = Buffer.from(matches[2], 'base64');
  } else {
    dataBuffer = Buffer.from(image, 'base64');
  }

  const tempFileName = `temp_scan_${Date.now()}.${ext}`;
  const tempFilePath = path.join(__dirname, tempFileName);

  try {
    fs.writeFileSync(tempFilePath, dataBuffer);
  } catch (err) {
    console.error('[Predict] Error saving temp file:', err);
    return res.status(500).json({ error: 'Failed to process image on server' });
  }

  let aiEndpoint = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000/predict';
  if (!aiEndpoint.endsWith('/predict')) {
    aiEndpoint = aiEndpoint.replace(/\/$/, '') + '/predict';
  }

  (async () => {
    let result = null;

    // 1. Intentar Microservicio de IA Python con timeout de 6s
    try {
      const blob = new Blob([dataBuffer], { type: `image/${ext}` });
      const formData = new FormData();
      formData.append('file', blob, tempFileName);
      if (req.body.geminiKey) {
        formData.append('gemini_key', req.body.geminiKey);
      }

      console.log(`[Predict] Consultando microservicio de IA: ${aiEndpoint}`);
      const aiResponse = await fetch(aiEndpoint, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(6000)
      });

      if (aiResponse.ok) {
        const jsonRes = await aiResponse.json();
        if (jsonRes.success) {
          result = jsonRes;
          console.log('[Predict] Microservicio de IA respondió exitosamente.');
        }
      }
    } catch (uErr) {
      console.log(`[Predict] Microservicio Python no disponible o hibernando (${uErr.message}). Activando motor directo Gemini...`);
    }

    // 2. Si el microservicio tardó o falló, ejecutar diagnóstico directo con Gemini Vision (1.5s)
    if (!result) {
      try {
        console.log('[Predict] Diagnóstico directo con Gemini Vision...');
        result = await diagnoseWithDirectGemini(rawBase64, ext, req.body.geminiKey);
      } catch (geminiErr) {
        console.error('[Predict] Error en motor directo Gemini:', geminiErr.message);
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        return res.status(500).json({ error: 'Fallo en diagnóstico de IA: ' + geminiErr.message });
      }
    }

    // Limpieza de archivo temporal
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    // Registrar caso en la base de datos
    const cases = readDb();
    
    let maxNum = 0;
    cases.forEach(c => {
      const num = parseInt(c.id.replace('CS-', ''));
      if (!isNaN(num) && num > maxNum) maxNum = num;
    });
    const newId = `CS-${String(maxNum + 1).padStart(3, '0')}`;

    let finalRegion = region || 'Napo';
    let finalSvgX = svgX || 200;
    let finalSvgY = svgY || 200;

    if (lat && lng) {
      if (lng < -77.544) {
        finalRegion = lat < -1.027 ? 'Orellana' : 'Pastaza';
      } else {
        finalRegion = lat < -1.027 ? 'Napo' : 'Sucumbíos';
      }
      
      const minLat = -1.036;
      const maxLat = -1.018;
      const minLng = -77.552;
      const maxLng = -77.531;
      finalSvgX = Math.round(40 + ((lng - minLng) / (maxLng - minLng)) * 420);
      finalSvgY = Math.round(360 - ((lat - minLat) / (maxLat - minLat)) * 320);
    }

    const finalCase = {
      id: newId,
      location: location || 'Finca Local',
      region: finalRegion,
      date: new Date().toISOString().split('T')[0],
      diagnosis: result.diagnosis,
      confidence: result.confidence,
      status: 'Crítico',
      farmer: farmer || 'Técnico de Campo',
      lat: lat || -1.0234,
      lng: lng || -77.5432,
      svgX: finalSvgX,
      svgY: finalSvgY,
      severity: result.diagnosis === 'Sano' ? 'ninguna' : (result.confidence > 90 ? 'alta' : 'media'),
      prescription: '',
      image: image
    };

    const updatedCases = [finalCase, ...cases];
    if (writeDb(updatedCases)) {
      console.log(`[API] Caso Diagnosticado y Registrado: ${newId} (${result.diagnosis})`);
      
      broadcastUpdate({ type: 'ADD_CASE', caseData: finalCase });
      
      res.status(201).json({
        success: true,
        caseData: finalCase,
        details: result.details,
        model: result.model
      });
    } else {
      res.status(500).json({ error: 'Failed to write case to database' });
    }
  })();
});

// API Endpoint: Add a new case (synced from mobile device)
app.post('/api/cases', (req, res) => {
  const newCase = req.body;
  
  if (!newCase || !newCase.id || !newCase.diagnosis) {
    return res.status(400).json({ error: 'Invalid case data' });
  }

  const cases = readDb();
  
  // Check for duplicates
  const exists = cases.some(c => c.id === newCase.id);
  if (exists) {
    return res.status(409).json({ error: 'Case already exists on server' });
  }

  const updatedCases = [newCase, ...cases];
  if (writeDb(updatedCases)) {
    console.log(`[API] Synced new case: ${newCase.id} (${newCase.diagnosis})`);
    
    // Broadcast the new case to all SSE dashboards
    broadcastUpdate({ type: 'ADD_CASE', caseData: newCase });
    
    res.status(201).json(newCase);
  } else {
    res.status(500).json({ error: 'Failed to write to database' });
  }
});

// API Endpoint: Emit a personalized prescription for a case
app.post('/api/cases/prescription', (req, res) => {
  const { id, prescription, status } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Missing case ID' });
  }

  const cases = readDb();
  const index = cases.findIndex(c => c.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Case not found' });
  }

  // Update prescription and status
  cases[index].prescription = prescription || '';
  if (status) {
    cases[index].status = status;
  }

  if (writeDb(cases)) {
    console.log(`[API] Issued prescription for case: ${id}`);
    
    // Broadcast the updated case to all dashboards
    broadcastUpdate({ type: 'UPDATE_CASE', caseData: cases[index] });
    
    res.json({ success: true, caseData: cases[index] });
  } else {
    res.status(500).json({ error: 'Failed to save prescription' });
  }
});

// API Endpoint: Reset database to initial values
app.post('/api/cases/reset', (req, res) => {
  const INITIAL_CASES = [
    { "id": "CS-001", "location": "Finca La Estrella – Lote A", "region": "Sucumbíos", "date": "2026-05-25", "diagnosis": "Monilia", "confidence": 98, "status": "Crítico", "farmer": "Carlos Muñoz", "lat": -1.0234, "lng": -77.5432, "svgX": 190, "svgY": 155, "severity": "alta", "prescription": "" },
    { "id": "CS-002", "location": "Cooperativa Sur – Parcela 3", "region": "Napo", "date": "2026-05-24", "diagnosis": "Escoba de Bruja", "confidence": 91, "status": "En seguimiento", "farmer": "Rosa Tipán", "lat": -1.0289, "lng": -77.5478, "svgX": 280, "svgY": 295, "severity": "media", "prescription": "" },
    { "id": "CS-003", "location": "Finca El Placer – Norte", "region": "Sucumbíos", "date": "2026-05-23", "diagnosis": "Mazorca Negra", "confidence": 88, "status": "Resuelto", "farmer": "Héctor Villacís", "lat": -1.0321, "lng": -77.5385, "svgX": 370, "svgY": 120, "severity": "media", "prescription": "" },
    { "id": "CS-004", "location": "Finca La Estrella – Lote B", "region": "Napo", "date": "2026-05-22", "diagnosis": "Monilia", "confidence": 95, "status": "Crítico", "farmer": "Ana Torres", "lat": -1.0256, "lng": -77.5401, "svgX": 230, "svgY": 205, "severity": "alta", "prescription": "" },
    { "id": "CS-005", "location": "Lote Comunitario Bajo", "region": "Orellana", "date": "2026-05-21", "diagnosis": "Escoba de Bruja", "confidence": 93, "status": "Crítico", "farmer": "José Lema", "lat": -1.0310, "lng": -77.5502, "svgX": 110, "svgY": 330, "severity": "alta", "prescription": "" },
    { "id": "CS-006", "location": "Finca San Pedro – Centro", "region": "Pastaza", "date": "2026-05-20", "diagnosis": "Sano", "confidence": 99, "status": "Resuelto", "farmer": "Lucía Cárdenas", "lat": -1.0198, "lng": -77.5460, "svgX": 310, "svgY": 80, "severity": "ninguna", "prescription": "" },
    { "id": "CS-007", "location": "Hacienda Los Cedros", "region": "Napo", "date": "2026-05-19", "diagnosis": "Monilia", "confidence": 97, "status": "En seguimiento", "farmer": "Manuel Quispe", "lat": -1.0345, "lng": -77.5350, "svgX": 440, "svgY": 250, "severity": "alta", "prescription": "" },
    { "id": "CS-008", "location": "Finca La Aurora", "region": "Sucumbíos", "date": "2026-05-18", "diagnosis": "Mazorca Negra", "confidence": 84, "status": "Resuelto", "farmer": "Patricia Yumbay", "lat": -1.0271, "lng": -77.5419, "svgX": 250, "svgY": 180, "severity": "media", "prescription": "" },
    { "id": "CS-009", "location": "Cooperativa Norte – Bloque 2", "region": "Napo", "date": "2026-05-17", "diagnosis": "Escoba de Bruja", "confidence": 89, "status": "En seguimiento", "farmer": "Diego Shiguango", "lat": -1.0233, "lng": -77.5388, "svgX": 340, "svgY": 140, "severity": "media", "prescription": "" },
    { "id": "CS-010", "location": "Lote Familiar Tena", "region": "Napo", "date": "2026-05-16", "diagnosis": "Monilia", "confidence": 96, "status": "Crítico", "farmer": "Marina Grefa", "lat": -1.0299, "lng": -77.5467, "svgX": 170, "svgY": 260, "severity": "alta", "prescription": "" },
    { "id": "CS-011", "location": "Finca Fitosanitaria Puyo", "region": "Pastaza", "date": "2026-05-15", "diagnosis": "Sano", "confidence": 99, "status": "Resuelto", "farmer": "Rodrigo Vargas", "lat": -1.0215, "lng": -77.5510, "svgX": 80, "svgY": 190, "severity": "ninguna", "prescription": "" },
    { "id": "CS-012", "location": "Asociación Cacao Orellana", "region": "Orellana", "date": "2026-05-14", "diagnosis": "Mazorca Negra", "confidence": 87, "status": "En seguimiento", "farmer": "Elena Tapuy", "lat": -1.0330, "lng": -77.5330, "svgX": 410, "svgY": 320, "severity": "media", "prescription": "" }
  ];

  if (writeDb(INITIAL_CASES)) {
    console.log('[API] Database reset to initial mock cases.');
    
    // Broadcast reset trigger to connected clients
    broadcastUpdate({ type: 'RESET_DB', cases: INITIAL_CASES });
    
    res.json({ success: true, cases: INITIAL_CASES });
  } else {
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

// ─── Start servers (after async TLS init) ────────────────────────────────────
const init = async () => {
  await initTls();

  // HTTP server (port 5000)
  http.createServer(app).listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(` CocoaShield Central Backend`);
    console.log(` HTTP  → http://localhost:${PORT}`);
    console.log(` HTTP  → http://192.168.1.33:${PORT}`);
    if (tlsOptions) {
      console.log(` HTTPS → https://localhost:${HTTPS_PORT}  ← USAR EN MOVIL`);
      console.log(` HTTPS → https://192.168.1.33:${HTTPS_PORT}  ← USAR EN MOVIL`);
    }
    console.log(`===============================================`);
  });

  // HTTPS server (port 5443) — for Vercel-served mobile app
  if (tlsOptions) {
    https.createServer(tlsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`[TLS] ✅ Servidor HTTPS activo en puerto ${HTTPS_PORT}`);
    });
  } else {
    console.log('[TLS] ⚠️  Servidor HTTPS no iniciado (certificado no disponible).');
  }

  // Publish server details to cloud registry on startup
  await publishServerInfo();
};

init().catch(console.error);

