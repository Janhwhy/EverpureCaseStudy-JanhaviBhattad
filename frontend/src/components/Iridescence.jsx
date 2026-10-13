// From React Bits "Iridescence" (https://reactbits.dev, MIT). Login page background.
// Changes: plain WebGL instead of ogl (no extra dependency), and the rainbow output is remapped
// onto the app palette as a metallic ramp (blue-dominant: ink → navy → steel, with cream highlights).
import { useEffect, useRef } from 'react';

const VERTEX = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uAmplitude;
uniform float uSpeed;
varying vec2 vUv;

const vec3 INK = vec3(0.106, 0.149, 0.196);
const vec3 NAVY = vec3(0.173, 0.231, 0.302);
const vec3 STEEL = vec3(0.290, 0.400, 0.533);
const vec3 CREAM = vec3(0.933, 0.914, 0.875);

void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv * 2.0 - 1.0) * uResolution / mr;
  uv += (uMouse - vec2(0.5)) * uAmplitude;

  // Original Iridescence field.
  float d = -uTime * 0.5 * uSpeed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * uv.x);
    d += sin(uv.y * i + a);
  }
  d += uTime * 0.5 * uSpeed;
  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5);

  // Metallic remap: blue carries the body (ink → navy → steel), cream only on polished ridges.
  float t = clamp(dot(col, vec3(0.3, 0.45, 0.25)), 0.0, 1.0);
  t = pow(smoothstep(0.4, 1.0, t), 2.2);
  vec3 metal = mix(INK, NAVY, smoothstep(0.0, 0.3, t));
  metal = mix(metal, STEEL, smoothstep(0.3, 0.8, t));
  metal = mix(metal, CREAM, pow(smoothstep(0.86, 1.0, t), 2.0) * 0.85);

  // Vignette keeps the centre (where the form sits) calm.
  float v = smoothstep(1.5, 0.2, length((vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0)));
  metal = mix(INK, metal, 0.35 + 0.65 * v);
  gl_FragColor = vec4(metal, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

export default function Iridescence({ className = '', speed = 0.35, amplitude = 0.08, mouseReact = true }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = document.createElement('canvas');
    canvas.className = 'iridescence-canvas';
    container.appendChild(canvas);
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) { canvas.remove(); return undefined; } // the container's ink background stays as fallback

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const u = (name) => gl.getUniformLocation(program, name);
    const uTime = u('uTime');
    const uResolution = u('uResolution');
    const uMouse = u('uMouse');
    gl.uniform1f(u('uAmplitude'), amplitude);
    gl.uniform1f(u('uSpeed'), speed);
    gl.uniform2f(uMouse, 0.5, 0.5);

    // Rendered at reduced resolution: the field is smooth, and this keeps the 8-step loop cheap.
    const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    function resize() {
      canvas.width = Math.max(1, Math.round(container.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(container.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    function draw(ms) {
      gl.uniform1f(uTime, ms * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) frame = requestAnimationFrame(draw);
    }
    if (reduced) draw(12000); else frame = requestAnimationFrame(draw);

    function onMove(e) {
      const rect = container.getBoundingClientRect();
      gl.uniform2f(uMouse, (e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height);
      if (reduced) draw(12000);
    }
    if (mouseReact) window.addEventListener('mousemove', onMove);

    // No loseContext() here: under StrictMode the effect re-runs and a lost context would render blank.
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('mousemove', onMove);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      canvas.remove();
    };
  }, [speed, amplitude, mouseReact]);

  return <div ref={containerRef} className={`iridescence ${className}`} aria-hidden="true" />;
}
