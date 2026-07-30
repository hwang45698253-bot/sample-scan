import { startTunnel } from 'untun';
import fs from 'fs';
import qrcode from 'qrcode';

async function main() {
  try {
    const tunnel = await startTunnel({ port: 5173 });
    const url = await tunnel.getURL();
    console.log('CLOUDFLARE_TUNNEL_URL:', url);

    fs.writeFileSync('cloudflare_url.txt', url);

    // Save QR Code PNG for mobile
    await qrcode.toFile(
      'C:/Users/hwang/.gemini/antigravity/brain/556ab1cc-2629-43ac-bdb5-20b7a1a239a1/connect_qr.png',
      url,
      { width: 400 }
    );
    console.log('QR Code generated successfully for:', url);
  } catch (err) {
    console.error('Tunnel start error:', err);
  }
}

main();
