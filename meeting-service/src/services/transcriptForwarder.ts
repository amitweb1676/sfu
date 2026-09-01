import axios from 'axios';
import { config } from '../config';

export async function forwardFinalChunk(chunk: any): Promise<void> {
  try {
    const baseUrl = (config.mainBackendBaseUrl || 'http://localhost:5000').replace(/\/+$/, '');
    await axios.post(
      baseUrl + '/api/transcript/save',
      { chunk },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(config.mainBackendServiceToken ? { 'x-service-token': config.mainBackendServiceToken } : {}),
        },
        timeout: config.mainBackendTimeoutMs || 5000,
      }
    );
  } catch (err: any) {
    console.error('[transcriptForwarder] forward to backend failed:', err?.message);
  }
}

export default { forwardFinalChunk };