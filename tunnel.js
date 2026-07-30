import localtunnel from 'localtunnel';
import fs from 'fs';
import qrcode from 'qrcode';

(async () => {
  try {
    const tunnel = await localtunnel({ port: 5173 });
    console.log('Tunnel URL:', tunnel.url);
    fs.writeFileSync('tunnel_url.txt', tunnel.url);

    // Save QR Code PNG for mobile
    await qrcode.toFile(
      'C:/Users/hwang/.gemini/antigravity/brain/556ab1cc-2629-43ac-bdb5-20b7a1a239a1/connect_qr.png',
      tunnel.url,
      { width: 400 }
    );
    console.log('QR Code generated for:', tunnel.url);

    tunnel.on('close', () => {
      console.log('Tunnel closed');
    });
  } catch (err) {
    console.error('Tunnel error:', err);
  }
})();
