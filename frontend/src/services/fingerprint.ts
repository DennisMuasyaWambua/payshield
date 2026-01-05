/**
 * Client-side Device Fingerprinting System
 * Generates unique, persistent device fingerprints
 */

interface FingerprintComponents {
  userAgent: string;
  screen: {
    width: number;
    height: number;
    colorDepth: number;
    pixelRatio: number;
  };
  timezone: {
    offset: number;
    name: string;
  };
  language: string;
  languages: string[];
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  maxTouchPoints: number;
  canvas: string;
  webgl: {
    vendor: string;
    renderer: string;
    hash: string;
  };
  audio: string;
  fonts: string[];
  plugins: string[];
  cookiesEnabled: boolean;
  localStorageEnabled: boolean;
  sessionStorageEnabled: boolean;
  doNotTrack: string | null;
}

interface DeviceFingerprint {
  hash: string;
  components: FingerprintComponents;
  confidence: number;
  createdAt: string;
  version: string;
}

class FingerprintGenerator {
  private readonly VERSION = '1.0.0';
  private readonly STORAGE_KEY = 'payshield_device_fingerprint';
  private cachedFingerprint: DeviceFingerprint | null = null;

  /**
   * Generate or retrieve device fingerprint
   */
  async generateFingerprint(): Promise<DeviceFingerprint> {
    try {
      // Check if we have a cached fingerprint
      if (this.cachedFingerprint) {
        return this.cachedFingerprint;
      }

      // Try to load from storage first
      const stored = this.loadStoredFingerprint();
      if (stored) {
        this.cachedFingerprint = stored;
        return stored;
      }

      // Generate new fingerprint
      console.log('🔍 Generating device fingerprint...');
      
      const components = await this.collectComponents();
      const hash = await this.computeHash(components);
      const confidence = this.computeConfidence(components);

      const fingerprint: DeviceFingerprint = {
        hash,
        components,
        confidence,
        createdAt: new Date().toISOString(),
        version: this.VERSION
      };

      // Store persistently
      this.storeFingerprint(fingerprint);
      this.cachedFingerprint = fingerprint;

      console.log(`✅ Fingerprint generated with ${confidence}% confidence`);
      return fingerprint;

    } catch (error) {
      console.error('❌ Fingerprint generation failed:', error);
      
      // Return fallback fingerprint
      return this.createFallbackFingerprint();
    }
  }

  /**
   * Collect all fingerprint components
   */
  private async collectComponents(): Promise<FingerprintComponents> {
    const [
      canvas,
      webgl,
      audio,
      fonts
    ] = await Promise.all([
      this.getCanvasFingerprint(),
      this.getWebGLFingerprint(),
      this.getAudioFingerprint(),
      this.getFontsFingerprint()
    ]);

    return {
      userAgent: navigator.userAgent,
      screen: {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth,
        pixelRatio: window.devicePixelRatio || 1
      },
      timezone: {
        offset: new Date().getTimezoneOffset(),
        name: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      language: navigator.language,
      languages: Array.from(navigator.languages || [navigator.language]),
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      deviceMemory: (navigator as any).deviceMemory || null,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      canvas,
      webgl,
      audio,
      fonts,
      plugins: this.getPlugins(),
      cookiesEnabled: navigator.cookieEnabled,
      localStorageEnabled: this.isLocalStorageEnabled(),
      sessionStorageEnabled: this.isSessionStorageEnabled(),
      doNotTrack: navigator.doNotTrack || null
    };
  }

  /**
   * Generate canvas fingerprint
   */
  private getCanvasFingerprint(): string {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) return 'no-canvas-support';

      canvas.width = 280;
      canvas.height = 60;

      // Draw text with various styles
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      
      ctx.fillStyle = '#069';
      ctx.font = '11pt Arial';
      ctx.fillText('PayShield Device Print 🔐', 2, 15);
      
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.font = '18pt Arial';
      ctx.fillText('PayShield Protocol', 4, 45);

      // Draw shapes
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(255,0,255)';
      ctx.beginPath();
      ctx.arc(50, 50, 50, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();
      
      ctx.fillStyle = 'rgb(0,255,255)';
      ctx.beginPath();
      ctx.arc(100, 50, 50, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();

      // Add some noise for uniqueness
      ctx.fillStyle = 'rgb(255,255,0)';
      ctx.beginPath();
      ctx.arc(150, 50, 50, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();

      return canvas.toDataURL();

    } catch (error) {
      console.warn('Canvas fingerprinting failed:', error);
      return 'canvas-error';
    }
  }

  /**
   * Generate WebGL fingerprint
   */
  private getWebGLFingerprint(): { vendor: string; renderer: string; hash: string } {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        return { vendor: 'no-webgl', renderer: 'no-webgl', hash: 'no-webgl' };
      }

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const vendor = debugInfo ? 
        gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 
        gl.getParameter(gl.VENDOR);
      const renderer = debugInfo ? 
        gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 
        gl.getParameter(gl.RENDERER);

      // Create a simple WebGL scene for additional fingerprinting
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      
      const vertices = new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
         0.0,  1.0
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      // Get supported extensions
      const extensions = gl.getSupportedExtensions()?.join(',') || '';
      
      // Combine WebGL info into hash
      const webglInfo = `${vendor}|${renderer}|${gl.getParameter(gl.VERSION)}|${extensions}`;
      const hash = this.simpleHash(webglInfo);

      return {
        vendor: vendor?.toString() || 'unknown',
        renderer: renderer?.toString() || 'unknown',
        hash
      };

    } catch (error) {
      console.warn('WebGL fingerprinting failed:', error);
      return { vendor: 'webgl-error', renderer: 'webgl-error', hash: 'webgl-error' };
    }
  }

  /**
   * Generate audio fingerprint
   */
  private async getAudioFingerprint(): Promise<string> {
    return new Promise((resolve) => {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        const oscillator = audioContext.createOscillator();
        const analyser = audioContext.createAnalyser();
        const gainNode = audioContext.createGain();
        const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

        oscillator.type = 'triangle';
        oscillator.frequency.value = 1000;
        
        gainNode.gain.value = 0;
        
        oscillator.connect(analyser);
        analyser.connect(scriptProcessor);
        scriptProcessor.connect(gainNode);
        gainNode.connect(audioContext.destination);

        scriptProcessor.onaudioprocess = (bins) => {
          const buffer = new Float32Array(analyser.frequencyBinCount);
          analyser.getFloatFrequencyData(buffer);
          
          // Convert to string and hash
          const fingerprint = Array.from(buffer)
            .slice(0, 100) // Take first 100 values
            .map(x => Math.round(x + 200))
            .join(',');
          
          oscillator.stop();
          audioContext.close();
          
          resolve(this.simpleHash(fingerprint));
        };

        oscillator.start(0);
        
        // Timeout fallback
        setTimeout(() => {
          try {
            oscillator.stop();
            audioContext.close();
          } catch (e) {}
          resolve('audio-timeout');
        }, 1000);

      } catch (error) {
        console.warn('Audio fingerprinting failed:', error);
        resolve('audio-error');
      }
    });
  }

  /**
   * Detect available fonts
   */
  private getFontsFingerprint(): string[] {
    const fonts = [
      'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Century Gothic',
      'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Helvetica', 'Impact',
      'Lucida Console', 'Lucida Grande', 'Palatino', 'Tahoma', 'Times New Roman',
      'Trebuchet MS', 'Verdana', 'Monaco', 'Menlo', 'Ubuntu', 'Open Sans'
    ];

    const detectedFonts: string[] = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return ['no-canvas'];

    const baselineText = 'mmmmmmmmmmlli';
    const testSize = '72px';

    // Measure baseline width
    ctx.font = `${testSize} monospace`;
    const baselineWidth = ctx.measureText(baselineText).width;

    for (const font of fonts) {
      ctx.font = `${testSize} ${font}, monospace`;
      const width = ctx.measureText(baselineText).width;
      
      if (width !== baselineWidth) {
        detectedFonts.push(font);
      }
    }

    return detectedFonts;
  }

  /**
   * Get browser plugins
   */
  private getPlugins(): string[] {
    if (!navigator.plugins) return ['no-plugins-support'];
    
    return Array.from(navigator.plugins)
      .map(plugin => plugin.name)
      .sort();
  }

  /**
   * Check if localStorage is enabled
   */
  private isLocalStorageEnabled(): boolean {
    try {
      const test = '__payshield_test__';
      localStorage.setItem(test, 'test');
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if sessionStorage is enabled
   */
  private isSessionStorageEnabled(): boolean {
    try {
      const test = '__payshield_test__';
      sessionStorage.setItem(test, 'test');
      sessionStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Compute fingerprint hash
   */
  private async computeHash(components: FingerprintComponents): Promise<string> {
    const fingerprintString = JSON.stringify(components, Object.keys(components).sort());
    
    // Use Web Crypto API if available
    if (crypto && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(fingerprintString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      // Fallback to simple hash
      return this.simpleHash(fingerprintString);
    }
  }

  /**
   * Simple hash function fallback
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Compute confidence score
   */
  private computeConfidence(components: FingerprintComponents): number {
    let confidence = 0;

    // Screen resolution uniqueness
    const screenArea = components.screen.width * components.screen.height;
    if (screenArea > 1920 * 1080) confidence += 15;
    else if (screenArea > 1366 * 768) confidence += 10;
    else confidence += 5;

    // Canvas fingerprint
    if (components.canvas && components.canvas.length > 100) confidence += 20;

    // WebGL fingerprint
    if (components.webgl.vendor && components.webgl.renderer) confidence += 20;

    // Audio fingerprint
    if (components.audio && components.audio.length > 5) confidence += 15;

    // Available fonts
    if (components.fonts.length > 15) confidence += 10;
    else if (components.fonts.length > 5) confidence += 5;

    // Hardware info
    if (components.hardwareConcurrency > 0) confidence += 5;
    if (components.deviceMemory) confidence += 5;
    if (components.maxTouchPoints > 0) confidence += 5;

    // Platform/browser info
    if (components.userAgent.length > 50) confidence += 5;
    if (components.languages.length > 1) confidence += 5;

    return Math.min(confidence, 100);
  }

  /**
   * Store fingerprint persistently
   */
  private storeFingerprint(fingerprint: DeviceFingerprint): void {
    try {
      // Store in IndexedDB (most persistent)
      this.storeInIndexedDB(fingerprint);
      
      // Fallback to localStorage
      if (this.isLocalStorageEnabled()) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(fingerprint));
      }

      // Also store in sessionStorage
      if (this.isSessionStorageEnabled()) {
        sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(fingerprint));
      }

    } catch (error) {
      console.warn('Failed to store fingerprint:', error);
    }
  }

  /**
   * Load stored fingerprint
   */
  private loadStoredFingerprint(): DeviceFingerprint | null {
    try {
      // Try IndexedDB first
      // Note: This would need to be async in real implementation
      
      // Try localStorage
      if (this.isLocalStorageEnabled()) {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Validate version compatibility
          if (parsed.version === this.VERSION) {
            return parsed;
          }
        }
      }

      // Try sessionStorage
      if (this.isSessionStorageEnabled()) {
        const stored = sessionStorage.getItem(this.STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.version === this.VERSION) {
            return parsed;
          }
        }
      }

    } catch (error) {
      console.warn('Failed to load stored fingerprint:', error);
    }

    return null;
  }

  /**
   * Store in IndexedDB for maximum persistence
   */
  private storeInIndexedDB(fingerprint: DeviceFingerprint): void {
    try {
      const request = indexedDB.open('PayShieldDB', 1);
      
      request.onerror = () => {
        console.warn('IndexedDB storage failed');
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['fingerprints'], 'readwrite');
        const store = transaction.objectStore('fingerprints');
        store.put(fingerprint, 'current');
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('fingerprints')) {
          db.createObjectStore('fingerprints');
        }
      };
      
    } catch (error) {
      console.warn('IndexedDB not supported:', error);
    }
  }

  /**
   * Create fallback fingerprint when generation fails
   */
  private createFallbackFingerprint(): DeviceFingerprint {
    const timestamp = Date.now().toString();
    const random = Math.random().toString();
    const fallbackHash = this.simpleHash(timestamp + random + navigator.userAgent);

    return {
      hash: fallbackHash,
      components: {
        userAgent: navigator.userAgent || 'unknown',
        screen: {
          width: screen.width || 0,
          height: screen.height || 0,
          colorDepth: screen.colorDepth || 0,
          pixelRatio: window.devicePixelRatio || 1
        },
        timezone: {
          offset: new Date().getTimezoneOffset() || 0,
          name: 'unknown'
        },
        language: navigator.language || 'unknown',
        languages: [navigator.language || 'unknown'],
        platform: navigator.platform || 'unknown',
        hardwareConcurrency: navigator.hardwareConcurrency || 0,
        deviceMemory: null,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        canvas: 'fallback',
        webgl: { vendor: 'fallback', renderer: 'fallback', hash: 'fallback' },
        audio: 'fallback',
        fonts: ['fallback'],
        plugins: ['fallback'],
        cookiesEnabled: navigator.cookieEnabled,
        localStorageEnabled: this.isLocalStorageEnabled(),
        sessionStorageEnabled: this.isSessionStorageEnabled(),
        doNotTrack: navigator.doNotTrack || null
      },
      confidence: 20, // Low confidence for fallback
      createdAt: new Date().toISOString(),
      version: this.VERSION
    };
  }

  /**
   * Clear stored fingerprint
   */
  clearStoredFingerprint(): void {
    try {
      if (this.isLocalStorageEnabled()) {
        localStorage.removeItem(this.STORAGE_KEY);
      }
      if (this.isSessionStorageEnabled()) {
        sessionStorage.removeItem(this.STORAGE_KEY);
      }
      this.cachedFingerprint = null;
    } catch (error) {
      console.warn('Failed to clear fingerprint:', error);
    }
  }

  /**
   * Get fingerprint for blockchain (keccak256 compatible)
   */
  async getFingerprintForBlockchain(): Promise<string> {
    const fingerprint = await this.generateFingerprint();
    return fingerprint.hash;
  }
}

// Export singleton instance
export const fingerprintGenerator = new FingerprintGenerator();
export type { DeviceFingerprint, FingerprintComponents };