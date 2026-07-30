// High-Accuracy Code 128 Barcode Scanner Module (Camera 0 First Priority + Explicit Camera Select)
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

export class BarcodeScanner {
  constructor(elementId, onScanCallback) {
    this.elementId = elementId;
    this.onScanCallback = onScanCallback;
    this.html5Qrcode = null;
    this.isScanning = false;
    this.availableCameras = [];
    this.currentCameraIndex = 0;
    this.isTorchOn = false;
  }

  async fetchCameras() {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        this.availableCameras = devices;
      }
      return this.availableCameras;
    } catch (err) {
      console.warn('Failed to fetch camera devices:', err);
      return [];
    }
  }

  async start(cameraIndex = 0) {
    if (this.isScanning) {
      await this.stop();
    }

    this.currentCameraIndex = cameraIndex;
    this.html5Qrcode = new Html5Qrcode(this.elementId);
    await this.fetchCameras();

    const config = {
      fps: 25,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minDim = Math.min(viewfinderWidth, viewfinderHeight);
        const width = Math.floor(minDim * 0.9);
        const height = Math.floor(width * 0.45);
        return { width: Math.max(width, 240), height: Math.max(height, 120) };
      },
      aspectRatio: 1.333333,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39
      ],
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: false
      }
    };

    const scanSuccess = (text, res) => {
      if (this.onScanCallback) this.onScanCallback(text, res);
    };
    const scanError = () => {};

    // 1. Mandatory Primary Attempt: Start Camera at specified index (Default 0 = Camera 0)
    if (this.availableCameras.length > 0) {
      const selectedIndex = this.currentCameraIndex % this.availableCameras.length;
      const targetDevice = this.availableCameras[selectedIndex];
      try {
        await this.html5Qrcode.start(
          { deviceId: targetDevice.id },
          config,
          scanSuccess,
          scanError
        );
        this.isScanning = true;
        this.applyAutofocusTrackConstraints();
        return targetDevice.label || `카메라 ${selectedIndex}`;
      } catch (err1) {
        console.warn(`Camera ${selectedIndex} failed, falling back:`, err1);
      }
    }

    // 2. Fallback: Environment facing mode
    try {
      await this.html5Qrcode.start(
        { facingMode: 'environment' },
        config,
        scanSuccess,
        scanError
      );
      this.isScanning = true;
      this.applyAutofocusTrackConstraints();
      return '후면 카메라';
    } catch (err2) {
      console.warn('Fallback environment camera failed:', err2);
    }

    // 3. Fallback: User facing camera
    try {
      await this.html5Qrcode.start(
        { facingMode: 'user' },
        config,
        scanSuccess,
        scanError
      );
      this.isScanning = true;
      this.applyAutofocusTrackConstraints();
      return '기본 카메라';
    } catch (err3) {
      console.error('All camera attempts failed:', err3);
      throw err3;
    }
  }

  async scanImageFile(file) {
    const tempScanner = new Html5Qrcode("interactiveScanner", {
      experimentalFeatures: { useBarCodeDetectorIfSupported: false }
    });
    try {
      const decodedText = await tempScanner.scanFileV2(file, true);
      tempScanner.clear();
      return decodedText.decodedText;
    } catch (err) {
      tempScanner.clear();
      throw new Error('이미지에서 바코드를 인지하지 못했습니다. 선명한 바코드 이미지를 선택해주세요.');
    }
  }

  applyAutofocusTrackConstraints() {
    try {
      const track = this.html5Qrcode.getRunningTrack();
      if (track && track.getCapabilities) {
        const capabilities = track.getCapabilities();
        const constraints = {};

        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
          constraints.focusMode = 'continuous';
        }

        if (Object.keys(constraints).length > 0) {
          track.applyConstraints({ advanced: [constraints] }).catch(() => {});
        }
      }
    } catch (e) {}
  }

  async stop() {
    if (!this.isScanning || !this.html5Qrcode) return;

    try {
      await this.html5Qrcode.stop();
      await this.html5Qrcode.clear();
    } catch (err) {
      console.warn('Scanner stop warning:', err);
    } finally {
      this.isScanning = false;
      this.html5Qrcode = null;
      this.isTorchOn = false;
    }
  }

  async toggleTorch() {
    if (!this.isScanning || !this.html5Qrcode) return false;

    try {
      const imageTrack = this.html5Qrcode.getRunningTrack();
      if (imageTrack && imageTrack.getCapabilities && imageTrack.getCapabilities().torch) {
        this.isTorchOn = !this.isTorchOn;
        await imageTrack.applyConstraints({
          advanced: [{ torch: this.isTorchOn }]
        });
        return this.isTorchOn;
      } else {
        throw new Error('플래시(Torch)를 지원하지 않는 카메라입니다.');
      }
    } catch (err) {
      throw err;
    }
  }

  async switchCamera() {
    if (this.availableCameras.length <= 1) return;
    const nextIndex = (this.currentCameraIndex + 1) % this.availableCameras.length;
    return await this.start(nextIndex);
  }
}
