/* Tideline — interactive spiral hero.

   Particles sit on logarithmic spiral arms and are drawn additively from
   pre-rendered glow sprites, so a thousand of them stay cheap. On top of that
   base position each particle carries its own displacement and velocity, which
   is what makes the field feel like a substance rather than a background:

     move    the cursor ploughs a wake through the dust
     drag    flings the whole galaxy; it keeps spinning and slows on friction
     click   a shockwave ring travels outward and shoves everything it crosses
     scroll  the field drifts and widens as the hero leaves the viewport

   Displaced particles brighten in proportion to how far they have been pushed,
   so disturbance is visible rather than just geometric. Everything springs back.
   prefers-reduced-motion renders a single static frame and binds no handlers. */
(function () {
  const canvas = document.getElementById('galaxy');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- field shape ---------- */
  const PALETTE = [
    { rgb: [255, 255, 255], weight: 0.50 },
    { rgb: [186, 214, 255], weight: 0.32 },
    { rgb: [255, 176, 118], weight: 0.18 },
  ];

  const ARMS = 2;
  // r = ARM_A·e^(ARM_TIGHTNESS·θ), θ ∈ [0, ARM_SWEEP]. The three are tied
  // together: at θ = ARM_SWEEP the radius must land near 1.0, the outer edge
  // of the drawing space. Change one, recompute the others.
  const ARM_A = 0.141;
  const ARM_TIGHTNESS = 0.28;
  const ARM_SWEEP = 7.0;        // ≈401°, so arms wrap past a full turn
  const ARM_SPREAD = 0.16;
  const COUNT = 1500;

  /* ---------- feel ---------- */
  const SPRING = 0.014;         // pull back toward the base position
  const DAMPING = 0.905;        // velocity retained per frame
  const CURSOR_RADIUS = 165;    // px of influence around the pointer
  const CURSOR_FORCE = 26;      // push strength at the centre of that radius
  const SPIN_FRICTION = 0.955;  // how long a fling keeps going
  const WAVE_SPEED = 980;       // px/s, shockwave expansion
  const WAVE_WIDTH = 110;       // px, thickness of the ring
  const WAVE_FORCE = 190;       // impulse imparted as it passes

  let width = 0, height = 0, dpr = 1, cx = 0, cy = 0, scale = 1;
  let particles = [];
  let sprites = [];
  let waves = [];
  let rotation = 0, spin = 0, scrollDrift = 0, zoom = 1;
  let raf = null, lastTime = 0;

  const pointer = {
    x: 0, y: 0,            // eased screen position
    tx: 0, ty: 0,          // raw target
    inside: false,
    down: false,
    dragged: 0,
    lastAngle: 0,
  };

  /* ---------- one pre-rendered radial glow per palette colour ---------- */
  function buildSprites() {
    sprites = PALETTE.map(({ rgb }) => {
      const size = 64;
      const s = document.createElement('canvas');
      s.width = s.height = size;
      const g = s.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      const [r, gr, b] = rgb;
      grad.addColorStop(0.0, `rgba(${r},${gr},${b},1)`);
      grad.addColorStop(0.10, `rgba(${r},${gr},${b},0.85)`);
      grad.addColorStop(0.28, `rgba(${r},${gr},${b},0.28)`);
      grad.addColorStop(0.55, `rgba(${r},${gr},${b},0.07)`);
      grad.addColorStop(1.0, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return s;
    });
  }

  function pickColour() {
    const roll = Math.random();
    let acc = 0;
    for (let i = 0; i < PALETTE.length; i++) {
      acc += PALETTE[i].weight;
      if (roll <= acc) return i;
    }
    return 0;
  }

  function build() {
    particles = [];

    for (let i = 0; i < COUNT; i++) {
      const t = Math.pow(Math.random(), 0.62);   // bias toward the dense core
      const arm = Math.floor(Math.random() * ARMS);
      const theta = t * ARM_SWEEP;
      const angle = theta + (arm * (Math.PI * 2)) / ARMS
        + (Math.random() - 0.5) * ARM_SPREAD * (0.35 + t * 1.5) * 2;
      const radius = ARM_A * Math.exp(ARM_TIGHTNESS * theta) * (1 + (Math.random() - 0.5) * 0.14);

      const bright = Math.random();
      particles.push({
        angle, radius,
        // Lopsided on purpose: a few anchor stars among a lot of fine dust is
        // what reads as a galaxy instead of confetti.
        size: bright > 0.965 ? 3.6 + Math.random() * 2.2
            : bright > 0.80 ? 1.7 + Math.random() * 1.1
            : 0.55 + Math.random() * 0.75,
        alpha: 0.55 + Math.random() * 0.45,
        colour: pickColour(),
        depth: 0.35 + Math.random() * 0.65,
        twinkle: Math.random() * Math.PI * 2,
        twinkleRate: 0.4 + Math.random() * 1.1,
        // Heavier stars shrug off the cursor; dust gets thrown around.
        mass: 0.55 + (bright > 0.80 ? 0.9 : 0) + Math.random() * 0.4,
        ox: 0, oy: 0, vx: 0, vy: 0,
      });
    }

    // Central bulge: dense, roughly spherical, no arm structure. Fills the
    // gap between the core glow and where the arms begin.
    for (let i = 0; i < 340; i++) {
      const bright = Math.random();
      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: Math.pow(Math.random(), 1.7) * 0.26,
        size: bright > 0.94 ? 2.0 + Math.random() * 1.4 : 0.5 + Math.random() * 0.8,
        alpha: 0.5 + Math.random() * 0.5,
        colour: pickColour(),
        depth: 0.2 + Math.random() * 0.4,
        twinkle: Math.random() * Math.PI * 2,
        twinkleRate: 0.4 + Math.random() * 1.0,
        mass: 1.4 + Math.random() * 0.8,   // the bulge barely reacts to the cursor
        ox: 0, oy: 0, vx: 0, vy: 0,
      });
    }

    for (let i = 0; i < 90; i++) {   // sparse halo so the corners aren't empty
      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.95 + Math.random() * 0.95,
        size: 0.4 + Math.random() * 0.9,
        alpha: 0.15 + Math.random() * 0.4,
        colour: pickColour(),
        depth: 0.15 + Math.random() * 0.3,
        twinkle: Math.random() * Math.PI * 2,
        twinkleRate: 0.3 + Math.random() * 0.8,
        mass: 0.5 + Math.random() * 0.5,
        ox: 0, oy: 0, vx: 0, vy: 0,
      });
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Off-centre on wide screens so the core can blaze without fighting the
    // headline; centred when the copy stacks below it on narrow ones.
    const wide = width >= 900;
    cx = width * (wide ? 0.66 : 0.5);
    cy = height * (wide ? 0.5 : 0.42);
    scale = Math.min(width, height) * (wide ? 0.56 : 0.46);
  }

  function drawCore(px, py) {
    const coreR = scale * 0.26 * zoom;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, coreR);
    grad.addColorStop(0.00, 'rgba(255,253,248,1)');
    grad.addColorStop(0.08, 'rgba(255,244,228,0.72)');
    grad.addColorStop(0.22, 'rgba(226,232,255,0.24)');
    grad.addColorStop(0.55, 'rgba(170,190,255,0.06)');
    grad.addColorStop(1.00, 'rgba(160,180,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, coreR, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCursorGlow() {
    if (!pointer.inside) return;
    const r = CURSOR_RADIUS * 0.85;
    const grad = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, r);
    grad.addColorStop(0, 'rgba(150,180,255,0.10)');
    grad.addColorStop(1, 'rgba(150,180,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function render(time) {
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
    lastTime = time;
    const t = time / 1000;

    ctx.fillStyle = '#050609';
    ctx.fillRect(0, 0, width, height);

    pointer.x += (pointer.tx - pointer.x) * 0.16;
    pointer.y += (pointer.ty - pointer.y) * 0.16;

    // Base drift plus whatever momentum the last fling left behind.
    rotation += 0.00035 + spin;
    spin *= SPIN_FRICTION;
    if (Math.abs(spin) < 1e-6) spin = 0;

    for (let i = waves.length - 1; i >= 0; i--) {
      waves[i].r += WAVE_SPEED * dt;
      if (waves[i].r > Math.max(width, height) * 1.1) waves.splice(i, 1);
    }

    ctx.globalCompositeOperation = 'lighter';
    drawCursorGlow();
    drawCore(cx + pointer.x * 0.02 - cx * 0.02, cy + scrollDrift * 0.3);

    const cursorR2 = CURSOR_RADIUS * CURSOR_RADIUS;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const a = p.angle + rotation;
      const r = p.radius * scale * zoom;

      // Where this particle wants to be.
      const baseX = cx + Math.cos(a) * r;
      const baseY = cy + Math.sin(a) * r * 0.94 + scrollDrift * p.depth;

      let px = baseX + p.ox;
      let py = baseY + p.oy;

      // Cursor wake — falls off smoothly to nothing at CURSOR_RADIUS.
      if (pointer.inside) {
        const dx = px - pointer.x;
        const dy = py - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < cursorR2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const falloff = 1 - d / CURSOR_RADIUS;
          const f = (CURSOR_FORCE * falloff * falloff) / (p.mass * d);
          p.vx += dx * f;
          p.vy += dy * f;
        }
      }

      // Shockwaves from clicks.
      for (let w = 0; w < waves.length; w++) {
        const wave = waves[w];
        const dx = px - wave.x;
        const dy = py - wave.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const band = Math.abs(d - wave.r);
        if (band < WAVE_WIDTH) {
          const strength = (1 - band / WAVE_WIDTH) * wave.power;
          const f = (WAVE_FORCE * strength * dt) / (p.mass * d);
          p.vx += dx * f;
          p.vy += dy * f;
        }
      }

      // Spring home, with damping.
      p.vx += -p.ox * SPRING;
      p.vy += -p.oy * SPRING;
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.ox += p.vx;
      p.oy += p.vy;

      px = baseX + p.ox;
      py = baseY + p.oy;

      // Disturbed particles glow hotter — makes the wake legible.
      const energy = Math.min((p.ox * p.ox + p.oy * p.oy) / 900, 1);
      const flicker = reduceMotion ? 1 : 0.78 + 0.22 * Math.sin(t * p.twinkleRate + p.twinkle);
      const alpha = Math.min(p.alpha * flicker * (1 + energy * 1.6), 1);
      const d = p.size * 9.5 * (1 + energy * 0.5);

      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites[p.colour], px - d / 2, py - d / 2, d, d);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (!reduceMotion) raf = requestAnimationFrame(render);
  }

  function start() {
    resize();
    buildSprites();
    build();
    if (raf) cancelAnimationFrame(raf);
    lastTime = 0;
    if (reduceMotion) render(0);
    else raf = requestAnimationFrame(render);
  }

  /* ---------- interaction ---------- */
  const hero = canvas.parentElement;

  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function markEngaged() {
    const hint = document.getElementById('galaxy-hint');
    if (hint) hint.classList.add('is-gone');
  }

  if (!reduceMotion) {
    hero.addEventListener('pointermove', (e) => {
      const pt = localPoint(e);
      pointer.tx = pt.x;
      pointer.ty = pt.y;
      pointer.inside = true;

      if (pointer.down) {
        // Angle swept around the centre becomes angular momentum.
        const angle = Math.atan2(pt.y - cy, pt.x - cx);
        let delta = angle - pointer.lastAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        spin += delta * 0.16;
        pointer.lastAngle = angle;
        pointer.dragged += Math.abs(delta);
      }
    });

    hero.addEventListener('pointerdown', (e) => {
      const pt = localPoint(e);
      pointer.down = true;
      pointer.dragged = 0;
      pointer.lastAngle = Math.atan2(pt.y - cy, pt.x - cx);
      pointer.tx = pt.x;
      pointer.ty = pt.y;
      pointer.x = pt.x;
      pointer.y = pt.y;
      pointer.inside = true;
      hero.classList.add('is-grabbing');
      markEngaged();
    });

    window.addEventListener('pointerup', (e) => {
      if (!pointer.down) return;
      pointer.down = false;
      hero.classList.remove('is-grabbing');
      // A press that barely moved is a click: send a shockwave.
      if (pointer.dragged < 0.04) {
        const pt = localPoint(e);
        waves.push({ x: pt.x, y: pt.y, r: 0, power: 1 });
      }
    });

    hero.addEventListener('pointerleave', () => {
      pointer.inside = false;
      pointer.down = false;
      hero.classList.remove('is-grabbing');
    });

    // Scroll: the field sinks and widens as the hero leaves.
    window.addEventListener('scroll', () => {
      const rect = hero.getBoundingClientRect();
      const progress = Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1);
      scrollDrift = progress * 90;
      zoom = 1 + progress * 0.22;
    }, { passive: true });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(start, 150);
    });

    // Don't burn frames once the hero is off screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (!raf) { lastTime = 0; raf = requestAnimationFrame(render); }
          } else if (raf) {
            cancelAnimationFrame(raf);
            raf = null;
          }
        });
      }, { threshold: 0 }).observe(canvas);
    }
  }

  start();
})();
