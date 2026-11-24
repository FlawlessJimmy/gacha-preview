// 가챠 머신 설치 미리보기
// 복도 사진 한 장을 카메라 보정값으로 벽·바닥·천장 면에 되비추고(프로젝션 매핑),
// 그 3D 공간 안에 머신을 세운다. 사진을 찍은 자리에서는 원본 사진과 똑같이 보인다.
import * as THREE from 'three';

/* ───────── 사진에서 구한 카메라 보정값 (소실점 3개로 계산) ───────── */
const CAL = {
  W: 1746, H: 870,                 // 원본 사진 크기(px)
  c: [894.45, 426.669],            // 주점
  f: 587.4916,                     // 초점거리(px)
  M: [[0.647551, 0.000457, -0.762022],   // 월드 → 카메라(이미지 축: x 오른쪽, y 아래, z 앞)
      [0.137146, -0.983741, 0.115955],
      [-0.749579, -0.179595, -0.637085]],
  h: 1.5,                          // 카메라 높이(가정)
  d: 2.623,                        // 카메라에서 왼쪽 벽까지
};
const D = CAL.d, CEIL = 3.28, ZEND = -23.6, XR = 14, ZBACK = 2.6;
const P0 = new THREE.Vector3(0, CAL.h, 0);

/* 벽을 따라 잰 위치(z, m). 카메라 발밑이 0, 복도 안쪽이 음수 */
const HYD = { a: -2.14, b: -2.74 };          // 소화전함
const BLOCK = { a: -1.92, b: -3.14 };        // 소화전함 + 소화기 2대가 차지하는 구간
const CLEAR = 0.6;                           // 그 앞뒤로 비워 둘 여유
const Z_MIN = -9.6, Z_MAX = -2.4;            // 슬라이더 범위(엘리베이터 앞 ~ 소화전)

/* 머신 규격: W 650 × D 500 × H 1750mm (바퀴 포함 높이) */
const PXW = 377, PXH = 1028;                 // 앞면 사진 크기(px)
const BASE = { W: 0.65, D: 0.50, H: 1.75, caster: 0.055 };
BASE.Hb = BASE.H - BASE.caster;              // 바퀴를 뺀 몸통 높이

const S = { z: -6.75, rot: 0, h: 1.75, on: false, view: 'entry', variant: 'red' };

/* 디자인 5종. 손잡이·배출구 위치는 앞면 그림(754×2056) 기준 픽셀 */
const VARIANTS = [
  { id: 'red',    tex: 'machine-front', body: 0xc8161d, knob: { x: 208, y: 1420, c: 0xf1eeea }, outlet: { x: 556, y: 1652, c: 0x8a7bff }, led: { mode: 0, c: 0xffffff }, glow: 0xff3c32, glowA: 0.2 },
  { id: 'daybe',  tex: 'front-daybe',   body: 0xe2c00c, knob: { x: 200, y: 1410, c: 0xf2ecd0 }, outlet: null, led: null, glow: 0xffd628, glowA: 0.16 },
  { id: 'mlb',    tex: 'front-mlb',     body: 0x8eaef5, knob: { x: 186, y: 1420, c: 0xc3d4fa }, outlet: null, led: null, glow: 0x78a0ff, glowA: 0.14 },
  { id: 'mttire', tex: 'front-mttire',  body: 0xdad4cf, knob: { x: 202, y: 1410, c: 0xf5f5f5 }, outlet: { x: 548, y: 1644, c: 0x22a8ff }, led: { mode: 1, c: 0x1fa9ff }, glow: 0x3ca0ff, glowA: 0.16 },
  { id: 'hyatt',  tex: 'front-hyatt',   body: 0xe2e4ec, knob: { x: 208, y: 1484, c: 0xf3f1e6 }, outlet: { x: 548, y: 1714, c: 0x6fc6ff }, led: { mode: 1, c: 0x86d2ff }, glow: 0x96c8ff, glowA: 0.1 },
];
const TW = 754, TH = 2056;
const src = (n) => (window.__ASSETS && window.__ASSETS[n]) || `assets/${n}.jpg?v=8`;

const $ = (s) => document.querySelector(s);
const canvas = $('#view');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────── 렌더러 ───────── */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setClearColor(0x0f0f11, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80);
camera.rotation.order = 'YXZ';

// 머신은 복도 사진에서 뽑은 환경 빛(아래 updateEnv)으로 비춘다. 여기 조명은 형태를 잡아 주는 보조광.
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
scene.add(new THREE.HemisphereLight(0xffffff, 0xa89c90, 0.55));
const sun = new THREE.DirectionalLight(0xfff1df, 0.9);       // 천장 다운라이트 방향
sun.position.set(1.5, 6, 0.5);
scene.add(sun);

/* ───────── 사진을 면에 되비추는 재질 ───────── */
const M3 = new THREE.Matrix3().set(...CAL.M[0], ...CAL.M[1], ...CAL.M[2]);
const stageUniforms = {
  uPhoto: { value: null }, uWall: { value: null }, uFloor: { value: null }, uEnv: { value: 0 },
  uAtlas: { value: new THREE.Vector4(-1.0, -11.2, 3.28, 1.6) },    // 정면으로 편 벽·바닥 그림의 범위(z 시작, z 끝, 천장, 바닥 폭 끝)
  uM: { value: M3 }, uC: { value: P0.clone() },
  uD: { value: CAL.d }, uF: { value: CAL.f }, uPP: { value: new THREE.Vector2(...CAL.c) }, uSize: { value: new THREE.Vector2(CAL.W, CAL.H) },
};
const stageVert = /* glsl */`
  varying vec3 vW;
  void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const stageFrag = /* glsl */`
  precision highp float;
  uniform sampler2D uPhoto; uniform sampler2D uWall; uniform sampler2D uFloor; uniform vec4 uAtlas; uniform float uD;
  uniform mat3 uM; uniform vec3 uC; uniform float uF; uniform vec2 uPP; uniform vec2 uSize;
  uniform float uKind;            // 0 바닥, 1 왼쪽 벽, 2 천장·끝벽, 3 사진에 없는 면
  uniform float uEnv;             // 1이면 머신에 비칠 환경을 굽는 중
  varying vec3 vW;
  float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  void main(){
    vec3 wp = vW;
    vec3 pc = uM * (wp - uC);
    vec2 px = uPP + uF * pc.xy / pc.z;
    // 사진 오른쪽 끝을 넘어간 바닥·천장·끝벽: 같은 깊이의 마지막 줄을 복도를 가로질러 이어 붙인다
    // (카펫 줄무늬와 천장은 복도를 가로질러 같은 모양이므로 가장 그럴듯한 연장이다)
    float ext = 0.0;
    if (uKind < 0.5 || (uKind > 1.5 && uKind < 2.5)) {
      float k = uSize.x * 0.98 - uPP.x;
      vec3 q = uF * vec3(uM[0][0], uM[1][0], uM[2][0]) - k * vec3(uM[0][2], uM[1][2], uM[2][2]);
      vec3 v = wp - uC;
      float xs = uC.x - (q.y * v.y + q.z * v.z) / q.x;
      if (wp.x > xs) { ext = wp.x - xs; wp.x = xs; pc = uM * (wp - uC); px = uPP + uF * pc.xy / pc.z; }
    }
    vec2 uv = vec2(px.x/uSize.x, 1.0 - px.y/uSize.y);
    vec3 col;
    vec3 avg = texture2D(uPhoto, vec2(0.5), 12.0).rgb;        // 사진 전체의 평균색
    if (pc.z <= 0.02) {
      col = avg * mix(0.1, 0.8, uEnv);
    } else {
      vec3 photo = texture2D(uPhoto, clamp(uv, 0.0015, 0.9985)).rgb;
      vec2 g = uKind > 0.5 ? vW.zy : vW.xz;                     // 면 위의 좌표(m)
      float m = max(length(dFdx(px)), length(dFdy(px)));       // 화면 1px이 사진 몇 px인지
      float mmin = min(length(dFdx(px)), length(dFdy(px)));
      // 멀리 비스듬히 찍혀 해상도가 낮은 곳은, 미리 정면으로 펴서 다듬어 둔 그림으로 바꿔 쓴다
      if (uKind < 1.5) {
        mat2 G = mat2(dFdx(g), dFdy(g));
        float det = G[0][0]*G[1][1] - G[0][1]*G[1][0];
        if (abs(det) > 1e-12) {
          mat2 J = mat2(dFdx(px), dFdy(px)) * inverse(G);       // 사진 px / m
          float lowRes = min(length(J[0]), length(J[1]));
          vec2 ua = uKind > 0.5 ? vec2((wp.z-uAtlas.x)/(uAtlas.y-uAtlas.x), wp.y/uAtlas.z)
                                : vec2((wp.z-uAtlas.x)/(uAtlas.y-uAtlas.x), (wp.x+uD)/(uAtlas.w+uD));
          float ea = min(min(ua.x, 1.0-ua.x), min(ua.y, 1.0-ua.y));
          float t = smoothstep(200.0, 120.0, lowRes) * smoothstep(0.85, 0.45, mmin) * smoothstep(0.0, 0.03, ea) * (uKind < 1.5 ? 1.0 : 0.0);
          if (t > 0.0) {
            vec3 at = uKind > 0.5 ? texture2D(uWall, ua).rgb : texture2D(uFloor, ua).rgb;
            photo = mix(photo, at, t);
          }
        }
      }
      // 확대되어 흐려지는 곳에는 재질의 결(돌·카펫 알갱이)을 보탠다
      float amt = smoothstep(0.9, 0.22, m);
      float wpp = max(length(dFdx(g)), length(dFdy(g)));
      float n = (vnoise(g*340.0)-0.5) * smoothstep(0.9,0.3,wpp*340.0) * 0.9
              + (vnoise(g*128.0)-0.5) * smoothstep(0.9,0.3,wpp*128.0) * 0.7
              + (vnoise(g*47.0)-0.5)  * smoothstep(0.9,0.3,wpp*47.0)  * 0.12;
      float luma = dot(photo, vec3(0.299,0.587,0.114));
      float amp = (uKind < 0.5 ? 0.20 : (uKind < 1.5 ? 0.17 : 0.0)) * (1.0 - smoothstep(0.55, 0.9, luma));
      photo *= 1.0 + amp * amt * n * 2.0;
      // 사진에 없는 곳은 가장자리 색을 흐리게 이어 붙이고, 멀어질수록 어둡게 한다
      float e = min(min(uv.x, 1.0-uv.x), min(uv.y, 1.0-uv.y));
      float far = smoothstep(0.0, 0.9, length(max(abs(uv-0.5)-0.5, 0.0)));
      vec3 fb = mix(texture2D(uPhoto, clamp(uv, 0.06, 0.94), 9.5).rgb, avg, smoothstep(0.0, 0.35, far)) * mix(mix(0.6, 0.1, far), 0.8, uEnv);
      photo *= mix(1.0, 0.7, smoothstep(0.0, 8.0, ext));        // 이어 붙인 곳은 멀수록 조금 어둡게
      col = mix(fb, photo, smoothstep(0.0, 0.012, e));
    }
    if (uKind > 2.5) col = avg * mix(0.42, 0.8, uEnv) * (0.8 + 0.2 * smoothstep(0.0, 3.2, vW.y));   // 사진에 없는 벽은 방 색에 맞춘 중간 톤으로
    if (uEnv > 0.5) {                                             // 환경용: 하얗게 날아간 조명을 실제 조명처럼 더 밝게
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= 1.0 + 7.0 * pow(smoothstep(0.7, 1.0, l), 2.0);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;
function stageMat(kind) {
  return new THREE.ShaderMaterial({
    uniforms: { ...stageUniforms, uKind: { value: kind } },
    vertexShader: stageVert, fragmentShader: stageFrag, side: THREE.DoubleSide,
  });
}
function quad(a, b, c, d, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m); return m;
}
quad([-D, 0, ZBACK], [XR, 0, ZBACK], [XR, 0, ZEND], [-D, 0, ZEND], stageMat(0));             // 바닥
quad([-D, 0, ZBACK], [-D, 0, ZEND], [-D, CEIL, ZEND], [-D, CEIL, ZBACK], stageMat(1));       // 왼쪽 벽
quad([-D, CEIL, ZBACK], [XR, CEIL, ZBACK], [XR, CEIL, ZEND], [-D, CEIL, ZEND], stageMat(2)); // 천장
quad([-D, 0, ZEND], [XR, 0, ZEND], [XR, CEIL, ZEND], [-D, CEIL, ZEND], stageMat(2));         // 복도 끝
quad([XR, 0, ZBACK], [XR, 0, ZEND], [XR, CEIL, ZEND], [XR, CEIL, ZBACK], stageMat(3));       // 사진에 없는 오른쪽·뒤쪽도 막아 둔다
quad([-D, 0, ZBACK], [XR, 0, ZBACK], [XR, CEIL, ZBACK], [-D, CEIL, ZBACK], stageMat(3));

/* ───────── 그림자·표시용 그림(캔버스로 직접 그림) ───────── */
function softRect(w, h, blur, round) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.shadowColor = '#000'; x.shadowBlur = blur; x.shadowOffsetX = w * 2; x.fillStyle = '#000';
  const p = blur * 1.6;
  x.beginPath(); x.roundRect(p - w * 2, p, w - p * 2, h - p * 2, round); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function radial(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => g.addColorStop(o, col)); x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function hatch() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = 'rgba(255,70,60,.30)'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 9;
  for (let i = -128; i < 256; i += 32) { x.beginPath(); x.moveTo(i, 128); x.lineTo(i + 128, 0); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const decal = (map, opacity, color = 0x000000, blending = THREE.NormalBlending) => new THREE.MeshBasicMaterial({
  map, color, opacity, transparent: true, depthWrite: false, blending, toneMapped: false,
  polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
});

/* ───────── 머신 ───────── */
const ledUniforms = { uTime: { value: 0 }, uAlpha: { value: 1 }, uMode: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) } };
function buildMachine(tex) {
  const root = new THREE.Group();           // 원점: 바닥, 발자국 한가운데. 앞면 = +Z
  const inner = new THREE.Group(); root.add(inner);
  const { W, D: Dp, caster: c, Hb } = BASE, R = W / 2, s = W / PXW, sy = Hb / PXH, Ry = 188.5 * sy;

  const shape = new THREE.Shape();
  shape.moveTo(-R, 0); shape.lineTo(R, 0); shape.lineTo(R, Hb - Ry);
  shape.absellipse(0, Hb - Ry, R, Ry, 0, Math.PI, false, 0); shape.lineTo(-R, 0);

  // 모서리를 4mm 굴린 몸통. 도장한 판재처럼 살짝 광이 돌고, 복도 조명이 비친다.
  const bv = 0.004;
  const inset = new THREE.Shape();
  inset.moveTo(-R + bv, bv); inset.lineTo(R - bv, bv); inset.lineTo(R - bv, Hb - Ry);
  inset.absellipse(0, Hb - Ry, R - bv, Ry - bv, 0, Math.PI, false, 0); inset.lineTo(-R + bv, bv);
  // 바닥과 벽에 가까울수록 빛이 덜 드는 것을 꼭짓점 색으로 굽는다
  const bake = (geo, z0) => {
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i) + z0;
      const a = lerp(0.5, 1, THREE.MathUtils.smoothstep(y, 0, 0.6)) * lerp(0.7, 1, THREE.MathUtils.smoothstep(z, -Dp / 2, Dp / 2));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = a;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return geo;
  };
  const red = new THREE.MeshPhysicalMaterial({ color: 0xc8161d, roughness: 0.4, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.3, vertexColors: true });
  const body = new THREE.Mesh(bake(new THREE.ExtrudeGeometry(inset, { depth: Dp - bv * 2, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 3, curveSegments: 48 }), -Dp / 2 + bv), red);
  body.position.set(0, c, -Dp / 2 + bv); inner.add(body);

  // 앞면: 제품 사진을 그대로 붙인다
  const fg = bake(new THREE.ShapeGeometry(inset, 48), Dp / 2);
  const uv = fg.attributes.uv, pos = fg.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(0.004, 0.996, (pos.getX(i) + R) / W), lerp(0.002, 0.998, pos.getY(i) / Hb));
  // 앞면은 아크릴처럼 반사가 얹히되, 인쇄와 조명은 스스로도 조금 빛나게 해서 사진의 밝기를 지킨다
  const front = new THREE.Mesh(fg, new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3,
    roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, vertexColors: true }));
  front.position.set(0, c, Dp / 2 + 0.0015); inner.add(front);

  // LED 테두리: 알약 모양 길을 따라 도는 빛
  const Rc = (188 - 11) * s, Rcy = (188 - 11) * sy, yTop = c + Hb - 188 * sy, yBot = c + Hb - 455 * sy, zf = Dp / 2 + 0.014;
  const pts = [];
  for (let i = 0; i <= 28; i++) { const a = Math.PI * i / 28; pts.push(new THREE.Vector3(Rc * Math.cos(a), yTop + Rcy * Math.sin(a), zf)); }
  for (let i = 1; i < 8; i++) pts.push(new THREE.Vector3(-Rc, lerp(yTop, yBot, i / 8), zf));
  for (let i = 0; i <= 28; i++) { const a = Math.PI + Math.PI * i / 28; pts.push(new THREE.Vector3(Rc * Math.cos(a), yBot + Rcy * Math.sin(a), zf)); }
  for (let i = 1; i < 8; i++) pts.push(new THREE.Vector3(Rc, lerp(yBot, yTop, i / 8), zf));
  const path = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const ledFrag = (halo) => /* glsl */`
    precision highp float; uniform float uTime; uniform float uAlpha; uniform float uMode; uniform vec3 uColor; varying vec2 vUv;
    void main(){
      float t = vUv.x * 2.0 - uTime * 0.07;
      vec3 col = vec3(0.72,0.74,0.98) + vec3(0.28,0.26,0.04)*cos(6.2832*(t + vec3(0.0,0.45,0.2)));   // 분홍·흰색·파랑·청록
      col = mix(col, vec3(1.0), ${halo ? '0.0' : '0.22'});
      if (uMode > 0.5) col = mix(uColor, vec3(1.0), ${halo ? '0.0' : '0.42 + 0.14*sin(6.2832*t)'});      // 한 가지 색 네온
      float tw = 0.94 + 0.06*sin(uTime*2.3 + vUv.x*40.0);
      gl_FragColor = vec4(col*tw, ${halo ? '0.13' : '1.0'} * uAlpha);
    }`;
  const ledVert = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
  const led = new THREE.Mesh(new THREE.TubeGeometry(path, 220, 11 * s, 10, true),
    new THREE.ShaderMaterial({ uniforms: ledUniforms, vertexShader: ledVert, fragmentShader: ledFrag(false) }));
  const halo = new THREE.Mesh(new THREE.TubeGeometry(path, 220, 21 * s, 10, true),
    new THREE.ShaderMaterial({ uniforms: ledUniforms, vertexShader: ledVert, fragmentShader: ledFrag(true), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.z = 0.2; halo.position.z = zf * 0.8;
  inner.add(led, halo);

  // 손잡이, 배출구 불빛, 바퀴
  const white = new THREE.MeshStandardMaterial({ color: 0xf1eeea, roughness: 0.45 });
  const kx = (104 / PXW - 0.5) * W, ky = c + (PXH - 710) * sy;
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(30 * s, 31 * s, 0.034, 40), white);
  knob.rotation.x = Math.PI / 2; knob.position.set(kx, ky, Dp / 2 + 0.017);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(58 * s, 13 * s, 0.022), white); bar.position.set(kx, ky, Dp / 2 + 0.043);
  const ox = (278 / PXW - 0.5) * W, oy = c + (PXH - 826) * sy;
  const outlet = new THREE.Mesh(new THREE.TorusGeometry(52 * s, 11 * s, 14, 48), new THREE.MeshBasicMaterial({ color: 0x8a7bff, toneMapped: false }));
  outlet.scale.z = 0.45; outlet.position.set(ox, oy, Dp / 2 + 0.006);
  inner.add(knob, bar, outlet);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.026, 20), dark);
    w.rotation.z = Math.PI / 2; w.position.set(sx * (R - 0.06), 0.027, sz * (Dp / 2 - 0.06)); inner.add(w);
  }

  // 바닥에 닿는 그림자와 빨간 반사광
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.62, Dp + 0.7), decal(softRect(256, 256, 34, 18), 0.62));
  sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.004, 0.06); sh.renderOrder = 2;
  const sh2 = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.16, Dp + 0.16), decal(softRect(128, 128, 12, 8), 0.6));   // 바퀴 밑, 바닥에 바짝 붙은 진한 그림자
  sh2.rotation.x = -Math.PI / 2; sh2.position.set(0, 0.0045, 0); sh2.renderOrder = 2; root.add(sh2);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.5),
    decal(radial(128, [[0, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]), 0.2, 0xff3c32));
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.005, Dp / 2 + 0.45); glow.renderOrder = 3;
  root.add(sh, glow);
  const place = (m, px, py, z) => m.position.set((px / TW - 0.5) * W, c + (1 - py / TH) * Hb, z);
  return { root, inner, outlet, sh, sh2, glow, front, red, white, led, halo, knob, bar, place, zk: Dp / 2 };
}
const texCache = {};
function getTex(name) {
  return texCache[name] || (texCache[name] = load(src(name)).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
  }));
}
function setVariant(id, animate = true) {
  const v = VARIANTS.find(x => x.id === id) || VARIANTS[0];
  S.variant = v.id;
  document.querySelectorAll('.swatches button').forEach(b => { const on = b.dataset.variant === v.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); if (on) $('#vVar').textContent = b.dataset.name; });
  return getTex(v.tex).then((tex) => {
    if (S.variant !== v.id || !machine) return;
    const m = machine;
    m.front.material.map = tex; m.front.material.emissiveMap = tex; m.front.material.needsUpdate = true;
    m.red.color.setHex(v.body); m.white.color.setHex(v.knob.c);
    m.place(m.knob, v.knob.x, v.knob.y, m.zk + 0.017); m.place(m.bar, v.knob.x, v.knob.y, m.zk + 0.043);
    m.outlet.visible = !!v.outlet;
    if (v.outlet) { m.place(m.outlet, v.outlet.x, v.outlet.y, m.zk + 0.006); m.outletHue = new THREE.Color(v.outlet.c).getHSL({}); }
    m.led.visible = m.halo.visible = !!v.led;
    if (v.led) { ledUniforms.uMode.value = v.led.mode; ledUniforms.uColor.value.setHex(v.led.c); }
    m.glow.material.color.setHex(v.glow); m.glowA = v.glowA;
    if (animate && S.on && !reduce) { drop.x = 0.55; drop.v = 0; }
  });
}

/* ───────── 복도 사진에서 환경 빛 뽑기: 머신 자리에서 본 주변을 한 번 찍어 반사·조명으로 쓴다 ───────── */
const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
const cubeCam = new THREE.CubeCamera(0.05, 60, cubeRT);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null, envT = 0;
function updateEnv() {
  if (!machine) return;
  const F = foot(), hide = [machine.root, wallShadow, zone, cursor, ...Object.values(spots)].filter(Boolean), was = hide.map(o => o.visible);
  hide.forEach(o => { o.visible = false; });
  cubeCam.position.set(F.x + 0.35, 1.0, S.z);
  stageUniforms.uEnv.value = 1; cubeCam.update(renderer, scene); stageUniforms.uEnv.value = 0;
  hide.forEach((o, i) => { o.visible = was[i]; });
  const rt = pmrem.fromCubemap(cubeRT.texture); if (envRT) envRT.dispose(); envRT = rt;
  scene.environment = rt.texture; scene.environmentIntensity = 1.0;
}
const envSoon = () => { clearTimeout(envT); envT = setTimeout(updateEnv, 140); };

/* ───────── 화면 범위 검사: 지금 보이는 곳이 사진에 담긴 곳인지 ───────── */
const _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3();
const EDGE = [-1, -0.5, 0, 0.5, 1];
function hitStage(o, d) {
  let t = Infinity;
  if (d.y < -1e-6) t = Math.min(t, -o.y / d.y);
  if (d.y > 1e-6) t = Math.min(t, (CEIL - o.y) / d.y);
  if (d.x < -1e-6) t = Math.min(t, (-D - o.x) / d.x);
  if (d.z < -1e-6) t = Math.min(t, (ZEND - o.z) / d.z);
  return t;
}
function inPhoto(p) {
  const x = p.x - P0.x, y = p.y - P0.y, z = p.z - P0.z, M = CAL.M;
  const cz = M[2][0] * x + M[2][1] * y + M[2][2] * z; if (cz <= 0.05) return false;
  const u = (CAL.c[0] + CAL.f * (M[0][0] * x + M[0][1] * y + M[0][2] * z) / cz) / CAL.W;
  const v = (CAL.c[1] + CAL.f * (M[1][0] * x + M[1][1] * y + M[1][2] * z) / cz) / CAL.H;
  return u > 0.004 && u < 0.996 && v > 0.005 && v < 0.995;
}
function badness(pos, yaw, pitch, fov) {
  const th = Math.tan(THREE.MathUtils.degToRad(fov) / 2), a = aspect();
  _q.setFromEuler(_e.set(pitch, yaw, 0));
  let bad = 0;
  const test = (nx, ny) => {
    _d.set(nx * th * a, ny * th, -1).applyQuaternion(_q);
    const t = hitStage(pos, _d);
    if (!isFinite(t) || !inPhoto(_p.copy(pos).addScaledVector(_d, t))) bad++;
  };
  for (const k of EDGE) { test(k, -1); test(k, 1); test(-1, k); test(1, k); }
  return bad;
}
const aspect = () => innerWidth / innerHeight;
function aim(from, to) {
  const dx = to[0] - from.x, dy = to[1] - from.y, dz = to[2] - from.z;
  return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
}
function fitFov(pos, yaw, pitch, cap) {
  if (badness(pos, yaw, pitch, cap) === 0) return cap;
  let lo = 16, hi = cap;
  if (badness(pos, yaw, pitch, lo) > 0) return null;
  for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (badness(pos, yaw, pitch, mid) === 0) lo = mid; else hi = mid; }
  return lo;
}
const FWD = new THREE.Vector3(...CAL.M[2]);
const YAW0 = Math.atan2(-FWD.x, -FWD.z), PITCH0 = Math.asin(FWD.y);

/* ───────── 머신 자리 계산 ───────── */
function foot() {
  const k = S.h / BASE.H, t = THREE.MathUtils.degToRad(S.rot);
  const ez = (BASE.W / 2 * Math.cos(t) + BASE.D / 2 * Math.sin(t)) * k;   // 벽 방향 반폭
  const ex = (BASE.D / 2 * Math.cos(t) + BASE.W / 2 * Math.sin(t)) * k;   // 복도 쪽 반폭
  return { k, ez, ex, x: -D + 0.035 + ex };
}

/* ───────── 보는 자리 3곳 ───────── */
function poseOf(name) {
  const a = aspect(), F = foot();
  if (name === 'entry') {
    let yaw = YAW0, pitch = PITCH0;
    if (a < 1.45) [yaw, pitch] = aim(P0, [-D, 1.15, lerp(-4.6, S.z, 0.35)]);
    const fit = fitFov(P0, yaw, pitch, 76);
    return { pos: P0.clone(), yaw, pitch, fov: fit ? fit * 0.93 : 60 };
  }
  if (name === 'near') {
    const pos = new THREE.Vector3(-0.35, 1.5, Math.min(S.z + 3.5, -0.4));
    const [yaw, pitch] = aim(pos, [F.x - 0.1, 0.92 * F.k, S.z - 0.5]);
    const cap = a < 1 ? 60 : 50, fit = fitFov(pos, yaw, pitch, cap);
    return { pos, yaw, pitch, fov: fit || cap };
  }
  const pos = new THREE.Vector3(Math.min(0.7, 0.118 * Math.abs(S.z) - 0.12), 1.42, S.z);
  const [yaw, pitch] = aim(pos, [-D, 0.98 * F.k, S.z]);
  const cap = a < 1 ? 56 : 48, fit = fitFov(pos, yaw, pitch, cap);
  return { pos, yaw, pitch, fov: fit || cap };
}

const rig = { pos: P0.clone(), yaw: YAW0, pitch: PITCH0, fov: 60 };
let flight = null;
function fly(to, dur = 1.35) {
  if (reduce) dur = 0.01;
  const from = { pos: rig.pos.clone(), yaw: rig.yaw, pitch: rig.pitch, fov: rig.fov };
  let dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  flight = { from, to: { ...to, yaw: from.yaw + dy }, t0: performance.now(), dur: dur * 1000 };
}
function setView(name, instant) {
  S.view = name;
  document.querySelectorAll('.views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  const p = poseOf(name);
  if (instant) { flight = null; rig.pos.copy(p.pos); rig.yaw = p.yaw; rig.pitch = p.pitch; rig.fov = p.fov; }
  else fly(p);
  placeSpots();
}

/* ───────── 장면 조립 ───────── */
let machine, wallShadow, zone, cursor, zoneShow = 0, zoneTimer = 0, drop = { x: 1, v: 0, target: 1 };
const spots = {};
function makeSpots() {
  for (const name of ['entry', 'near', 'front']) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.21, 0.29, 56), decal(null, 0.7, 0xffffff));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.21, 48), decal(null, 0.16, 0xffffff));
    g.add(ring, disc); g.rotation.x = -Math.PI / 2; g.position.y = 0.006; g.userData = { name, ring, disc, hover: 0 };
    ring.renderOrder = disc.renderOrder = 4;
    scene.add(g); spots[name] = g;
  }
}
function placeSpots() {
  for (const name in spots) {
    if (!machine) break;
    const p = poseOf(name).pos, g = spots[name];
    g.position.x = p.x; g.position.z = p.z;
    g.visible = name !== S.view && !document.body.classList.contains('clean');
  }
}
function layout() {
  const F = foot();
  if (machine) {
    machine.root.position.set(F.x, 0, S.z);
    machine.root.rotation.y = Math.PI / 2 - THREE.MathUtils.degToRad(S.rot);
    machine.root.scale.setScalar(F.k);
  }
  if (wallShadow) {
    const h = S.h + 0.5, w = F.ez * 2 + 0.9;
    wallShadow.scale.set(w, h, 1); wallShadow.position.set(-D + 0.004, h / 2 - 0.12, S.z - 0.08);
  }
  // 상태 판정
  const near = S.z + F.ez;                      // 소화전 쪽 끝
  const gap = HYD.b - near;                     // 소화전함 끝에서 머신까지
  let level = 'ok', text = `소화전에서 약 ${gap.toFixed(1)}m 떨어져 있습니다.`;
  if (near > BLOCK.b) { level = 'no'; text = '소화전·소화기를 가립니다. 엘리베이터 쪽으로 옮겨 보세요.'; }
  else if (near > BLOCK.b - CLEAR) { level = 'warn'; text = '소화기 앞 60cm 안입니다. 조금 더 옮겨 보세요.'; }
  S.level = level;
  const st = $('#status');
  if (!S.on) { st.dataset.level = 'off'; $('#statusText').textContent = '머신을 놓기 전 복도입니다.'; }
  else { st.dataset.level = level; $('#statusText').textContent = text; }
  $('#vPos').textContent = gap > 0 ? `소화전에서 약 ${gap.toFixed(1)}m` : '소화전 앞';
  const out = Math.round((F.ex * 2 + 0.035) * 100);
  $('#vRot').textContent = S.rot < 1 ? `벽과 나란히 · ${out}cm 나옴` : `입구 쪽 ${Math.round(S.rot)}° · ${out}cm 나옴`;
  placeSpots();
}

/* ───────── 조작 ───────── */
const ptr = new Map(); let dragged = false, pinch = 0, downAt = null;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function tryMove(yaw, pitch, fov) { rig.yaw = yaw; rig.pitch = clamp(pitch, -1.25, 1.25); rig.fov = fov; return true; }
// 걸어갈 수 있는 범위(사진에 담긴 복도 안쪽)
const WALK = { x0: -D + 0.75, x1: 2.4, z0: -11.5, z1: 1.0 };
function walkable(p) {
  p.x = clamp(p.x, WALK.x0, WALK.x1); p.z = clamp(p.z, WALK.z0, WALK.z1);
  const F = foot();                                    // 머신 속으로는 들어가지 않는다
  if (S.on && Math.abs(p.z - S.z) < F.ez + 0.45 && p.x < F.x + F.ex + 0.6) p.x = F.x + F.ex + 0.6;
  return p;
}
function floorAt(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  if (d.y > -0.03) return null;
  const t = -o.y / d.y; if (t > 16) return null;
  const p = new THREE.Vector3(o.x + d.x * t, 0, o.z + d.z * t);
  if (p.x < -D + 0.1 || p.x > WALK.x1 + 0.8 || p.z < WALK.z0 - 1 || p.z > WALK.z1 + 0.6) return null;
  return p;
}
function walkTo(p) {
  walkable(p); S.view = 'free';
  document.querySelectorAll('.views button').forEach(b => b.classList.remove('on'));
  const dist = Math.hypot(p.x - rig.pos.x, p.z - rig.pos.z);
  fly({ pos: new THREE.Vector3(p.x, 1.5, p.z), yaw: rig.yaw, pitch: rig.pitch, fov: rig.fov }, clamp(0.35 + dist * 0.16, 0.3, 1.4));
  placeSpots();
}
function spotAt(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const list = Object.values(spots).filter(g => g.visible).map(g => g.userData.disc).concat(Object.values(spots).filter(g => g.visible).map(g => g.userData.ring));
  const hit = ray.intersectObjects(list, false)[0];
  return hit ? hit.object.parent.userData.name : null;
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptr.size === 1) { dragged = false; downAt = { x: e.clientX, y: e.clientY }; }
  if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
  const p = ptr.get(e.pointerId);
  if (!p) {
    hoverName = spotAt(e); canvas.classList.toggle('hot', !!hoverName);
    hoverFloor = (!hoverName && e.pointerType === 'mouse') ? floorAt(e) : null; return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptr.size === 2) {
    const [a, b] = [...ptr.values()], dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) tryMove(rig.yaw, rig.pitch, clamp(rig.fov * pinch / dist, 18, 84));
    pinch = dist; dragged = true; flight = null; return;
  }
  if (!dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) return;
  if (!dragged) { dragged = true; canvas.classList.add('drag'); hideHint(); hoverFloor = null; }
  flight = null;
  const k = THREE.MathUtils.degToRad(rig.fov) / innerHeight;
  if (!tryMove(rig.yaw + dx * k, rig.pitch + dy * k, rig.fov)) {
    if (!tryMove(rig.yaw + dx * k, rig.pitch, rig.fov)) tryMove(rig.yaw, rig.pitch + dy * k, rig.fov);
  }
});
const up = (e) => {
  if (ptr.size === 1 && !dragged && e.type === 'pointerup') {
    const n = spotAt(e), f = n ? null : floorAt(e);
    if (n) { setView(n); hideHint(); } else if (f) { walkTo(f); hideHint(); }
  }
  ptr.delete(e.pointerId); pinch = 0; canvas.classList.remove('drag');
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); flight = null;
  tryMove(rig.yaw, rig.pitch, clamp(rig.fov * Math.exp(e.deltaY * 0.0012), 18, 84));
}, { passive: false });
let hoverName = null, hoverFloor = null;
canvas.addEventListener('pointerleave', () => { hoverFloor = null; hoverName = null; });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'h') { setClean(!document.body.classList.contains('clean')); return; }
  if (k === 'escape') { setClean(false); return; }
  const mv = { arrowup: [1, 0], w: [1, 0], arrowdown: [-1, 0], s: [-1, 0], arrowleft: [0, -1], a: [0, -1], arrowright: [0, 1], d: [0, 1] }[k];
  if (!mv) return;
  e.preventDefault();
  const base = flight ? flight.to.pos : rig.pos, step = 0.45;
  const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw);
  walkTo(new THREE.Vector3(base.x + (fx * mv[0] - fz * mv[1]) * step, 0, base.z + (fz * mv[0] + fx * mv[1]) * step));
  hideHint();
});

document.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => { setView(b.dataset.view); hideHint(); }));
const sync = (el) => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
const follow = () => { if (S.view === 'near' || S.view === 'front') { const p = poseOf(S.view); flight = null; rig.pos.copy(p.pos); rig.yaw = p.yaw; rig.pitch = p.pitch; rig.fov = p.fov; } };
const rPos = $('#rPos'), rRot = $('#rRot');
rPos.value = Math.round((Z_MAX - S.z) / (Z_MAX - Z_MIN) * 1000);
rPos.addEventListener('input', () => {
  S.z = lerp(Z_MAX, Z_MIN, rPos.value / 1000); sync(rPos); ensureOn(); layout(); follow(); envSoon();
  zoneTimer = performance.now() + 1600;
});
rRot.addEventListener('input', () => { S.rot = +rRot.value; sync(rRot); ensureOn(); layout(); follow(); });
[rPos, rRot].forEach(sync);

const seg = $('.seg');
function setOn(v, animate = true) {
  S.on = v; seg.dataset.on = v ? 1 : 0;
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.on === '1') === v));
  if (v && animate && !reduce) { drop.x = 0; drop.v = 0; }
  if (v && (!animate || reduce)) { drop.x = 1; drop.v = 0; }
  layout();
}
const ensureOn = () => { if (!S.on) setOn(true, false); };
seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setOn(b.dataset.on === '1')));

const fab = $('#fab'), panel = $('#panel');
fab.addEventListener('click', () => {
  const open = panel.classList.toggle('closed') === false; fab.setAttribute('aria-expanded', open);
});
if (innerWidth <= 820) { panel.classList.add('closed'); fab.setAttribute('aria-expanded', 'false'); }

// 화면만 보기: 캡처할 때 메뉴를 모두 숨긴다 (H 키로도 전환)
let wakeT = 0;
function setClean(v) {
  document.body.classList.toggle('clean', v); hideHint(); placeSpots();
  if (v) wake();
}
function wake() { document.body.classList.add('awake'); clearTimeout(wakeT); wakeT = setTimeout(() => document.body.classList.remove('awake'), 1800); }
$('#clean').addEventListener('click', () => setClean(true));
$('#uiOn').addEventListener('click', () => setClean(false));
addEventListener('pointermove', () => { if (document.body.classList.contains('clean')) wake(); });
addEventListener('pointerdown', () => { if (document.body.classList.contains('clean')) wake(); });
document.querySelectorAll('.swatches button').forEach(b => b.addEventListener('click', () => { ensureOn(); setVariant(b.dataset.variant); }));

const hint = $('#hint'); let hintT = 0;
function hideHint() { hint.classList.remove('show'); clearTimeout(hintT); }

/* ───────── 루프 ───────── */
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = aspect();
  placeSpots();
}
addEventListener('resize', resize);

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (flight) {
    const k = clamp((now - flight.t0) / flight.dur, 0, 1), e = ease(k), { from, to } = flight;
    rig.pos.lerpVectors(from.pos, to.pos, e);
    rig.yaw = lerp(from.yaw, to.yaw, e); rig.pitch = lerp(from.pitch, to.pitch, e); rig.fov = lerp(from.fov, to.fov, e);
    if (k >= 1) flight = null;
  }
  camera.position.copy(rig.pos); camera.rotation.set(rig.pitch, rig.yaw, 0);
  if (camera.fov !== rig.fov) { camera.fov = rig.fov; camera.updateProjectionMatrix(); }

  ledUniforms.uTime.value = now / 1000;
  if (machine) {
    // 내려앉는 스프링
    const a = (drop.target - drop.x) * 190 - drop.v * 17; drop.v += a * dt; drop.x += drop.v * dt;
    const x = drop.x;
    machine.root.visible = S.on;
    machine.inner.position.y = (1 - x) * 0.22;
    machine.inner.scale.set(1 + (1 - x) * 0.04, 0.9 + 0.1 * x, 1 + (1 - x) * 0.04);
    machine.sh.material.opacity = 0.5 * clamp(x, 0, 1); machine.sh2.material.opacity = 0.6 * clamp(x, 0, 1);
    machine.glow.material.opacity = (machine.glowA ?? 0.2) * clamp(x, 0, 1);
    wallShadow.visible = S.on; wallShadow.material.opacity = 0.34 * clamp(x, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(now / 1000 * 2.2);
    const oh = machine.outletHue || { h: 0.685, s: 0.95, l: 0.66 }; machine.outlet.material.color.setHSL(oh.h, oh.s, clamp(oh.l + 0.08 * pulse, 0, 0.9));
  }
  // 소화전 앞 비워 둘 구역 표시
  const clean = document.body.classList.contains('clean');
  const want = !clean && ((S.on && S.level !== 'ok') || now < zoneTimer) ? 1 : 0;
  zoneShow += (want - zoneShow) * Math.min(1, dt * 8);
  if (zone) { zone.visible = zoneShow > 0.01; zone.material.opacity = 0.85 * zoneShow; zone.material.map.offset.x = now / 9000; }
  if (cursor) {
    const show = hoverFloor && !clean && !flight ? 1 : 0; cursor.userData.a += (show - cursor.userData.a) * Math.min(1, dt * 12);
    if (hoverFloor) { const p = walkable(hoverFloor.clone()); cursor.position.set(p.x, 0.007, p.z); }
    cursor.visible = cursor.userData.a > 0.02; cursor.material.opacity = 0.55 * cursor.userData.a;
  }
  for (const n in spots) {
    const u = spots[n].userData, t = hoverName === n ? 1 : 0; u.hover += (t - u.hover) * Math.min(1, dt * 10);
    const breathe = 1 + 0.04 * Math.sin(now / 1000 * 2 + n.length);
    spots[n].scale.setScalar(breathe * (1 + 0.12 * u.hover));
    u.ring.material.opacity = 0.62 + 0.38 * u.hover; u.disc.material.opacity = 0.14 + 0.2 * u.hover;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

/* ───────── 시작 ───────── */
const load = (url) => new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
Promise.all(['corridor', 'wall', 'floor'].map(n => load(src(n))).concat(getTex('machine-front'))).then(([photo, wall, floor, front]) => {
  for (const t of [photo, wall, floor]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
  stageUniforms.uWall.value = wall; stageUniforms.uFloor.value = floor;
  photo.generateMipmaps = true; photo.minFilter = THREE.LinearMipmapLinearFilter;
  stageUniforms.uPhoto.value = photo;

  machine = buildMachine(front); scene.add(machine.root);
  wallShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decal(softRect(256, 256, 40, 30), 0.34));
  wallShadow.rotation.y = Math.PI / 2; wallShadow.renderOrder = 1; scene.add(wallShadow);
  const zl = Math.abs((BLOCK.b - CLEAR) - (BLOCK.a + CLEAR));
  zone = new THREE.Mesh(new THREE.PlaneGeometry(1.0, zl), decal(hatch(), 0, 0xffffff));
  zone.material.map.repeat.set(2.2, zl * 2.2);
  zone.rotation.x = -Math.PI / 2; zone.position.set(-D + 0.5, 0.008, (BLOCK.a + CLEAR + BLOCK.b - CLEAR) / 2); zone.renderOrder = 3;
  scene.add(zone);
  makeSpots();
  cursor = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.185, 48), decal(null, 0, 0xffffff));
  cursor.rotation.x = -Math.PI / 2; cursor.renderOrder = 5; cursor.userData.a = 0; cursor.visible = false; scene.add(cursor);
  setVariant(S.variant, false);
  updateEnv();
  VARIANTS.slice(1).forEach((v, i) => setTimeout(() => getTex(v.tex), 1500 + i * 400));     // 나머지 디자인은 미리 받아 둔다

  resize(); S.on = false; layout(); setView('entry', true);
  document.body.classList.add('ready');
  requestAnimationFrame(tick);
  const fast = new URLSearchParams(location.search).has('fast');
  setTimeout(() => setOn(true), fast ? 0 : 900);
  setTimeout(() => { hint.classList.add('show'); hintT = setTimeout(hideHint, 6500); }, fast ? 0 : 1900);
  window.__g = { S, rig, setView, setOn, layout, poseOf, badness, camera, follow, CAL, setVariant, setClean, walkTo };
}).catch((err) => {
  console.error(err);
  $('#loader span').textContent = '사진을 불러오지 못했습니다. 새로 고쳐 보세요.';
});
