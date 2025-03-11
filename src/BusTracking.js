import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";
import { io } from "socket.io-client";
import "./App.css";

const defaultPosition = [-1.286389, 36.817223]; // Nairobi coordinates
const socket = io("http://localhost:5000"); // WebSocket connection

// Fix missing marker icons in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

const BusTracking = () => {
  const [busData, setBusData] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchBusData = async () => {
      try {
        const response = await axios.get("http://localhost:5000/api/buses");
        setBusData(response.data);
      } catch (err) {
        console.error("Error fetching bus data:", err);
        setError("Failed to load bus data");
      }
    };

    fetchBusData();

    // Listen to WebSocket updates
    socket.on("busUpdate", (updatedBus) => {
      setBusData((prevBuses) =>
        prevBuses.map((bus) => (bus.id === updatedBus.id ? updatedBus : bus))
      );
    });

    return () => {
      socket.off("busUpdate");
    };
  }, []);

  return (
    <div className="bus-tracking-container">
      <h2 className="bus-tracking-header">Real-Time Bus Tracking</h2>
      {error && <p className="error-message">{error}</p>}

      <MapContainer
        center={defaultPosition}
        zoom={12}
        style={{ height: "600px", width: "100%" }}
      >
        <TileLayer
          url={`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`}
          attribution="&copy; OpenStreetMap contributors"
        />

        {busData.map((bus) => (
          <Marker key={bus.id} position={[bus.current_lat, bus.current_lng]}>
            <Popup>
              <b>Bus {bus.bus_number}</b>
              <br />
              Status: {bus.status}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default BusTracking;
