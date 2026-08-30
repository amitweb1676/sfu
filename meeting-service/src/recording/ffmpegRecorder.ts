import { spawn, ChildProcess } from " child_process\;
import fs from \fs\;
import path from \path\;
import config from \../config/recording.config\;

export interface RtpParameters {
 ip: string;
 port: number;
 payloadType: number;
 codec: string;
 clockRate: number;
 kind: string;
 channels?: number;
}

export function buildSdp({ ip, port, payloadType, codec, clockRate, kind, channels = 1 }: RtpParameters): string {
 const lines = [
 \v=0\,
 \o=- 0 0 IN IP4 \ + ip,
 \s=MediasoupRecording\,
 \c=IN IP4 \ + ip,
 \t=0 0\,
 m= RTP/AVP ,
 =rtpmap: / + (channels > 1 ? / : \\),
 ];
 return lines.join(\\n\);
}

export function startRecording({
 roomId,
 participantId,
 audioRtp,
 videoRtp,
}: {
 roomId: string;
 participantId: string;
 audioRtp: RtpParameters;
 videoRtp: RtpParameters;
}): { ffmpegProcess: ChildProcess; outputFile: string } {
 const outDir = path.join(config.RECORDING_DIR, roomId);
 if (!fs.existsSync(outDir)) {
 fs.mkdirSync(outDir, { recursive: true });
 }

 const outputFile = path.join(outDir, ${participantId}_.mp4);
 const audioSdpPath = path.join(outDir, ${participantId}_audio.sdp);
 const videoSdpPath = path.join(outDir, ${participantId}_video.sdp);

 fs.writeFileSync(audioSdpPath, buildSdp(audioRtp));
 fs.writeFileSync(videoSdpPath, buildSdp(videoRtp));

 const args = [
 \-protocol_whitelist\,
 \file,udp,rtp\,
 \-i\,
 audioSdpPath,
 \-protocol_whitelist\,
 \file,udp,rtp\,
 \-i\,
 videoSdpPath,
 \-map\,
 \0:a\,
 \-map\,
 \1:v\,
 \-c:a\,
 \aac\,
 \-c:v\,
 \libx264\,
 \-preset\,
 \veryfast\,
 outputFile,
 ];

 const ffmpegProcess = spawn(config.FFMPEG_PATH, args);

 ffmpegProcess.stderr?.on(\data\, () => {
 // intentionally silent
 });

 return { ffmpegProcess, outputFile };
}

export function stopRecording(ffmpegProcess: ChildProcess): void {
 if (ffmpegProcess && !ffmpegProcess.killed) {
 try {
 ffmpegProcess.stdin?.write(\q\);
 ffmpegProcess.kill(\SIGINT\);
 } catch {
 // Safe fallback
 }
 }
}
