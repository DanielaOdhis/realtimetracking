const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 5000;
const ORS_API_KEY = process.env.ORS_API_KEY; // OpenRouteService API Key

app.use(cors());
app.use(express.json());

// MySQL Database Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

db.connect(err => {
    if (err) {
        console.error('❌ Database connection failed:', err);
        return;
    }
    console.log('✅ Connected to MySQL Database');
});

// Define start and end locations
const routes = {
    "Juja-Nairobi": { start: { lat: -1.1278, lng: 36.9707 }, end: { lat: -1.286389, lng: 36.817223 } },
    "Nairobi-Juja": { start: { lat: -1.286389, lng: 36.817223 }, end: { lat: -1.1278, lng: 36.9707 } }
};

// Store route for each bus
const busRoutes = {};
const busPositions = {};

// Fetch route from OpenRouteService
const getRoute = async (start, end) => {
    try {
        const response = await axios.post(
            "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
            { coordinates: [[start.lng, start.lat], [end.lng, end.lat]] },
            { headers: { Authorization: ORS_API_KEY } }
        );

        if (response.data.features.length > 0) {
            return response.data.features[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        }
    } catch (error) {
        console.error("❌ Error fetching route:", error);
    }
    return [];
};

const updateBusLocations = () => {
  db.query("SELECT id, bus_number, step_index FROM buses WHERE status = 'active'", async (err, buses) => {
      if (err) {
          console.error("❌ Error fetching buses:", err);
          return;
      }

      for (const bus of buses) {
          const busId = bus.id;

          // Assign independent route based on bus number
          let routeKey = bus.bus_number.includes("Juja") ? "Juja-Nairobi" : "Nairobi-Juja";
          const { start, end } = routes[routeKey];

          // Ensure each bus has its own route & tracking index
          if (!busRoutes[busId]) {
              busRoutes[busId] = await getRoute(start, end);
              busPositions[busId] = bus.step_index || 0; // Resume from DB
          }

          const route = busRoutes[busId]; // This is now unique for each bus

          if (route.length > 0 && busPositions[busId] < route.length - 1) {
              busPositions[busId]++; // Move one step forward
              const nextStop = route[busPositions[busId]];

              // Update database with new position
              db.query(
                  "UPDATE buses SET current_lat = ?, current_lng = ?, step_index = ? WHERE id = ?",
                  [nextStop.lat, nextStop.lng, busPositions[busId], busId]
              );

              // Emit update to frontend
              io.emit("busUpdate", {
                  id: busId,
                  bus_number: bus.bus_number,
                  current_lat: nextStop.lat,
                  current_lng: nextStop.lng,
                  status: "active",
              });

          } else {
              // Reset bus when it reaches the destination
              db.query(
                  "UPDATE buses SET current_lat = ?, current_lng = ?, step_index = 0 WHERE id = ?",
                  [start.lat, start.lng, busId]
              );

              // Reset route variables for this specific bus
              busRoutes[busId] = await getRoute(start, end);
              busPositions[busId] = 0;

              // Emit update to reset bus position
              io.emit("busUpdate", {
                  id: busId,
                  bus_number: bus.bus_number,
                  current_lat: start.lat,
                  current_lng: start.lng,
                  status: "active",
              });
          }
      }
  });
};

// Move bus step-by-step every 5 seconds
setInterval(updateBusLocations, 5000);


// API Endpoint to fetch all active buses (Fixes 404 error)
app.get('/api/buses', (req, res) => {
    db.query("SELECT * FROM buses WHERE status = 'active'", (err, results) => {
        if (err) {
            console.error("❌ Error fetching buses:", err);
            return res.status(500).json({ error: "Internal Server Error" });
        }
        res.json(results);
    });
});

// WebSocket connection
io.on("connection", (socket) => {
    console.log("🔗 New WebSocket connection");

    db.query("SELECT * FROM buses WHERE status = 'active'", (err, results) => {
        if (!err) {
            socket.emit("busUpdate", results);
        }
    });

    socket.on("disconnect", () => {
        console.log("❌ WebSocket disconnected");
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});