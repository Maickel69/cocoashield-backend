-- CocoaShield Cloud Database Schema (Supabase / PostgreSQL + PostGIS)

-- Habilitar extensión espacial para coordenadas de fincas y focos de infección
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Tabla de Usuarios y Fincas Cacaoteras
CREATE TABLE IF NOT EXISTS fincas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_finca VARCHAR(255) NOT NULL,
    propietario VARCHAR(255) NOT NULL,
    sector VARCHAR(255),
    provincia VARCHAR(255) DEFAULT 'Napo',
    area_hectareas NUMERIC(10, 2),
    ubicacion GEOMETRY(Point, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Casos Epidemiológicos y Diagnósticos de IA
CREATE TABLE IF NOT EXISTS casos_epidemiologicos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finca_id UUID REFERENCES fincas(id) ON DELETE SET NULL,
    diagnostico VARCHAR(100) NOT NULL, -- Monilia, Mazorca Negra, Escoba de Bruja, Sano
    nombre_cientifico VARCHAR(150),
    confianza_porcentaje NUMERIC(5, 2) NOT NULL,
    nivel_severidad VARCHAR(50), -- Alta, Media, Ninguna
    url_imagen_cloud TEXT NOT NULL,
    latitud NUMERIC(10, 8) NOT NULL,
    longitud NUMERIC(11, 8) NOT NULL,
    tratamiento_recomendado TEXT,
    modelo_utilizado VARCHAR(150),
    tiempo_procesamiento_ms NUMERIC(8, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Lecturas de Sensores IoT Microclimáticos (ESP32)
CREATE TABLE IF NOT EXISTS lecturas_sensores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finca_id UUID REFERENCES fincas(id) ON DELETE CASCADE,
    dispositivo_id VARCHAR(100) NOT NULL,
    temperatura_celsius NUMERIC(5, 2) NOT NULL,
    humedad_relativa NUMERIC(5, 2) NOT NULL,
    riesgo_estimado VARCHAR(50), -- Alto, Medio, Bajo
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices Espaciales para consultas ultra-rápidas del Dashboard en la nube
CREATE INDEX IF NOT EXISTS idx_casos_lat_lon ON casos_epidemiologicos(latitud, longitud);
CREATE INDEX IF NOT EXISTS idx_casos_diagnostico ON casos_epidemiologicos(diagnostico);
CREATE INDEX IF NOT EXISTS idx_sensores_created ON lecturas_sensores(created_at DESC);
