// UDT teaser animation (Three.js r128). The camera is fixed.
// UDT-XL/2 drawn as a U-Net. Blocks appear in their slots, turned to face right (thickness = token width D, shown as the blue/red
// side): input x_t -> encoder (token merge) -> bottleneck -> decoder (token unmerge), then the skip
// connections are drawn once, then the velocity output v appears.
// Everything is a pure function of time t, so ?t=<sec> freezes a frame and recording is deterministic.
(function () {
  const root = document.getElementById("teaser");
  if (!root || !window.THREE) return;

  const IMG = "static/images/merge/";
  const LOOP = 12.9;                     // timeline seconds per loop
  const SPEED = 0.8;                     // playback rate (1 = timeline speed); one loop takes LOOP / SPEED s
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const params = new URLSearchParams(location.search);
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frozenT = params.has("t") ? parseFloat(params.get("t")) : (reduceMotion ? LOOP - 1.5 : null);

  const COL = { io: 0x9aa3b2, enc: 0x4f7cff, dec: 0xff4d5a, mid: 0xb48cff, back: 0x1b1f27 };
  const CSS = { io: "#aab3c2", enc: "#6f95ff", dec: "#ff6b76", mid: "#c6a6ff", skip: "#ffc857" };

  // ---------------- Data: input, token blocks, output ----------------
  // UDT-XL/2 (models/utils.py build_token_schedule): T = 256, 14 enc + 14 dec blocks, encoder blocks 2-13
  // merge r = 12 each (256 -> 244 -> ... -> 124 -> 112); enc block 14 and dec block 1 form a 2-block bottleneck
  const LEVELS = [
    { file: "step_01_unmerged.png", T: 256 },
    { file: "step_02_merge_1.png",  T: 244 },   // after the first merge
    { file: "step_12_merge_11.png", T: 124 },   // before the last merge
    { file: "step_13_merge_12.png", T: 112 },   // bottleneck
  ];
  const MID = 3;
  const IO_DEPTH = 0.1, TOKEN_DEPTH = 0.3;   // token blocks are 3x thicker: width D vs. pixels
  // Sequence along the U (u = position along the path); the merge steps in between are shown as a tilted ⋯
  const SEQ = [
    { lv: 0, u: 0 }, { lv: 1, u: 1 }, { dots: true, u: 1.575 }, { lv: 2, u: 2.15 }, { lv: MID, u: 3.15 },
    { lv: MID, u: 4.15 }, { lv: 2, u: 5.15 }, { dots: true, u: 5.725 }, { lv: 1, u: 6.3 }, { lv: 0, u: 7.3 },
  ];
  const U_END = 7.3, U_MID0 = 3.15, U_MID1 = 4.15, DOT_HALF = 0.575;   // ⋯ gap is only slightly wider than a normal step
  const items = [{ role: "io", kind: "input", file: "input_t03.png", depth: IO_DEPTH }];
  const dots = [];
  SEQ.forEach((q, j) => {
    const role = q.lv === MID ? "mid" : q.u < U_MID0 ? "enc" : "dec";
    if (q.dots) dots.push({ role, u: q.u });
    else items.push({ role, level: q.lv, T: LEVELS[q.lv].T, file: LEVELS[q.lv].file, depth: TOKEN_DEPTH,
                      u: q.u, gapBefore: j > 0 && SEQ[j - 1].dots });
  });
  items.push({ role: "io", kind: "output", file: "output_v.png", depth: IO_DEPTH });
  const N = items.length;

  // Final U-Net layout (screen plane). Blocks appear in place, already turned to face right:
  // input -> encoder -> decoder, then all skips at once, then the output
  const SX = 1.38, SY = 1.2, TS = 1.12, IOX = 1.42, ROT = 0.8, TILT = 0.2;
  // V shape whose bottom is the flat 2-block bottleneck
  const HALF = U_END / 2, TOP = U_MID0 / 2;
  const uPos = (u) => new THREE.Vector3((u - HALF) * SX, (TOP - Math.min(u, U_END - u, U_MID0)) * SY, 0);
  items.forEach((it) => {
    if (it.kind === "input") it.slot = new THREE.Vector3(-HALF * SX - IOX, TOP * SY, 0);
    else if (it.kind === "output") it.slot = new THREE.Vector3(HALF * SX + IOX, TOP * SY, 0);
    else it.slot = uPos(it.u);
  });
  // Timing as two continuous sweeps (overlapping fades): encoder top-left -> first bottleneck block, then second
  // bottleneck block -> decoder top-right; then the skips are drawn slowly, then the output fades in
  // (both bottleneck blocks appear together, at the end of the encoder sweep)
  const FADE = 0.9, ENC_T0 = 0.9, SWEEP = 1.8, DEC_T0 = ENC_T0 + SWEEP;
  const tOf = (u) => (u <= U_MID0 ? ENC_T0 + (u / U_MID0) * SWEEP
    : u <= U_MID1 ? DEC_T0
    : DEC_T0 + ((u - U_MID1) / (U_END - U_MID1)) * SWEEP);
  items.forEach((it) => { it.t0 = it.kind === "input" ? 0.2 : tOf(it.u); });
  dots.forEach((d) => { d.t0 = tOf(d.u); });
  const SKIP_T0 = DEC_T0 + SWEEP + FADE * 0.6, SKIP_DUR = 1.8;
  items[N - 1].t0 = SKIP_T0 + SKIP_DUR + 0.2;     // output after the skips are drawn
  const SKIPS = [0, 1, 2].map((lv) => ({
    e: items.find((it) => it.role === "enc" && it.level === lv),
    d: items.find((it) => it.role === "dec" && it.level === lv),
  }));

  // ---------------- Three.js setup (fixed camera) ----------------
  const stage = root.querySelector("canvas");
  const ctx = stage.getContext("2d");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(1);                    // we size the drawing buffer ourselves
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(12, 16 / 9, 0.1, 400);
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Blocks = slabs: image on the front face, role color on the sides (top a little lighter), dark back
  items.forEach((it) => {
    const tex = loader.load(IMG + it.file);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = maxAniso;
    const c = new THREE.Color(COL[it.role]);
    const side = new THREE.MeshBasicMaterial({ color: c, transparent: true });
    const top = new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.3), transparent: true });
    const front = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const back = new THREE.MeshBasicMaterial({ color: COL.back, transparent: true });
    it.mats = [side, side, top, side, front, back];   // +x, -x, +y, -y, +z, -z
    it.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, it.depth), it.mats);
    it.corners = [];
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-it.depth / 2, it.depth / 2]) it.corners.push(new THREE.Vector3(x, y, z));
    scene.add(it.mesh);
  });

  // ---------------- Helpers ----------------
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const prog = (t, a, d) => clamp01((t - a) / d);
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const lerp = (a, b, x) => a + (b - a) * x;
  const tmpV = new THREE.Vector3();

  let W = 0, H = 0;
  function resize(w, h) {
    W = Math.round(w); H = Math.round(h);
    stage.width = W; stage.height = H;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    // Fit the whole U-Net (plus labels and HUD margins) and never move again
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const fitW = 2 * (HALF * SX + IOX) + TS + 0.4, fitH = U_MID0 * SY + TS + 2.6;
    const d = Math.max(fitH / 2 / Math.tan(vf), fitW / 2 / (Math.tan(vf) * camera.aspect));
    camera.position.set(0, 0, d);
    camera.lookAt(0, 0, 0);
  }

  function project(v) {
    tmpV.copy(v).project(camera);
    return { x: (tmpV.x * 0.5 + 0.5) * W, y: (-tmpV.y * 0.5 + 0.5) * H };
  }

  // Screen-space bounding box of a block
  function screenBox(it) {
    it.mesh.updateMatrixWorld();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    it.corners.forEach((c) => {
      const p = project(c.clone().applyMatrix4(it.mesh.matrixWorld));
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    });
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  // ---------------- Scene state at time t ----------------
  function update(t) {
    items.forEach((it) => {
      const a = easeIO(prog(t, it.t0, FADE));     // soft fade, in place
      it.mesh.position.copy(it.slot);
      it.mesh.position.y -= (1 - a) * 0.08;
      it.mesh.rotation.set(TILT, ROT, 0);
      it.mesh.scale.setScalar(TS * lerp(0.95, 1, a));
      it.alpha = a;
      it.mats.forEach((mat) => (mat.opacity = a));
      it.mesh.visible = a > 0.001;
    });
  }

  // ---------------- 2D overlay: arrows, skips, labels, HUD ----------------
  const FONT = "Inter, system-ui, -apple-system, sans-serif";


  function arrowHead(x, y, ux, uy, hl, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - ux * hl - uy * hl * 0.55, y - uy * hl + ux * hl * 0.55);
    ctx.lineTo(x - ux * hl + uy * hl * 0.55, y - uy * hl - ux * hl * 0.55);
    ctx.closePath(); ctx.fill();
  }

  function arrow(a, b, color, g, lw, dash) {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 4 || g <= 0) return;
    const ux = dx / L, uy = dy / L, ex = a.x + dx * g, ey = a.y + dy * g, hl = lw * 4.2;
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex - ux * hl * 0.6, ey - uy * hl * 0.6); ctx.stroke();
    ctx.setLineDash([]);
    arrowHead(ex, ey, ux, uy, hl, color);
  }

  // Math label like $x_t$: italic serif base with a smaller subscript, centered at cx
  function mathLabel(base, sub, cx, y, f) {
    const fb = `italic 400 ${f * 1.3}px "STIX Two Text", "Times New Roman", serif`;
    const fsub = `italic 400 ${f * 0.9}px "STIX Two Text", "Times New Roman", serif`;
    ctx.font = fb; const wb = ctx.measureText(base).width;
    ctx.font = fsub; const ws = sub ? ctx.measureText(sub).width + f * 0.06 : 0;
    const x0 = cx - (wb + ws) / 2;
    ctx.textAlign = "left";
    ctx.font = fb; ctx.fillText(base, x0, y);
    if (sub) { ctx.font = fsub; ctx.fillText(sub, x0 + wb + f * 0.06, y + f * 0.32); }
    ctx.textAlign = "center";
  }

  // Point where the ray from the box center toward (dx, dy) leaves the box, plus a margin
  function exitPoint(bx, dx, dy, margin) {
    const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const s = Math.min(bx.w / 2 / Math.max(Math.abs(ux), 1e-3), bx.h / 2 / Math.max(Math.abs(uy), 1e-3)) + margin;
    return { x: bx.cx + ux * s, y: bx.cy + uy * s };
  }

  // Stroke the first fraction p of a polyline; returns the tip position and direction
  function partialPath(pts, p) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    let left = total * p, tip = { x: pts[0].x, y: pts[0].y, ux: 0, uy: -1 };
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y), f = Math.min(1, left / seg);
      tip = { x: lerp(pts[i - 1].x, pts[i].x, f), y: lerp(pts[i - 1].y, pts[i].y, f),
              ux: (pts[i].x - pts[i - 1].x) / seg, uy: (pts[i].y - pts[i - 1].y) / seg };
      ctx.lineTo(tip.x, tip.y);
      left -= seg;
    }
    ctx.stroke();
    return tip;
  }

  function drawOverlay(t) {
    const fs = Math.max(11, Math.min(W, H * 1.78) * 0.0135);   // base font px
    const boxes = items.map(screenBox);

    // Sequence arrows, drawn once the target block has landed (none across a ⋯ gap)
    for (let i = 0; i < N - 1; i++) {
      if (items[i + 1].gapBefore) continue;
      const g = easeIO(prog(t, items[i + 1].t0 - 0.15, FADE * 0.8));
      if (g <= 0) continue;
      const A = boxes[i], B = boxes[i + 1];
      const a = items[i].role, b = items[i + 1].role;
      const color = a === "io" || b === "io" ? CSS.io : b === "dec" ? CSS.dec : a === "mid" ? CSS.mid : CSS.enc;   // mid -> mid: no merge
      ctx.globalAlpha = 1;
      arrow(exitPoint(A, B.cx - A.cx, B.cy - A.cy, fs * 0.35), exitPoint(B, A.cx - B.cx, A.cy - B.cy, fs * 0.35), color, g, Math.max(1.5, fs * 0.13));
    }

    // Tilted ⋯ where the T = 184 blocks would be, aligned with the arm of the U
    dots.forEach((d) => {
      const a = easeIO(prog(t, d.t0, FADE));
      if (a <= 0) return;
      const p0 = project(uPos(d.u - DOT_HALF)), p1 = project(uPos(d.u + DOT_HALF)), c = project(uPos(d.u));
      const dx = p1.x - p0.x, dy = p1.y - p0.y, L = Math.hypot(dx, dy);
      ctx.globalAlpha = a; ctx.fillStyle = CSS[d.role];
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath(); ctx.arc(c.x + dx * 0.085 * k, c.y + dy * 0.085 * k, Math.max(2, L * 0.022), 0, Math.PI * 2); ctx.fill();
      }
    });

    // Skip connections: dashed bracket arrows (encoder top-right -> decoder top-left), all drawn at once
    const sp = easeIO(prog(t, SKIP_T0, SKIP_DUR));
    for (const { e: ei, d: di } of SKIPS) {
      if (sp <= 0) break;
      const e = boxes[items.indexOf(ei)], d = boxes[items.indexOf(di)];
      const yh = project(new THREE.Vector3(0, ei.slot.y + TS * 0.5 + 0.55, 0)).y;
      const ax = e.cx + e.w * 0.2, dx = d.cx - d.w * 0.2, lw = Math.max(1.5, fs * 0.14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = CSS.skip; ctx.lineWidth = lw; ctx.lineJoin = "round";
      ctx.setLineDash([fs * 0.5, fs * 0.35]);
      const tip = partialPath([{ x: ax, y: e.y0 - fs * 0.3 }, { x: ax, y: yh }, { x: dx, y: yh }, { x: dx, y: d.y0 - fs * 0.2 }], sp);
      ctx.setLineDash([]);
      arrowHead(tip.x, tip.y, tip.ux, tip.uy, lw * 4.2, CSS.skip);
      // concat badge where the skip enters the decoder
      const ba = easeIO(prog(t, SKIP_T0 + SKIP_DUR - 0.1, 0.5));
      if (ba > 0) {
        const r = fs * 0.72;
        ctx.globalAlpha = ba;
        ctx.beginPath(); ctx.arc(dx, yh, r, 0, Math.PI * 2);
        ctx.fillStyle = "#151922"; ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.14); ctx.strokeStyle = CSS.skip; ctx.stroke();
        ctx.fillStyle = CSS.skip; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `800 ${r * 1.1}px ${FONT}`; ctx.fillText("C", dx, yh + 1);
        ctx.textBaseline = "alphabetic";
      }
    }

    // Labels under each block
    items.forEach((it, i) => {
      if (it.alpha < 0.02) return;
      let b = boxes[i];
      if (it.role === "mid") {
        // one shared label centered under the two bottleneck blocks
        if (items[i - 1].role === "mid") return;
        const b2 = boxes[i + 1];
        b = { cx: (b.cx + b2.cx) / 2, y1: Math.max(b.y1, b2.y1), h: b.h };
      }
      const f = Math.max(10, Math.min(fs * 1.6, b.h * 0.15));
      const name = it.kind === "input" ? "Input" : it.kind === "output" ? "Output" :
        it.role === "enc" ? "Encoder" : it.role === "dec" ? "Decoder" : "Bottleneck";
      ctx.globalAlpha = it.alpha;
      ctx.textAlign = "center";
      ctx.fillStyle = CSS[it.role];
      ctx.font = `600 ${f * 0.82}px ${FONT}`;
      ctx.fillText(name, b.cx, b.y1 + f * 1.15);
      ctx.fillStyle = "#e9ecf1";
      if (it.kind === "input") mathLabel("x", "t", b.cx, b.y1 + f * 2.45, f);
      else if (it.kind === "output") mathLabel("v", "", b.cx, b.y1 + f * 2.45, f);
      else { ctx.font = `700 ${f}px ${FONT}`; ctx.fillText(`T = ${it.T}`, b.cx, b.y1 + f * 2.3); }
    });

    // HUD: title, live token counter, caption, legend
    const pad = fs * 1.6;
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${fs * 1.5}px ${FONT}`;
    ctx.fillText("UDT", pad, pad + fs * 1.1);
    ctx.fillStyle = "#8d96a8";
    ctx.font = `500 ${fs * 0.95}px ${FONT}`;
    ctx.fillText("U-Net Diffusion Transformer", pad + fs * 3.9, pad + fs * 1.1);


    // Legend (bottom-right): arrow swatches; skip is dashed like the skip brackets
    ctx.globalAlpha = 1;
    ctx.textAlign = "right"; ctx.font = `500 ${fs * 0.95}px ${FONT}`;
    const sw = fs * 3.4, gap = fs * 1.6, llw = Math.max(3, fs * 0.28);
    const legend = [["skip", "Skip Connection"], ["dec", "Token Unmerge"], ["enc", "Token Merge"]];
    const rowW = legend.reduce((s, [, l]) => s + ctx.measureText(l).width + fs * 0.6 + sw + gap, -gap);
    const stacked = rowW > W - 2 * pad;          // phones: one entry per line
    let x = W - pad, cy = H - pad;
    // each entry fades in with its phase: merge with the encoder, unmerge after the bottleneck, skip with the skips
    const legendT0 = { enc: ENC_T0, dec: tOf(U_MID1 + 1), skip: SKIP_T0 };
    legend.forEach(([k, label]) => {
      ctx.globalAlpha = easeIO(prog(t, legendT0[k], FADE));
      ctx.fillStyle = "#c3c9d4"; ctx.fillText(label, x, cy);
      const lx = stacked ? W - pad - fs * 9.5 : x - ctx.measureText(label).width - fs * 0.6;
      arrow({ x: lx - sw, y: cy - fs * 0.33 }, { x: lx, y: cy - fs * 0.33 }, CSS[k], 1, llw, k === "skip" ? [fs * 0.5, fs * 0.35] : null);
      ctx.textAlign = "right"; ctx.font = `500 ${fs * 0.95}px ${FONT}`;
      if (stacked) cy -= fs * 1.5; else x = lx - sw - gap;
    });

    // Loop fade
    const fade = Math.max(prog(t, LOOP - 0.8, 0.8), 1 - prog(t, 0, 0.25));
    if (fade > 0) { ctx.globalAlpha = fade; ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, W, H); }
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw(t) {
    update(t);
    renderer.render(scene, camera);
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#1a2030"); bg.addColorStop(1, "#0b0d12");
    ctx.globalAlpha = 1; ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(renderer.domElement, 0, 0, W, H);
    drawOverlay(t);
  }

  // ---------------- Loop, controls, recording ----------------
  let playing = frozenT === null, visible = true, recording = false;
  let clock = frozenT || 0, last = performance.now();

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing && (visible || recording)) clock = (clock + dt * SPEED) % LOOP;
    if (visible || recording) draw(clock);
    requestAnimationFrame(frame);
  }

  function fitToBox() {
    if (recording) return;
    const r = stage.getBoundingClientRect();
    if (r.width > 0) resize(r.width * DPR, r.height * DPR);
  }
  new ResizeObserver(fitToBox).observe(stage);
  fitToBox();
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(root);
  }

  const btnPlay = root.querySelector("[data-act=play]");
  const btnReplay = root.querySelector("[data-act=replay]");
  const btnRec = root.querySelector("[data-act=record]");
  function setPlaying(p) { playing = p; if (btnPlay) btnPlay.textContent = p ? "Pause" : "Play"; }
  if (btnPlay) btnPlay.addEventListener("click", () => setPlaying(!playing));
  if (btnReplay) btnReplay.addEventListener("click", () => { clock = 0; setPlaying(true); });
  setPlaying(playing);

  // Record one loop at 1920x1080 and download it (MP4 where the browser supports it, else WebM)
  if (btnRec) btnRec.addEventListener("click", () => {
    if (recording) return;
    const types = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
    const type = window.MediaRecorder && types.find((x) => MediaRecorder.isTypeSupported(x));
    if (!type || !stage.captureStream) { btnRec.textContent = "Not supported here"; return; }
    recording = true;
    const label = btnRec.textContent;
    btnRec.textContent = "Recording…";
    resize(1920, 1080);
    clock = 0; setPlaying(true);
    const rec = new MediaRecorder(stage.captureStream(60), { mimeType: type, videoBitsPerSecond: 16e6 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(chunks, { type }));
      a.download = "udt_teaser." + (type.startsWith("video/mp4") ? "mp4" : "webm");
      a.click();
      recording = false; btnRec.textContent = label; fitToBox();
    };
    rec.start();
    setTimeout(() => rec.stop(), (LOOP / SPEED) * 1000);
  });

  if (frozenT !== null) { draw(frozenT); }
  // canvas text does not trigger webfont loading by itself, so request the math italic explicitly
  const fontsReady = document.fonts
    ? Promise.all([document.fonts.ready, document.fonts.load('italic 20px "STIX Two Text"')]).catch(() => {})
    : Promise.resolve();
  fontsReady.then(() => requestAnimationFrame(frame));
})();
