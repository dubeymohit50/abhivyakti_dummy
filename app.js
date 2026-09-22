(function () {
  "use strict";

  const KEY_PHOTO = "aw_photo";
  const KEY_QR = "aw_qr";
  const KEY_NAME = "aw_name";
  const REBLUR_MS = 30000;
  const cfg = window.PASS_CONFIG || {};

  const $ = (id) => document.getElementById(id);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };

  const SECRET_TAPS = 5;

  // Calls fn after SECRET_TAPS taps/clicks in quick succession. Uses `click` so the
  // handler runs inside a user gesture (needed to open the file picker).
  function onMultiTap(el, fn) {
    let count = 0;
    let last = 0;
    el.addEventListener("click", (e) => {
      const now = Date.now();
      count = now - last < 450 ? count + 1 : 1;
      last = now;
      if (count === SECRET_TAPS) {
        count = 0;
        e.preventDefault();
        fn();
      }
    });
  }

  // ---------- Details from config ----------
  const fields = { fName: "name", tabName: "name", fMeta: "meta", fBatch: "batch", fVenue: "venue", fAddress: "address" };
  Object.keys(fields).forEach((id) => {
    const v = cfg[fields[id]];
    if (v && $(id)) $(id).textContent = v;
  });

  // ---------- Name: multi-tap on top tab to edit ----------
  const nameModal = $("nameModal");
  const nameInput = $("nameInput");

  function setName(name) {
    $("tabName").textContent = name;
    $("fName").textContent = name;
  }

  const savedName = store.get(KEY_NAME);
  if (savedName) setName(savedName);

  function closeNameModal() {
    nameModal.hidden = true;
    nameInput.blur();
  }

  onMultiTap($("tabName"), () => {
    nameInput.value = $("tabName").textContent;
    nameModal.hidden = false;
    nameInput.focus();
    nameInput.select();
  });

  $("nameForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    setName(name);
    store.set(KEY_NAME, name);
    closeNameModal();
  });
  $("nameCancel").addEventListener("click", closeNameModal);
  nameModal.addEventListener("click", (e) => {
    if (e.target === nameModal) closeNameModal();
  });

  // ---------- Photo: multi-tap to upload ----------
  const photoWrap = $("photoWrap");
  const photoImg = $("userPhoto");
  const photoInput = $("photoInput");
  const photoCapture = $("photoCapture");
  const photoSheet = $("photoSheet");

  const savedPhoto = store.get(KEY_PHOTO);
  if (savedPhoto) photoImg.src = savedPhoto;

  function closePhotoSheet() {
    photoSheet.hidden = true;
  }

  // Opening the picker from the sheet's button tap keeps it inside a user gesture
  function pickFrom(input) {
    closePhotoSheet();
    input.value = "";
    input.click();
  }

  onMultiTap(photoWrap, () => { photoSheet.hidden = false; });
  $("photoUploadBtn").addEventListener("click", () => pickFrom(photoInput));
  $("photoCaptureBtn").addEventListener("click", () => pickFrom(photoCapture));
  $("photoSheetCancel").addEventListener("click", closePhotoSheet);
  photoSheet.addEventListener("click", (e) => {
    if (e.target === photoSheet) closePhotoSheet();
  });

  function onPhotoChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 600;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", 0.85);
        photoImg.src = data;
        store.set(KEY_PHOTO, data);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  photoInput.addEventListener("change", onPhotoChosen);
  photoCapture.addEventListener("change", onPhotoChosen);

  // ---------- QR rendering ----------
  const qrCard = $("qrCard");
  const qrBox = $("qrCode");
  const refreshBtn = $("refreshBtn");
  let reblurTimer = null;

  function renderQr(text) {
    qrBox.innerHTML = "";
    try {
      makeQr(text);
    } catch (e) {
      qrBox.innerHTML = "";
      makeQr(cfg.placeholderQr || "ABHIVYAKTI"); // text too long for a QR
    }
  }

  function makeQr(text) {
    new QRCode(qrBox, {
      text: text,
      width: 512,
      height: 512,
      colorDark: "#111111",
      colorLight: "#ececec",
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  function blur() {
    clearTimeout(reblurTimer);
    qrCard.classList.add("blurred");
  }

  function unblur() {
    qrCard.classList.remove("blurred");
    clearTimeout(reblurTimer);
    reblurTimer = setTimeout(blur, REBLUR_MS);
  }

  refreshBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const icon = refreshBtn.querySelector(".refresh-icon");
    icon.classList.remove("spin");
    void icon.offsetWidth; // restart animation
    icon.classList.add("spin");
    setTimeout(unblur, 600);
  });

  qrCard.addEventListener("click", () => {
    if (!qrCard.classList.contains("blurred")) blur();
  });

  renderQr(store.get(KEY_QR) || cfg.placeholderQr || "ABHIVYAKTI");

  // ---------- Scanner ----------
  // Camera frames are decoded with ZXing-C++ (WebAssembly, vendor/zxing_reader.wasm),
  // which copes with dense codes, centre logos (e.g. UPI / Google Pay) and phone screens.
  const scanner = $("scanner");
  const scannerMsg = $("scannerMsg");
  const video = $("scanVideo");
  const frameCanvas = document.createElement("canvas");
  const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
  let detector = null;
  let stream = null;
  let scanning = false;
  let scanRun = 0; // guards against an old loop surviving a quick close/reopen

  function setMsg(text, isError) {
    scannerMsg.textContent = text;
    scannerMsg.classList.toggle("error", !!isError);
  }

  async function getDetector() {
    if (detector) return detector;
    const api = window.BarcodeDetectionAPI;
    api.prepareZXingModule({
      overrides: {
        locateFile: (path, prefix) => (path.endsWith(".wasm") ? "vendor/" + path : prefix + path)
      }
    });
    detector = new api.BarcodeDetector({ formats: ["qr_code"] });
    return detector;
  }

  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function closeScanner() {
    stopCamera();
    scanner.hidden = true;
  }

  async function startCamera() {
    const tries = [
      { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { facingMode: { ideal: "environment" } },
      true
    ];
    for (const v of tries) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      } catch (e) {
        if (e && e.name === "NotAllowedError") throw e;
      }
    }
    throw new Error("No camera");
  }

  async function openScanner() {
    scanner.hidden = false;
    setMsg("Point the camera at a QR code");

    if (!window.isSecureContext || !navigator.mediaDevices) {
      setMsg("Camera needs HTTPS (or localhost). Please open the app over a secure connection.", true);
      return;
    }

    try {
      stream = await startCamera();
    } catch (e) {
      setMsg("Unable to access camera. Please allow camera permission and try again.", true);
      return;
    }
    if (scanner.hidden) { stopCamera(); return; } // closed while waiting for permission

    const track = stream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (e) { /* unsupported */ }

    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay is allowed for muted inline video */ }

    let det;
    try {
      det = await getDetector();
    } catch (e) {
      setMsg("Scanner failed to load. Please reload the app.", true);
      return;
    }

    scanning = true;
    scanLoop(det, ++scanRun);
  }

  async function scanLoop(det, run) {
    while (scanning && run === scanRun) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        if (frameCanvas.width !== w) frameCanvas.width = w;
        if (frameCanvas.height !== h) frameCanvas.height = h;
        frameCtx.drawImage(video, 0, 0, w, h);
        try {
          const codes = await det.detect(frameCtx.getImageData(0, 0, w, h));
          if (scanning && run === scanRun && codes.length && codes[0].rawValue) {
            onScan(codes[0].rawValue);
            return;
          }
        } catch (e) { /* keep trying */ }
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  function onScan(text) {
    closeScanner();
    store.set(KEY_QR, text);
    renderQr(text);
    blur();
    if (navigator.vibrate) navigator.vibrate(80);
  }

  $("logoutBtn").addEventListener("click", openScanner);
  $("scannerClose").addEventListener("click", closeScanner);

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
