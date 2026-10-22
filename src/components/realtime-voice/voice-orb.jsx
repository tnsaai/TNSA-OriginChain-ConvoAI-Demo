'use client';
// Voice orb copied from GensChat (OrbUI/Orb.jsx) so the Platform's realtime playground matches its look.

import { useEffect, useRef } from 'react';

/* ------------------------------------------------------------------ */
/*  Shaders                                                            */
/* ------------------------------------------------------------------ */

const VERT = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vPos;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uLight;    // brightest tone
uniform vec3  uMid;      // midtone
uniform vec3  uDeep;     // saturated tone
uniform vec2  uAxis;     // direction the gradient travels
uniform float uGrain;
uniform float uScale;    // noise frequency

uniform float uLevel;    // 0..1 overall loudness
uniform float uBass;     // 0..1 voice fundamentals
uniform float uTreble;   // 0..1 consonants, sibilance

/* gradient noise ---------------------------------------------------- */
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  mat2 m = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    s += a * gnoise(p);
    p = m * p * 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  /* square, aspect-correct space: -1..1 across the shorter side */
  vec2 p = vPos;
  float aspect = uRes.x / uRes.y;
  if (aspect > 1.0) p.x *= aspect; else p.y /= aspect;

  float r = length(p);
  float t = uTime;

  /* Keep the orb itself perfectly still; audio only drives its fluid. */
  float R = 0.68;

  float aa   = 2.0 / min(uRes.x, uRes.y) * 1.5;
  float mask = 1.0 - smoothstep(R - aa, R + aa, r);

  /* A restrained, fixed halo keeps the silhouette stable. */
  float halo = exp(-max(r - R, 0.0) * 18.0) * 0.06 * (1.0 - mask);
  vec3  haloCol = mix(uDeep, uMid, 0.45);

  vec3  col = vec3(0.0);
  if (mask > 0.0) {
    /* fake sphere curvature so the pattern compresses at the rim */
    float z  = sqrt(max(R * R - r * r, 0.0)) / R;
    vec2  sp = p / (0.55 + 0.45 * z) * uScale;

    /* Advect the liquid across the sphere instead of scaling its pattern.
       Two counter-currents create the slow rolling motion of ocean water. */
    vec2 currentA = vec2(t * (0.16 + uBass * 0.045), -t * 0.068);
    vec2 currentB = vec2(-t * (0.10 + uLevel * 0.035), t * 0.12);

    float curl = fbm(sp * 0.72 + currentA * 0.38);
    float angle = curl * (1.38 + uLevel * 0.50) + sin(t * 0.18) * 0.11;
    float ca = cos(angle);
    float sa = sin(angle);
    mat2 swirl = mat2(ca, -sa, sa, ca);
    vec2 advected = swirl * sp;
    advected += vec2(
      sin(advected.y * 1.45 + t * 0.52),
      cos(advected.x * 1.30 - t * 0.43)
    ) * (0.15 + uLevel * 0.13);

    vec2 q = vec2(
      fbm(advected + currentA),
      fbm(advected + vec2(4.7, 2.3) + currentB)
    );
    vec2 w = vec2(
      fbm(advected + q * (1.55 + uLevel * 0.70) + currentB + vec2(1.7, 9.2)),
      fbm(advected - q * (1.25 + uBass * 0.55) - currentA + vec2(8.3, 2.8))
    );
    float f = fbm(advected + w * (1.75 + uLevel * 0.65) + currentA * 0.42);

    /* Traveling ribbons make the direction of flow visible. */
    float ribbonA = sin(advected.y * 2.15 + q.x * 2.4 - t * 0.68);
    float ribbonB = sin(dot(advected, normalize(vec2(0.82, 0.36))) * 2.85 + w.y * 2.0 + t * 0.50);
    float axis = dot(p / R, normalize(uAxis));
    float g = axis * 0.50 + f * 0.72 + (w.x + w.y) * 0.20 + ribbonA * 0.20 + ribbonB * 0.14;

    /* Fixed thresholds keep the color masses flowing rather than growing. */
    float m1 = smoothstep(-0.62, 0.30, g);
    float m2 = smoothstep(-0.08, 0.78, g);

    col = mix(uLight, uMid, m1);
    col = mix(col, uDeep, m2);
    col *= 0.88 + 0.12 * z;
    col += uLight * uLevel * 0.045 * z;  // restrained shimmer on peaks

    /* grain: heaviest at the terminator, sharpened by consonants */
    float band  = 1.0 - abs(m1 * 2.0 - 1.0);
    float speck = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + t) * 43758.5453);
    col += (speck - 0.5) * (uGrain + uTreble * 0.09) * (0.25 + 0.75 * band);
  }

  /* premultiplied: orb over halo over whatever is behind the canvas */
  gl_FragColor = vec4(col * mask + haloCol * halo, mask + halo);
}`;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function compile(gl, type, src) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    console.error(info || 'Orb shader failed to compile');
    return null;
  }
  return s;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const SILENT = { level: 0, bass: 0, treble: 0 };

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Orb({
  size = /** @type {number | string} */ (320),
  speed = 1,
  light = '#eff6ff',
  mid = '#60a5fa',
  deep = '#2563eb',
  axis = [0.72, 0.69],
  grain = 0.05,
  scale = 1.6,
  levels = /** @type {{ current: { level: number, bass: number, treble: number } } | null} */ (null), // ref of live audio levels
  level = /** @type {number | undefined} */ (undefined), // or drive it with a plain 0..1 number
  reactivity = 1,
  className,
  style = {},
}) {
  const canvasRef = useRef(null);

  const props = useRef(null);
  props.current = { speed, light, mid, deep, axis, grain, scale, levels, level, reactivity };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
    if (!gl) return;

    const program = gl.createProgram();
    if (!program) return;
    const vertexShader = compile(gl, gl.VERTEX_SHADER, VERT);
    const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      gl.deleteProgram(program);
      return;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteProgram(program);
      console.error(info || 'Orb shader program failed to link');
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (n) => gl.getUniformLocation(program, n);
    const loc = {
      res: u('uRes'), time: u('uTime'),
      light: u('uLight'), mid: u('uMid'), deep: u('uDeep'),
      axis: u('uAxis'), grain: u('uGrain'), scale: u('uScale'),
      level: u('uLevel'), bass: u('uBass'), treble: u('uTreble'),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let last = performance.now();
    let clock = 8.0;
    let running = true;
    let smoothLevel = 0;
    let smoothBass = 0;
    let smoothTreble = 0;

    const read = () => {
      const p = props.current;
      const src = p.levels?.current ?? (typeof p.level === 'number' ? { level: p.level, bass: p.level, treble: p.level * 0.5 } : SILENT);
      const k = p.reactivity;
      return {
        level: Math.min(1, (src.level || 0) * k),
        bass: Math.min(1, (src.bass || 0) * k),
        treble: Math.min(1, (src.treble || 0) * k),
      };
    };

    const loop = (now) => {
      const p = props.current;
      const target = read();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      /* Fast enough to feel speech, slow enough to remain liquid. */
      const levelFollow = 1 - Math.exp(-dt * (target.level > smoothLevel ? 7.0 : 2.4));
      const detailFollow = 1 - Math.exp(-dt * 4.0);
      smoothLevel += (target.level - smoothLevel) * levelFollow;
      smoothBass += (target.bass - smoothBass) * detailFollow;
      smoothTreble += (target.treble - smoothTreble) * detailFollow;
      const a = { level: smoothLevel, bass: smoothBass, treble: smoothTreble };

      /* speech both speeds the flow up and, under reduced motion, is the
         only thing that moves it at all */
      const base = reduced ? 0 : p.speed;
      clock += dt * (base + p.speed * a.level * 1.65 + p.speed * a.bass * 0.35);

      resize();
      gl.uniform2f(loc.res, canvas.width, canvas.height);
      gl.uniform1f(loc.time, clock);
      gl.uniform3fv(loc.light, hexToRgb(p.light));
      gl.uniform3fv(loc.mid, hexToRgb(p.mid));
      gl.uniform3fv(loc.deep, hexToRgb(p.deep));
      gl.uniform2f(loc.axis, p.axis[0], p.axis[1]);
      gl.uniform1f(loc.grain, p.grain);
      gl.uniform1f(loc.scale, p.scale);
      gl.uniform1f(loc.level, a.level);
      gl.uniform1f(loc.bass, a.bass);
      gl.uniform1f(loc.treble, a.treble);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    /* stop burning frames when the orb scrolls out of view */
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      } else if (!entry.isIntersecting && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(canvas);

    const onLost = (e) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteBuffer(buffer);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, display: 'block', ...style }}
    />
  );
}
