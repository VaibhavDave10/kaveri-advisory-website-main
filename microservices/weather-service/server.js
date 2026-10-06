// ──────────────────────────────────────────────────────────────────────
// Microservice 1: Weather Service (Node.js + Express)
// Port: 4001
// Responsibilities:
//   • Provide current weather data for a location
//   • Provide rainfall forecast (next 24h, 48h, 72h)
//   • Provide historical weather summaries
// ──────────────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

// ──── Simulated weather data by region ────
// In production this would call OpenWeatherMap, IMD, or a similar API.
// For the lab demo we return realistic but synthetic data.

const REGIONS = {
  sameerwadi:   { lat: 16.72, lon: 75.08, district: 'Bagalkot'   },
  belgaum:      { lat: 15.85, lon: 74.50, district: 'Belgaum'    },
  kolhapur:     { lat: 16.70, lon: 74.24, district: 'Kolhapur'   },
  sangli:       { lat: 16.85, lon: 74.56, district: 'Sangli'     },
  mandya:       { lat: 12.52, lon: 76.90, district: 'Mandya'     },
};

function generateWeather(region) {
  const base = REGIONS[region] || REGIONS.sameerwadi;
  const now  = new Date();
  const month = now.getMonth(); // 0-11

  // Monsoon months (Jun-Sep) → higher rainfall probability
  const isMonsoon = month >= 5 && month <= 8;
  const baseTemp  = isMonsoon ? 26 + Math.random() * 5 : 30 + Math.random() * 8;

  return {
    region,
    district: base.district,
    lat: base.lat,
    lon: base.lon,
    timestamp: now.toISOString(),
    current: {
      temperature_c:       parseFloat(baseTemp.toFixed(1)),
      humidity_pct:        parseFloat((isMonsoon ? 70 + Math.random() * 25 : 35 + Math.random() * 30).toFixed(1)),
      wind_speed_kmh:      parseFloat((5 + Math.random() * 20).toFixed(1)),
      wind_direction:      ['N','NE','E','SE','S','SW','W','NW'][Math.floor(Math.random()*8)],
      cloud_cover_pct:     parseFloat((isMonsoon ? 40 + Math.random() * 55 : 5 + Math.random() * 40).toFixed(0)),
      solar_radiation_wm2: parseFloat((isMonsoon ? 150 + Math.random() * 300 : 400 + Math.random() * 500).toFixed(0)),
      pressure_hpa:        parseFloat((1005 + Math.random() * 15).toFixed(1)),
    },
    evapotranspiration: {
      et0_mm_day: parseFloat((isMonsoon ? 3.0 + Math.random() * 2 : 5.0 + Math.random() * 3).toFixed(2)),
      method: 'Penman-Monteith (FAO 56)',
    }
  };
}

function generateRainfallForecast(region) {
  const base   = REGIONS[region] || REGIONS.sameerwadi;
  const now    = new Date();
  const month  = now.getMonth();
  const isMonsoon = month >= 5 && month <= 8;

  const hours = [6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72];

  const forecast = hours.map(h => {
    const futureDate = new Date(now.getTime() + h * 3600000);
    const rainProb   = isMonsoon
      ? Math.min(95, 30 + Math.random() * 65)
      : Math.min(40, Math.random() * 30);
    const rainAmt    = rainProb > 50 ? parseFloat((Math.random() * 20).toFixed(1)) : 0;

    return {
      hours_ahead: h,
      datetime: futureDate.toISOString(),
      rainfall_probability_pct: parseFloat(rainProb.toFixed(0)),
      rainfall_mm: rainAmt,
      temperature_c: parseFloat((25 + Math.random() * 10).toFixed(1)),
    };
  });

  // Summary for the advisory service
  const next24 = forecast.filter(f => f.hours_ahead <= 24);
  const next48 = forecast.filter(f => f.hours_ahead <= 48);
  const totalRain24 = next24.reduce((s, f) => s + f.rainfall_mm, 0);
  const totalRain48 = next48.reduce((s, f) => s + f.rainfall_mm, 0);
  const totalRain72 = forecast.reduce((s, f) => s + f.rainfall_mm, 0);
  const maxProb24   = Math.max(...next24.map(f => f.rainfall_probability_pct));

  return {
    region,
    district: base.district,
    generated_at: now.toISOString(),
    summary: {
      rainfall_next_24h_mm: parseFloat(totalRain24.toFixed(1)),
      rainfall_next_48h_mm: parseFloat(totalRain48.toFixed(1)),
      rainfall_next_72h_mm: parseFloat(totalRain72.toFixed(1)),
      max_rain_probability_24h_pct: maxProb24,
      rain_expected_24h: maxProb24 > 60,
    },
    hourly: forecast,
  };
}

// ──── Routes ────

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'weather-service',
    status: 'healthy',
    port: PORT,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// GET /weather/current?region=sameerwadi
app.get('/weather/current', (req, res) => {
  const region = (req.query.region || 'sameerwadi').toLowerCase();
  if (!REGIONS[region]) {
    return res.status(404).json({
      error: `Unknown region "${region}". Available: ${Object.keys(REGIONS).join(', ')}`
    });
  }
  res.json(generateWeather(region));
});

// GET /weather/forecast?region=sameerwadi
app.get('/weather/forecast', (req, res) => {
  const region = (req.query.region || 'sameerwadi').toLowerCase();
  if (!REGIONS[region]) {
    return res.status(404).json({
      error: `Unknown region "${region}". Available: ${Object.keys(REGIONS).join(', ')}`
    });
  }
  res.json(generateRainfallForecast(region));
});

// GET /weather/regions  — list all supported regions
app.get('/weather/regions', (req, res) => {
  res.json({
    regions: Object.entries(REGIONS).map(([key, val]) => ({
      id: key,
      district: val.district,
      lat: val.lat,
      lon: val.lon,
    }))
  });
});

// ──── Start ────
app.listen(PORT, () => {
  console.log(`\n🌦  Weather Service running on http://localhost:${PORT}`);
  console.log(`   GET /health`);
  console.log(`   GET /weather/current?region=sameerwadi`);
  console.log(`   GET /weather/forecast?region=sameerwadi`);
  console.log(`   GET /weather/regions\n`);
});
