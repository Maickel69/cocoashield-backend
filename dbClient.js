import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'db.json');

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

let pool = null;
if (connectionString) {
  try {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
    console.log('[Supabase DB] ✅ Conector PostgreSQL activo');
  } catch (err) {
    console.error('[Supabase DB] ⚠️ Error inicializando pool Postgres:', err.message);
  }
}

// ─── Leer Casos ─────────────────────────────────────────────────────────────
export const getCasesFromDb = async () => {
  if (pool) {
    try {
      const res = await pool.query(`
        SELECT 
          id, 
          diagnostico AS diagnosis, 
          confianza_porcentaje AS confidence, 
          nivel_severidad AS severity, 
          url_imagen_cloud AS image, 
          latitud AS lat, 
          longitud AS lng, 
          tratamiento_recomendado AS prescription,
          created_at AS date
        FROM casos_epidemiologicos
        ORDER BY created_at DESC
      `);
      return res.rows;
    } catch (err) {
      console.error('[Supabase DB] Error leyendo casos:', err.message);
    }
  }

  // Fallback a db.json local
  try {
    if (!fs.existsSync(DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return [];
  }
};

// ─── Insertar Caso ──────────────────────────────────────────────────────────
export const saveCaseToDb = async (caseObj) => {
  if (pool) {
    try {
      const query = `
        INSERT INTO casos_epidemiologicos (
          diagnostico, nombre_cientifico, confianza_porcentaje, nivel_severidad, 
          url_imagen_cloud, latitud, longitud, tratamiento_recomendado, modelo_utilizado
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      const values = [
        caseObj.diagnosis || 'Sano',
        caseObj.scientificName || 'Theobroma cacao',
        caseObj.confidence || 95.0,
        caseObj.severity || 'Media',
        caseObj.image || '',
        caseObj.lat || -1.0234,
        caseObj.lng || -77.5432,
        caseObj.prescription || '',
        caseObj.model || 'Cloud AI ResNet-50'
      ];
      const res = await pool.query(query, values);
      return res.rows[0];
    } catch (err) {
      console.error('[Supabase DB] Error guardando caso en Postgres:', err.message);
    }
  }

  // Fallback a db.json
  try {
    const current = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) : [];
    const updated = [caseObj, ...current];
    fs.writeFileSync(DB_PATH, JSON.stringify(updated, null, 2), 'utf8');
    return caseObj;
  } catch (err) {
    console.error('[DB Local] Error guardando en db.json:', err.message);
    return null;
  }
};
