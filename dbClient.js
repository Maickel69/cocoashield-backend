import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'db.json');
const SEED_PATH = path.join(__dirname, 'seedCases.json');

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

let pool = null;
if (connectionString) {
  try {
    const pkg = await import('pg');
    const Pool = pkg.default?.Pool || pkg.Pool;
    if (Pool) {
      pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
      });
      console.log('[Supabase DB] ✅ Conector PostgreSQL activo');
    }
  } catch (err) {
    console.log('[Supabase DB] Conector PostgreSQL opcional no disponible:', err.message);
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
      if (res.rows && res.rows.length > 0) {
        return res.rows.map(r => ({
          ...r,
          image: r.image || r.photo || '',
          photo: r.image || r.photo || ''
        }));
      }
    } catch (err) {
      console.error('[Supabase DB] Error leyendo casos:', err.message);
    }
  }

  // Fallback a db.json local
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        return data.map(r => ({
          ...r,
          image: r.image || r.photo || '',
          photo: r.image || r.photo || ''
        }));
      }
    }
  } catch (err) {
    console.error('[DB Local] Error leyendo db.json:', err.message);
  }

  // Fallback a seedCases.json
  try {
    if (fs.existsSync(SEED_PATH)) {
      const seeds = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
      fs.writeFileSync(DB_PATH, JSON.stringify(seeds, null, 2), 'utf8');
      return seeds;
    }
  } catch (err) {
    console.error('[DB Seed] Error leyendo seedCases.json:', err.message);
  }

  return [];
};

// ─── Insertar Caso ──────────────────────────────────────────────────────────
export const saveCaseToDb = async (caseObj) => {
  const normalized = {
    ...caseObj,
    image: caseObj.image || caseObj.photo || '',
    photo: caseObj.image || caseObj.photo || ''
  };

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
        normalized.diagnosis || 'Sano',
        normalized.scientificName || 'Theobroma cacao',
        normalized.confidence || 95.0,
        normalized.severity || 'Media',
        normalized.image || '',
        normalized.lat || -1.0234,
        normalized.lng || -77.5432,
        normalized.prescription || '',
        normalized.model || 'Direct Gemini-1.5-Flash Vision'
      ];
      await pool.query(query, values);
    } catch (err) {
      console.error('[Supabase DB] Error guardando caso en Postgres:', err.message);
    }
  }

  // Fallback / persistencia en db.json
  try {
    let current = [];
    if (fs.existsSync(DB_PATH)) {
      current = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } else if (fs.existsSync(SEED_PATH)) {
      current = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    }
    const updated = [normalized, ...current.filter(c => c.id !== normalized.id)];
    fs.writeFileSync(DB_PATH, JSON.stringify(updated, null, 2), 'utf8');
    return normalized;
  } catch (err) {
    console.error('[DB Local] Error guardando en db.json:', err.message);
    return normalized;
  }
};
