"use client";

import { useEffect, useRef, useState } from "react";
import { validBarcode } from "@/lib/off";
import s from "./shopping.module.css";

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

/** Native BarcodeDetector (Chrome on Android); elsewhere (iPhone Safari, Firefox) the zxing-wasm ponyfill, loaded on demand */
async function makeDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
  if (Native) {
    try {
      const ok = await Native.getSupportedFormats();
      if (ok.includes("ean_13")) return new Native({ formats: FORMATS.filter((f) => ok.includes(f)) });
    } catch { /* fall back */ }
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  // self-hosted copy of zxing_reader.wasm (public/), so the scanner needs no third-party CDN
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path) } });
  return new BarcodeDetector({ formats: FORMATS as never });
}

/** Full-screen camera view; calls onCode once with the first valid EAN/UPC. Manual entry when the camera is unavailable. */
export default function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const done = useRef(false);
  const cb = useRef(onCode);
  useEffect(() => { cb.current = onCode; }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null, timer: ReturnType<typeof setTimeout> | undefined, live = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!live) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const detector = await makeDetector();
        const tick = async () => {
          if (!live || done.current) return;
          try {
            if (v.readyState >= 2) {
              const hit = (await detector.detect(v)).map((b) => b.rawValue).find(validBarcode);
              if (hit && !done.current) { done.current = true; navigator.vibrate?.(60); cb.current(hit); return; }
            }
          } catch { /* a frame can fail; keep scanning */ }
          timer = setTimeout(tick, 150);
        };
        tick();
      } catch (e) {
        if (live) setError((e as Error).name === "NotAllowedError" ? "Brak zgody na aparat. Wpisz kod ręcznie." : "Aparat niedostępny. Wpisz kod ręcznie.");
      }
    })();
    return () => { live = false; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const code = manual.replace(/\D/g, "");
  return (
    <div className={s.scanner} role="dialog" aria-modal="true" aria-label="Skaner kodów kreskowych">
      <div className={s.scanhead}>
        <span>Skieruj aparat na kod kreskowy</span>
        <button className={s.icon} onClick={onClose} aria-label="Zamknij skaner">×</button>
      </div>
      {error ? <p className={s.scanerr}>{error}</p> : <video ref={video} className={s.video} playsInline muted />}
      <form className={s.add} onSubmit={(e) => { e.preventDefault(); if (validBarcode(code)) { done.current = true; onCode(code); } }}>
        <input aria-label="Kod kreskowy" placeholder="albo wpisz kod" inputMode="numeric" maxLength={14} value={manual} onChange={(e) => setManual(e.target.value)} />
        <button className="btn primary" disabled={!validBarcode(code)}>Szukaj</button>
      </form>
    </div>
  );
}
