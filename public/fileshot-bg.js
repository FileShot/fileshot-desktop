/* ═══════════════════════════════════════════════════════════════
   FileShot Hybrid Background — WebGL Aurora + Interactive Particles
   Drop-in module. Requires two <canvas> elements:
     #fileshotGLCanvas   (WebGL shader layer)
     #fileshotParticles  (Canvas 2D particle layer)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Shared state ─────────────────────────────────────────── */
  var mx = window.innerWidth / 2;
  var my = window.innerHeight / 2;
  document.addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; });

  /* ── Feature detection / perf guard ───────────────────────── */
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 768;

  /* ════════════════════════════════════════════════════════════
     LAYER 1 — WebGL Shader (procedural aurora)
     ════════════════════════════════════════════════════════════ */
  var glRender = null;  // will hold the per-frame GL draw function

  function initWebGL() {
    var c = document.getElementById('fileshotGLCanvas');
    if (!c) return;
    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) { c.style.display = 'none'; return; }

    function resize() {
      // On mobile / reduced-motion: render at half res for perf
      var scale = isMobile ? 0.5 : 1;
      c.width = window.innerWidth * scale;
      c.height = window.innerHeight * scale;
      gl.viewport(0, 0, c.width, c.height);
    }
    window.addEventListener('resize', resize);
    resize();

    var vs = `
      attribute vec2 a_position;
      void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
    `;

    var fs = `
      precision mediump float;
      uniform float u_time;
      uniform vec2  u_resolution;
      uniform vec2  u_mouse;

      vec2 hash(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(dot(hash(i), f), dot(hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
          mix(dot(hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
              dot(hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
          u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
        return v;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        float aspect = u_resolution.x / u_resolution.y;
        vec2 p = vec2(uv.x * aspect, uv.y) * 2.5;
        float t = u_time * 0.12;

        float w1 = fbm(p + vec2(t * 0.3, t * 0.2));
        float w2 = fbm(p * 1.4 + vec2(-t * 0.25, t * 0.4) + w1 * 0.7);
        float w3 = fbm(p * 0.7 + vec2(t * 0.15, -t * 0.15) + w2 * 0.5);

        vec2 m = u_mouse / u_resolution;
        float mGlow = smoothstep(0.45, 0.0, length(uv - m)) * 0.06;

        vec3 bg     = vec3(0.047, 0.051, 0.063);
        vec3 dark   = vec3(0.082, 0.086, 0.094);
        vec3 ember  = vec3(0.98, 0.22, 0.0);
        vec3 orange = vec3(0.98, 0.42, 0.16);
        vec3 glow   = vec3(1.0, 0.54, 0.34);
        vec3 desat  = vec3(0.15, 0.16, 0.18);

        vec3 col = bg;
        col = mix(col, dark,   smoothstep(-0.3, 0.3, w1) * 0.5);
        col = mix(col, desat,  smoothstep(0.0, 0.5, w2) * 0.3);
        col = mix(col, ember,  smoothstep(0.25, 0.75, w2) * 0.09);
        col = mix(col, orange, smoothstep(0.35, 0.85, w3) * 0.07);
        col = mix(col, glow,   smoothstep(0.55, 1.0, w2 + w3) * 0.035);
        col += ember * mGlow;

        float vig = 1.0 - smoothstep(0.3, 1.3, length((uv - 0.5) * vec2(1.3, 1.0)));
        col *= 0.65 + vig * 0.35;

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog); gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var uTime  = gl.getUniformLocation(prog, 'u_time');
    var uRes   = gl.getUniformLocation(prog, 'u_resolution');
    var uMouse = gl.getUniformLocation(prog, 'u_mouse');

    var t0 = performance.now();
    glRender = function () {
      var t = (performance.now() - t0) / 1000;
      gl.uniform1f(uTime, t);
      gl.uniform2f(uRes, c.width, c.height);
      gl.uniform2f(uMouse, mx * (c.width / window.innerWidth), c.height - my * (c.height / window.innerHeight));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }

  /* ════════════════════════════════════════════════════════════
     LAYER 2 — Interactive Particles + Connections
     ════════════════════════════════════════════════════════════ */
  function initParticles() {
    var c = document.getElementById('fileshotParticles');
    if (!c) return;
    var ctx = c.getContext('2d');
    var W, H;
    var mouse = { x: null, y: null, radius: 180 };
    var particles = [];

    function resize() { W = c.width = window.innerWidth; H = c.height = window.innerHeight; }
    window.addEventListener('resize', resize);
    resize();

    document.addEventListener('mousemove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; });
    document.addEventListener('mouseleave', function () { mouse.x = null; mouse.y = null; });

    var colors = [
      [250, 56, 0],
      [250, 106, 42],
      [255, 138, 87],
      [210, 210, 218]
    ];

    function Particle() { this.reset(true); }
    Particle.prototype.reset = function () {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.vx = (Math.random() - 0.5) * 0.35;
      this.vy = (Math.random() - 0.5) * 0.35;
      this.r = Math.random() * 2.2 + 0.4;
      var pick = Math.random();
      this.color = pick < 0.4 ? colors[0] : pick < 0.7 ? colors[1] : pick < 0.9 ? colors[2] : colors[3];
      this.baseAlpha = 0.12 + Math.random() * 0.28;
      this.alpha = this.baseAlpha;
    };
    Particle.prototype.update = function () {
      if (mouse.x !== null) {
        var dx = this.x - mouse.x, dy = this.y - mouse.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mouse.radius && dist > 5) {
          var force = (mouse.radius - dist) / mouse.radius * 0.02;
          this.vx += (dx / dist) * force;
          this.vy += (dy / dist) * force;
          this.alpha = this.baseAlpha + (1 - dist / mouse.radius) * 0.3;
        } else {
          this.alpha += (this.baseAlpha - this.alpha) * 0.02;
        }
      } else {
        this.alpha += (this.baseAlpha - this.alpha) * 0.02;
      }
      this.x += this.vx; this.y += this.vy;
      this.vx *= 0.998; this.vy *= 0.998;
      if (this.x < -20) this.x = W + 20;
      if (this.x > W + 20) this.x = -20;
      if (this.y < -20) this.y = H + 20;
      if (this.y > H + 20) this.y = -20;
    };
    Particle.prototype.draw = function () {
      var r = this.color[0], g = this.color[1], b = this.color[2];
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (this.alpha * 0.15) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + this.alpha + ')';
      ctx.fill();
    };

    // Adaptive count: fewer on mobile
    var count = isMobile
      ? Math.min(60, Math.floor(W * H / 20000))
      : Math.min(200, Math.floor(W * H / 7000));
    for (var i = 0; i < count; i++) particles.push(new Particle());

    function drawConnections() {
      var maxDist = isMobile ? 90 : 130;
      var maxDistSq = maxDist * maxDist;
      for (var i = 0; i < particles.length; i++) {
        for (var j = i + 1; j < particles.length; j++) {
          var dx = particles[i].x - particles[j].x;
          var dy = particles[i].y - particles[j].y;
          var distSq = dx * dx + dy * dy;
          if (distSq < maxDistSq) {
            var proximity = 1 - distSq / maxDistSq;
            var boost = 1;
            if (mouse.x !== null) {
              var midX = (particles[i].x + particles[j].x) / 2;
              var midY = (particles[i].y + particles[j].y) / 2;
              var mDist = Math.sqrt((midX - mouse.x) * (midX - mouse.x) + (midY - mouse.y) * (midY - mouse.y));
              if (mDist < mouse.radius) boost = 1 + (1 - mDist / mouse.radius) * 2.5;
            }
            var alpha = proximity * 0.08 * boost;
            ctx.strokeStyle = 'rgba(250,106,42,' + Math.min(alpha, 0.3) + ')';
            ctx.lineWidth = proximity * 0.8;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
    }

    function drawMouseGlow() {
      if (mouse.x === null) return;
      var grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, mouse.radius);
      grad.addColorStop(0, 'rgba(250,56,0,0.04)');
      grad.addColorStop(0.5, 'rgba(250,106,42,0.015)');
      grad.addColorStop(1, 'rgba(250,106,42,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(mouse.x - mouse.radius, mouse.y - mouse.radius, mouse.radius * 2, mouse.radius * 2);
    }

    /* ── Main loop ────────────────────────────────────────── */
    function animate() {
      ctx.clearRect(0, 0, W, H);
      if (glRender) glRender();
      drawMouseGlow();
      for (var i = 0; i < particles.length; i++) { particles[i].update(); particles[i].draw(); }
      drawConnections();
      requestAnimationFrame(animate);
    }
    animate();
  }

  /* ── Boot (after first paint — CWV main-thread) ─────────── */
  function boot() {
    document.body.classList.add('has-hybrid-bg');
    initWebGL();
    initParticles();
  }
  function scheduleBoot() {
    var run = function () { boot(); };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 1);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBoot);
  } else {
    scheduleBoot();
  }
})();
