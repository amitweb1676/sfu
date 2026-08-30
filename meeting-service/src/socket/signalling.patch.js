/**
 * Registration Snippet for meeting-service/src/socket/signalling.js
 * 
 * Add these 2 lines into your existing signalling.js connection block:
 */

// 1. Top of file import:
const { registerRecordingEvents } = require("./recordingEvents");

// 2. Inside your per-socket / per-connection handler (where io, socket, room are available):
// registerRecordingEvents(io, socket, room);
