-- idempotent schema for the vanlife D1 database
CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL UNIQUE,   -- unix seconds (unique = free dedupe on retries)
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  elevation_m REAL,
  temp_c REAL,
  feels_c REAL,
  humidity REAL,
  wind_kmh REAL,
  weather_code INTEGER,         -- WMO weather code
  speed_kmh REAL,
  battery REAL,                 -- 0-100
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
