"""
──────────────────────────────────────────────────────────────────────
Microservice 2: AI Advisory Service (Python / Flask)
Port: 4002
Responsibilities:
  • Accept plot data (soil moisture, crop age, soil type, variety)
  • Fetch weather from the Weather Service (port 4001)
  • Run rule-based + simple ML-style logic to produce an irrigation advisory
  • Return advisory in plain language (English + Kannada/Hindi summary)
──────────────────────────────────────────────────────────────────────
"""

import os
import math
import random
import datetime
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

PORT = int(os.environ.get("PORT", 4002))
WEATHER_SERVICE_URL = os.environ.get("WEATHER_SERVICE_URL", "http://localhost:4001")

# ──── Crop coefficient (Kc) table for sugarcane by growth stage ────
# Source: FAO Irrigation & Drainage Paper 56
SUGARCANE_KC = {
    "germination":       {"months": (0, 1.5),  "kc": 0.40},
    "tillering":         {"months": (1.5, 4),   "kc": 0.75},
    "grand_growth":      {"months": (4, 8),     "kc": 1.25},
    "maturation":        {"months": (8, 12),    "kc": 0.80},
    "ripening":          {"months": (12, 14),   "kc": 0.60},
}

# ──── Soil types and their water-holding properties ────
SOIL_PROFILES = {
    "black_cotton":   {"awc_mm_m": 200, "fc_pct": 42, "pwp_pct": 22, "infiltration_mm_hr": 8},
    "red_laterite":   {"awc_mm_m": 120, "fc_pct": 30, "pwp_pct": 14, "infiltration_mm_hr": 15},
    "alluvial":       {"awc_mm_m": 160, "fc_pct": 35, "pwp_pct": 16, "infiltration_mm_hr": 12},
    "sandy_loam":     {"awc_mm_m": 100, "fc_pct": 24, "pwp_pct": 10, "infiltration_mm_hr": 25},
    "clay_loam":      {"awc_mm_m": 180, "fc_pct": 38, "pwp_pct": 20, "infiltration_mm_hr": 6},
}

# ──── Sugarcane varieties and their water sensitivity ────
VARIETIES = {
    "CO_86032":    {"water_sensitivity": 1.0,  "peak_demand_mm": 7.5},
    "CO_0238":     {"water_sensitivity": 0.9,  "peak_demand_mm": 7.0},
    "COC_671":     {"water_sensitivity": 1.1,  "peak_demand_mm": 8.0},
    "CO_92005":    {"water_sensitivity": 0.85, "peak_demand_mm": 6.5},
    "VSI_434":     {"water_sensitivity": 1.05, "peak_demand_mm": 7.2},
}


def get_growth_stage(crop_age_months):
    """Determine growth stage from crop age in months."""
    for stage, info in SUGARCANE_KC.items():
        low, high = info["months"]
        if low <= crop_age_months < high:
            return stage, info["kc"]
    return "ripening", 0.60  # default fallback


def fetch_weather(region):
    """Call the Weather Service to get current conditions and forecast."""
    weather = {"current": None, "forecast": None, "available": False}
    try:
        current_resp = requests.get(
            f"{WEATHER_SERVICE_URL}/weather/current",
            params={"region": region},
            timeout=5
        )
        forecast_resp = requests.get(
            f"{WEATHER_SERVICE_URL}/weather/forecast",
            params={"region": region},
            timeout=5
        )
        if current_resp.status_code == 200 and forecast_resp.status_code == 200:
            weather["current"]   = current_resp.json()
            weather["forecast"]  = forecast_resp.json()
            weather["available"] = True
    except requests.exceptions.RequestException:
        pass  # Weather service down — advisory will use defaults
    return weather


def compute_advisory(plot_data, weather):
    """
    Core advisory engine.
    Uses a simplified version of the FAO water-balance approach:
      ETc = Kc × ET0
      Net irrigation requirement = ETc − effective rainfall
    Combined with soil moisture depletion analysis.
    """

    soil_moisture  = plot_data.get("soil_moisture_pct", 25)
    crop_age       = plot_data.get("crop_age_months", 6)
    soil_type      = plot_data.get("soil_type", "black_cotton")
    variety        = plot_data.get("variety", "CO_86032")
    root_depth_m   = plot_data.get("root_depth_m", 0.6)
    plot_area_ha   = plot_data.get("plot_area_ha", 1.0)

    # Look up tables
    soil   = SOIL_PROFILES.get(soil_type, SOIL_PROFILES["black_cotton"])
    var    = VARIETIES.get(variety, VARIETIES["CO_86032"])
    stage, kc = get_growth_stage(crop_age)

    # ── ET0 from weather service or default ──
    et0 = 5.5  # mm/day default
    if weather["available"] and weather["current"]:
        et0 = weather["current"].get("evapotranspiration", {}).get("et0_mm_day", 5.5)

    # ── Crop water demand ──
    etc = kc * et0 * var["water_sensitivity"]

    # ── Effective rainfall from forecast ──
    effective_rain_24h = 0
    rain_expected = False
    if weather["available"] and weather["forecast"]:
        summary = weather["forecast"].get("summary", {})
        raw_rain = summary.get("rainfall_next_24h_mm", 0)
        effective_rain_24h = raw_rain * 0.7  # ~70% effective
        rain_expected = summary.get("rain_expected_24h", False)

    # ── Soil moisture analysis ──
    fc  = soil["fc_pct"]
    pwp = soil["pwp_pct"]
    awc = fc - pwp  # available water capacity as %

    # Management Allowed Depletion (MAD) — irrigate when 50% of AWC is depleted
    mad_threshold = fc - (awc * 0.50)

    # Water stress index (0 = no stress, 1 = permanent wilting point)
    if awc > 0:
        stress_index = max(0, min(1, (fc - soil_moisture) / awc))
    else:
        stress_index = 0.5

    if stress_index < 0.3:
        stress_level = "Low"
    elif stress_index < 0.6:
        stress_level = "Medium"
    else:
        stress_level = "High"

    # ── Irrigation decision ──
    needs_irrigation = soil_moisture <= mad_threshold
    net_requirement_mm = max(0, etc - effective_rain_24h)

    # If rain is coming and stress is low, skip irrigation
    if rain_expected and stress_index < 0.5:
        needs_irrigation = False
        decision_reason = "rainfall_expected"
    elif not needs_irrigation:
        decision_reason = "moisture_adequate"
    else:
        decision_reason = "moisture_depleted"

    # ── Irrigation depth & duration ──
    deficit_mm = max(0, (fc - soil_moisture) / 100 * root_depth_m * 1000)
    irrigation_depth_mm = deficit_mm if needs_irrigation else 0

    # Duration based on infiltration rate
    infiltration = soil["infiltration_mm_hr"]
    duration_hours = (irrigation_depth_mm / infiltration) if infiltration > 0 else 0

    # Volume in litres
    volume_litres = irrigation_depth_mm * plot_area_ha * 10000  # 1mm on 1m² = 1L

    # ── Days until next irrigation ──
    if needs_irrigation:
        days_until = 0  # irrigate today/tomorrow
    else:
        remaining_mm = (soil_moisture - mad_threshold) / 100 * root_depth_m * 1000
        days_until = max(1, int(remaining_mm / net_requirement_mm)) if net_requirement_mm > 0 else 3

    # ── Yield loss estimate from delay ──
    # Simple linear model: each day of stress beyond threshold → ~0.8% yield loss
    yield_loss_per_day = 0.8 * stress_index * var["water_sensitivity"]

    # ── Generate plain-language advisory ──
    if needs_irrigation:
        if duration_hours < 1:
            dur_text = f"{int(duration_hours * 60)} minutes"
        else:
            dur_text = f"{duration_hours:.1f} hours"

        advisory_text = (
            f"Irrigate {'today' if days_until == 0 else 'tomorrow morning'} "
            f"for {dur_text}. Soil moisture is at {soil_moisture}% which is "
            f"below the optimal threshold of {mad_threshold:.0f}%. "
            f"{'No rainfall is expected in the next 24 hours.' if not rain_expected else ''}"
        )
        urgency = "high" if stress_index > 0.6 else "medium"
    else:
        if decision_reason == "rainfall_expected":
            advisory_text = (
                f"Skip irrigation today. Rainfall of ~{effective_rain_24h:.0f}mm is expected "
                f"in the next 24 hours. Current soil moisture is {soil_moisture}% which is adequate. "
                f"Check again after the rain."
            )
            urgency = "low"
        else:
            advisory_text = (
                f"No irrigation needed right now. Soil moisture is at {soil_moisture}% "
                f"(threshold: {mad_threshold:.0f}%). Next irrigation estimated in "
                f"{days_until} day{'s' if days_until > 1 else ''}."
            )
            urgency = "low"

    # ── Kannada summary ──
    if needs_irrigation:
        advisory_kannada = (
            f"ನಾಳೆ ಬೆಳಿಗ್ಗೆ {dur_text} ನೀರು ಕೊಡಿ. "
            f"ಮಣ್ಣಿನ ತೇವಾಂಶ {soil_moisture}% ಕಡಿಮೆ ಇದೆ."
        )
    else:
        advisory_kannada = "ಇಂದು ನೀರು ಅಗತ್ಯವಿಲ್ಲ. ಮಣ್ಣಿನ ತೇವಾಂಶ ಸಾಕಾಗಿದೆ."

    # ── Hindi summary ──
    if needs_irrigation:
        advisory_hindi = (
            f"कल सुबह {dur_text} सिंचाई करें। "
            f"मिट्टी की नमी {soil_moisture}% कम है।"
        )
    else:
        advisory_hindi = "आज सिंचाई की आवश्यकता नहीं है। मिट्टी की नमी पर्याप्त है।"

    return {
        "plot_id": plot_data.get("plot_id", "PLOT-001"),
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "growth_stage": stage,
        "crop_coefficient_kc": kc,
        "analysis": {
            "et0_mm_day": round(et0, 2),
            "etc_mm_day": round(etc, 2),
            "effective_rainfall_24h_mm": round(effective_rain_24h, 1),
            "net_irrigation_requirement_mm": round(net_requirement_mm, 2),
            "soil_moisture_pct": soil_moisture,
            "field_capacity_pct": fc,
            "wilting_point_pct": pwp,
            "mad_threshold_pct": round(mad_threshold, 1),
            "water_stress_index": round(stress_index, 2),
            "stress_level": stress_level,
        },
        "recommendation": {
            "irrigate": needs_irrigation,
            "urgency": urgency,
            "decision_reason": decision_reason,
            "irrigation_depth_mm": round(irrigation_depth_mm, 1),
            "duration_hours": round(duration_hours, 2),
            "volume_litres": round(volume_litres, 0),
            "days_until_next_irrigation": days_until,
            "yield_loss_pct_per_day_delay": round(yield_loss_per_day, 2),
        },
        "advisory": {
            "en": advisory_text.strip(),
            "kn": advisory_kannada,
            "hi": advisory_hindi,
        },
        "weather_data_available": weather["available"],
    }


# ──── Routes ────

@app.route("/health", methods=["GET"])
def health():
    # Also check if weather service is reachable
    weather_ok = False
    try:
        r = requests.get(f"{WEATHER_SERVICE_URL}/health", timeout=3)
        weather_ok = r.status_code == 200
    except Exception:
        pass

    return jsonify({
        "service": "advisory-service",
        "status": "healthy",
        "port": PORT,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "dependencies": {
            "weather_service": {
                "url": WEATHER_SERVICE_URL,
                "reachable": weather_ok,
            }
        },
    })


@app.route("/advisory/irrigate", methods=["POST"])
def irrigate_advisory():
    """
    Main advisory endpoint.
    
    POST JSON body:
    {
        "plot_id": "PLOT-12",
        "soil_moisture_pct": 24.4,
        "crop_age_months": 6.2,
        "soil_type": "black_cotton",
        "variety": "CO_86032",
        "region": "sameerwadi",
        "root_depth_m": 0.6,
        "plot_area_ha": 1.0
    }
    """
    data = request.get_json(force=True, silent=True) or {}

    required = ["soil_moisture_pct", "crop_age_months"]
    missing  = [f for f in required if f not in data]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    region  = data.get("region", "sameerwadi").lower()
    weather = fetch_weather(region)
    result  = compute_advisory(data, weather)

    return jsonify(result), 200


@app.route("/advisory/batch", methods=["POST"])
def batch_advisory():
    """
    Batch endpoint — accepts a list of plots and returns advisories for all.
    POST JSON body: { "plots": [ {...}, {...} ] }
    """
    data  = request.get_json(force=True, silent=True) or {}
    plots = data.get("plots", [])

    if not plots:
        return jsonify({"error": "Provide a 'plots' array with at least one plot."}), 400

    # Fetch weather once (assume all plots are in same region)
    region  = plots[0].get("region", "sameerwadi").lower()
    weather = fetch_weather(region)

    results = []
    for plot in plots:
        results.append(compute_advisory(plot, weather))

    return jsonify({
        "count": len(results),
        "advisories": results,
    }), 200


@app.route("/advisory/soil-types", methods=["GET"])
def soil_types():
    """List all supported soil types and their properties."""
    return jsonify({"soil_types": SOIL_PROFILES})


@app.route("/advisory/varieties", methods=["GET"])
def varieties():
    """List all supported sugarcane varieties."""
    return jsonify({"varieties": VARIETIES})


@app.route("/advisory/growth-stages", methods=["GET"])
def growth_stages():
    """List all growth stages and Kc values."""
    return jsonify({"growth_stages": SUGARCANE_KC})


# ──── Start ────
if __name__ == "__main__":
    print(f"\n[ADVISORY] Advisory Service running on http://localhost:{PORT}")
    print(f"   POST /advisory/irrigate")
    print(f"   POST /advisory/batch")
    print(f"   GET  /advisory/soil-types")
    print(f"   GET  /advisory/varieties")
    print(f"   GET  /advisory/growth-stages")
    print(f"   GET  /health\n")
    app.run(host="0.0.0.0", port=PORT, debug=True)
