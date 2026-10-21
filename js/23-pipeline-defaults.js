// Browser preview defaults. Keep in sync with pipeline.energy.defaults().
window.boundaryPipelineDefaults = {
  "settings": {
    "heating": 20,
    "cooling": 27,
    "groundTemperature": 18,
    "activityW": 120,
    "peopleRadiant": 0.3,
    "lightsRadiant": 0,
    "equipmentRadiant": 0.3,
    "equipmentLatent": 0,
    "peopleSchedule": [
      0.8,
      0.8,
      0.8,
      0.8,
      0.8,
      0.8,
      0.8,
      0.3,
      0.3,
      0.3,
      0.3,
      0.3,
      0.3,
      0.3,
      0.3,
      0.3,
      0.3,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ],
    "equipmentSchedule": [
      0.25,
      0.25,
      0.25,
      0.25,
      0.25,
      0.25,
      0.25,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ],
    "lightsSchedule": [
      0.25,
      0.25,
      0.25,
      0.25,
      0.25,
      0.25,
      0.25,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ],
    "ventilationSchedule": [
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ],
    "infiltrationSchedule": [
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ],
    "hvacSchedule": [
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ],
    "hvacMode": "hourly",
    "heatingPeriods": [],
    "coolingPeriods": [],
    "reviewed": false
  },
  "constructions": {
    "wall": {
      "label": "仮定：木造断熱壁",
      "layers": [
        {
          "thickness": 0.012,
          "conductivity": 0.14,
          "density": 600,
          "specificHeat": 1600
        },
        {
          "thickness": 0.1,
          "conductivity": 0.04,
          "density": 24,
          "specificHeat": 840
        },
        {
          "thickness": 0.0125,
          "conductivity": 0.22,
          "density": 800,
          "specificHeat": 1090
        }
      ]
    },
    "roof": {
      "label": "仮定：断熱屋根",
      "layers": [
        {
          "thickness": 0.012,
          "conductivity": 0.14,
          "density": 600,
          "specificHeat": 1600
        },
        {
          "thickness": 0.2,
          "conductivity": 0.04,
          "density": 24,
          "specificHeat": 840
        },
        {
          "thickness": 0.0125,
          "conductivity": 0.22,
          "density": 800,
          "specificHeat": 1090
        }
      ]
    },
    "floor": {
      "label": "仮定：断熱床",
      "layers": [
        {
          "thickness": 0.1,
          "conductivity": 0.04,
          "density": 24,
          "specificHeat": 840
        },
        {
          "thickness": 0.024,
          "conductivity": 0.14,
          "density": 600,
          "specificHeat": 1600
        }
      ]
    },
    "partition": {
      "label": "仮定：対称間仕切り",
      "cfdMaterial": "2杉(1)",
      "cfdThickness": 0.03,
      "layers": [
        {
          "thickness": 0.0125,
          "conductivity": 0.22,
          "density": 800,
          "specificHeat": 1090
        },
        {
          "thickness": 0.08,
          "conductivity": 0.04,
          "density": 24,
          "specificHeat": 840
        },
        {
          "thickness": 0.0125,
          "conductivity": 0.22,
          "density": 800,
          "specificHeat": 1090
        }
      ]
    },
    "window": {
      "label": "仮定：複層窓",
      "cfdMaterial": "1ガラス板(Low-E複層)",
      "cfdThickness": 0.006,
      "u": 2.3,
      "shgc": 0.5,
      "visibleTransmittance": 0.6
    },
    "door": {
      "label": "仮定：木製ドア",
      "cfdMaterial": "2杉(1)",
      "cfdThickness": 0.04,
      "layers": [
        {
          "thickness": 0.04,
          "conductivity": 0.14,
          "density": 600,
          "specificHeat": 1600
        }
      ]
    }
  }
};
