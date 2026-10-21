// WebGL2 修圖管線：原圖放 GPU 貼圖（線性光），所有調整在 shader 裡一次算完。
// 螢幕預覽、直方圖、全尺寸匯出共用同一支 shader，保證「看到的＝匯出的」。
import { resolveStyle } from './styles.js?v=mvhq2p4m';

// 拉桿 key 與範圍（跟 settings.js 的 ADJ 一致；風格疊上去後夾在範圍內）
const RANGES = {
  temp: [-100, 100], tint: [-100, 100], exp: [-5, 5], con: [-100, 100], hl: [-100, 100], sh: [-100, 100],
  wh: [-100, 100], bl: [-100, 100], vib: [-100, 100], sat: [-100, 100],
  vig: [-100, 100], mid: [0, 100], round: [-100, 100], feat: [0, 100], vhl: [0, 100],
};
const ADJ_KEYS = Object.keys(RANGES);

const VS = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSrc;          // 原圖尺寸
uniform vec2 uRot;          // cos, sin（拉直角度）
uniform vec4 uFrame;        // 輸出畫面在「旋轉後座標」的中心 xy 與尺寸 zw
uniform vec2 uOutFull;      // 整張輸出的像素尺寸
uniform vec3 uTile;         // 本次繪製區塊的左上 x, y 與高度（分塊匯出用）
uniform vec4 uCrop;         // 裁切框中心 xy、尺寸 zw（暈映以它為準）
uniform vec3 uBg;
uniform bool uOrig;
uniform bool uRaw;
uniform float uTemp, uTint, uExp, uCon, uHl, uSh, uWh, uBl, uVib, uSat;
uniform float uVig, uMid, uRound, uFeat, uVhl;
uniform float uFade, uGC, uGrain;   // 風格：褪色、綠轉青、顆粒
uniform bool uMono;
uniform vec3 uSplitS, uSplitH;      // 風格：陰影／亮部染色（已乘強度）
out vec4 outColor;

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 encode(vec3 c){ // sRGB 轉換；>1 的亮部延續曲線，留給「亮部」拉回
  c = max(c, 0.0);
  vec3 lo = c * 12.92, hi = 1.055 * pow(c, vec3(1.0/2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}
float scurve(float x, float k){ // k>0 加對比、k<0 減對比，0 與 1 兩端固定
  float xc = clamp(x, 0.0, 1.0);
  float s = xc * xc * (3.0 - 2.0 * xc);
  float y = k >= 0.0 ? mix(xc, s, k) : mix(xc, xc - (s - xc), -k);
  return y + (x - xc); // 範圍外的部分原樣保留
}

void main(){
  vec2 pix = vec2(uTile.x + gl_FragCoord.x, uTile.y + (uTile.z - gl_FragCoord.y));
  vec2 d = uFrame.xy + (pix / uOutFull - 0.5) * uFrame.zw;
  vec2 s = vec2(uRot.x * d.x + uRot.y * d.y, -uRot.y * d.x + uRot.x * d.y);
  vec2 uv = (s + uSrc * 0.5) / uSrc;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(uBg, 1.0); return; }

  vec3 c = texture(uTex, uv).rgb;
  if (!uOrig) {
    c *= vec3(exp(uTemp * 0.35), exp(-uTint * 0.25), exp(-uTemp * 0.35));
    c *= exp2(uExp);
  }
  vec3 e = encode(c);
  float baseCon = uRaw ? 0.18 : 0.0; // RAW 解出來偏平，補一點基礎對比
  if (!uOrig) {
    // 亮部／陰影：只動亮度，用有界的曲線，暗部雜訊不會被放大成霧
    float L = luma(e), Lc = min(L, 1.0);
    float hlM = smoothstep(0.35, 1.0, L);
    float T = L;
    if (uHl < 0.0) T -= -uHl * 0.55 * hlM * (L - 0.35);          // 壓亮部，連 >1 的也拉回來
    else T += uHl * 0.5 * hlM * (1.0 - Lc);                      // 提亮部，不會超過 1
    T += uSh * 1.2 * Lc * pow(1.0 - Lc, 3.0);                     // 陰影：0 和 1 兩端不動
    e *= clamp(T / max(L, 1e-4), 0.0, 3.0);
    float wp = 1.0 - uWh * 0.25, bp = -uBl * 0.08;
    e = (e - bp) / (wp - bp);
    float k = clamp(uCon * 0.9 + baseCon, -1.0, 1.0);
    e = vec3(scurve(e.r, k), scurve(e.g, k), scurve(e.b, k));
    if (uGC > 0.0) { // 綠色往青色靠、略降飽和（日系）
      float mx = max(e.r, max(e.g, e.b)), mn = min(e.r, min(e.g, e.b));
      if (e.g >= mx && mx - mn > 0.04) {
        float w = uGC * min(1.0, (e.g - max(e.r, e.b)) * 4.0);
        e.b += (e.g - e.b) * 0.55 * w; e.r -= (e.r - mn) * 0.3 * w;
        float Lg = luma(e); e = Lg + (e - Lg) * (1.0 - 0.25 * w);
      }
    }
    float L2 = luma(e);
    if (uMono) {
      e = vec3(dot(e, vec3(0.3, 0.59, 0.11)));
    } else {
      float sat0 = max(e.r, max(e.g, e.b)) - min(e.r, min(e.g, e.b));
      float f = (1.0 + uSat) * (1.0 + uVib * (1.0 - clamp(sat0 * 1.8, 0.0, 1.0)));
      e = L2 + (e - L2) * max(f, 0.0);
    }
    float L3 = min(luma(e), 1.0);
    e += uSplitS * (1.0 - L3) * (1.0 - L3) + uSplitH * L3 * L3;
    e = uFade + e * (1.0 - uFade);
    if (uGrain > 0.0) { // 顆粒大小跟原圖長邊連動（約 2000 顆寬），換解析度看起來一樣
      vec2 gcell = floor(s / max(1.0, max(uSrc.x, uSrc.y) / 2000.0));
      e += (fract(sin(dot(gcell, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 2.0 * uGrain;
    }
    if (uVig != 0.0) {
      vec2 q = d - uCrop.xy;
      vec2 hw = uCrop.zw * 0.5;
      float rp = max(uRound, 0.0), m = min(hw.x, hw.y);
      vec2 n = abs(q / (hw * (1.0 - rp) + m * rp));
      float p = 2.0 / (1.0 + min(uRound, 0.0) * 0.8);   // 圓度<0 時往方形靠
      float dd = pow(pow(n.x, p) + pow(n.y, p), 1.0 / p) / 1.41421;
      float mid = 0.2 + uMid * 0.8, fe = 0.05 + uFeat * 0.9;
      float fv = smoothstep(mid - fe * 0.5, mid + fe * 0.5 + 0.4, dd);
      float prot = 1.0 - uVhl * smoothstep(0.6, 1.0, luma(e));
      if (uVig < 0.0) e *= 1.0 + uVig * fv * prot;
      else e += (1.0 - e) * uVig * fv;
    }
  } else if (uRaw) {
    e = vec3(scurve(e.r, baseCon), scurve(e.g, baseCon), scurve(e.b, baseCon));
  }
  outColor = vec4(clamp(e, 0.0, 1.0), 1.0);
}`;

// 16-bit 整數 → 半精度浮點（查表，24MP 也只要零點幾秒）
let HALF_LUT;
export function halfLut() {
  if (HALF_LUT) return HALF_LUT;
  HALF_LUT = new Uint16Array(65536);
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (let i = 0; i < 65536; i++) {
    f[0] = i / 65535;
    const x = u[0], sign = (x >>> 16) & 0x8000, exp = ((x >>> 23) & 0xff) - 127 + 15, mant = x & 0x7fffff;
    if (exp <= 0) HALF_LUT[i] = sign | (exp < -10 ? 0 : ((mant | 0x800000) >> (1 - exp + 13)));
    else HALF_LUT[i] = sign | ((exp << 10) + ((mant + 0x1000) >> 13)); // 用加法，捨入進位才會進到指數
  }
  return HALF_LUT;
}

export class Pipeline {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('這台電腦的顯示卡不支援 WebGL2');
    this.gl = gl;
    this.floatRT = !!gl.getExtension('EXT_color_buffer_float');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.maxRB = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 4096);
    this.prog = this.#program();
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    const n = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(this.prog, i).name; this.u[name] = gl.getUniformLocation(this.prog, name); }
    this.tex = null;
    this.W = 0; this.H = 0; this.raw = false;
  }

  #program() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(p));
    gl.useProgram(p);
    return p;
  }

  #newTex() {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  #mips(canMip) {
    const gl = this.gl;
    if (canMip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }

  checkSize(w, h) {
    if (w > this.maxTex || h > this.maxTex) throw new Error(`照片太大（${w}×${h}），顯示卡上限 ${this.maxTex}px`);
  }

  /** RAW：16-bit 線性 RGB */
  setLinear16(rgb, w, h) {
    this.checkSize(w, h);
    const lut = halfLut(), px = new Uint16Array(w * h * 4), one = 0x3c00;
    for (let i = 0, j = 0, n = w * h; i < n; i++, j += 3) {
      const o = i * 4; px[o] = lut[rgb[j]]; px[o + 1] = lut[rgb[j + 1]]; px[o + 2] = lut[rgb[j + 2]]; px[o + 3] = one;
    }
    const gl = this.gl;
    this.#newTex();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, px);
    this.#mips(this.floatRT);
    Object.assign(this, { W: w, H: h, raw: true });
  }

  /** JPEG/PNG：sRGB 8-bit，GPU 取樣時自動轉線性 */
  setSRGB8(bitmap) {
    const w = bitmap.width, h = bitmap.height;
    this.checkSize(w, h);
    const gl = this.gl;
    this.#newTex();
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this.#mips(true);
    Object.assign(this, { W: w, H: h, raw: false });
  }

  #uniforms(s, frame, outW, outH, opts) {
    const gl = this.gl, u = this.u, a = (s.crop.angle * Math.PI) / 180;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uSrc, this.W, this.H);
    gl.uniform2f(u.uRot, Math.cos(a), Math.sin(a));
    gl.uniform4f(u.uFrame, frame.cx, frame.cy, frame.w, frame.h);
    gl.uniform2f(u.uOutFull, outW, outH);
    gl.uniform4f(u.uCrop, s.crop.cx, s.crop.cy, s.crop.w, s.crop.h);
    const bg = opts.bg || [0.118, 0.122, 0.133];
    gl.uniform3f(u.uBg, bg[0], bg[1], bg[2]);
    gl.uniform1i(u.uOrig, opts.orig ? 1 : 0);
    gl.uniform1i(u.uRaw, this.raw ? 1 : 0);
    const n = (v) => v / 100, st = resolveStyle(s, ADJ_KEYS, RANGES), j = st.adj;
    gl.uniform1f(u.uTemp, n(j.temp)); gl.uniform1f(u.uTint, n(j.tint)); gl.uniform1f(u.uExp, j.exp);
    gl.uniform1f(u.uCon, n(j.con)); gl.uniform1f(u.uHl, n(j.hl)); gl.uniform1f(u.uSh, n(j.sh));
    gl.uniform1f(u.uWh, n(j.wh)); gl.uniform1f(u.uBl, n(j.bl)); gl.uniform1f(u.uVib, n(j.vib)); gl.uniform1f(u.uSat, n(j.sat));
    gl.uniform1f(u.uFade, st.fade); gl.uniform1f(u.uGC, st.gc); gl.uniform1f(u.uGrain, st.grain);
    gl.uniform1i(u.uMono, st.mono ? 1 : 0);
    gl.uniform3f(u.uSplitS, ...st.splitS); gl.uniform3f(u.uSplitH, ...st.splitH);
    gl.uniform1f(u.uVig, n(j.vig)); gl.uniform1f(u.uMid, n(j.mid)); gl.uniform1f(u.uRound, n(j.round));
    gl.uniform1f(u.uFeat, n(j.feat)); gl.uniform1f(u.uVhl, n(j.vhl));
  }

  #draw(tx, ty, tw, th) {
    const gl = this.gl;
    gl.uniform3f(this.u.uTile, tx, ty, th);
    gl.viewport(0, 0, tw, th);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** 畫到畫面上的 canvas（尺寸由呼叫端先設好） */
  draw(s, frame, opts = {}) {
    if (!this.tex) return;
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.#uniforms(s, frame, w, h, opts);
    this.#draw(0, 0, w, h);
  }

  /** 畫到離屏緩衝區並讀回 RGBA（由上到下），大圖自動分塊 */
  readPixels(s, frame, outW, outH, opts = {}) {
    const gl = this.gl, T = this.maxRB;
    const out = new Uint8ClampedArray(outW * outH * 4);
    const fbTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fbTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, Math.min(T, outW), Math.min(T, outH));
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
    try {
      this.#uniforms(s, frame, outW, outH, opts);
      const tile = new Uint8Array(Math.min(T, outW) * Math.min(T, outH) * 4);
      for (let ty = 0; ty < outH; ty += T) {
        for (let tx = 0; tx < outW; tx += T) {
          const tw = Math.min(T, outW - tx), th = Math.min(T, outH - ty);
          this.#draw(tx, ty, tw, th);
          gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, tile);
          for (let r = 0; r < th; r++) { // GL 由下往上，翻正
            const src = (th - 1 - r) * tw * 4;
            out.set(tile.subarray(src, src + tw * 4), ((ty + r) * outW + tx) * 4);
          }
        }
      }
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb); gl.deleteTexture(fbTex);
    }
    return out;
  }

  /** 直方圖：用縮小版算，夠快可以每次拉桿都更新 */
  histogram(s, frame, opts = {}) {
    if (!this.tex) return null;
    const k = Math.min(1, 360 / Math.max(frame.w, frame.h));
    const w = Math.max(1, Math.round(frame.w * k)), h = Math.max(1, Math.round(frame.h * k));
    const px = this.readPixels(s, frame, w, h, opts);
    const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256);
    let hi = 0, lo = 0;
    for (let i = 0; i < px.length; i += 4) {
      r[px[i]]++; g[px[i + 1]]++; b[px[i + 2]]++;
      if (px[i] === 255 || px[i + 1] === 255 || px[i + 2] === 255) hi++;
      if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) lo++;
    }
    const n = w * h;
    return { r, g, b, clipHi: hi / n, clipLo: lo / n };
  }
}
