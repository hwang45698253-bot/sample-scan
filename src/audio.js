// Web Audio API & Haptic Vibration Module for Scan Feedback

class AudioController {
  constructor() {
    this.audioCtx = null;
    this.soundEnabled = true;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
  }

  playScanBeep() {
    if (!this.soundEnabled) return;
    this.init();

    if (!this.audioCtx) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      // Crisp high pitch beep tone (1800Hz rising to 2400Hz)
      osc.frequency.setValueAtTime(1800, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(2400, this.audioCtx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(this.audioCtx.currentTime);
      osc.stop(this.audioCtx.currentTime + 0.12);
    } catch (err) {
      console.warn('Audio play failed:', err);
    }
  }

  triggerHaptic() {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        // Quick double pulse for scan success
        navigator.vibrate([60, 40, 60]);
      } catch (err) {
        // Fallback or ignored if vibrate not supported
      }
    }
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    return this.soundEnabled;
  }
}

export const audioController = new AudioController();
