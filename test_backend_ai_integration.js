import fs from 'fs';

async function testBackendPredict() {
  console.log("Testing POST /api/predict through Backend to Cloud AI Microservice...");
  
  // 1x1 dummy PNG in base64
  const dummyBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  
  const payload = {
    image: dummyBase64,
    location: "Finca San José",
    region: "Napo",
    farmer: "Juan Carlos",
    lat: -1.025,
    lng: -77.545
  };

  try {
    const res = await fetch("http://localhost:5000/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    console.log("Backend status code:", res.status);
    const data = await res.json();
    console.log("Backend response data:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Test failed:", err);
  }
}

testBackendPredict();
