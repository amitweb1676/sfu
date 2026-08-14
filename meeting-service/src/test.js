// test.js
const express = require("express");
const app = express();
const PORT = 4006; // tum apna port change kar sakte ho

// Simple route
app.get("/", (req, res) => {
  res.send("Test server is running successfully!");
});

// Start server
app.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
})



console.log("========================================");
console.log(" [vinay.js] Test script executed successfully!");
console.log(` Author: Vinay Patel`);
console.log(` Timestamp: ${new Date().toISOString()}`);
console.log("========================================");