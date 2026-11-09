// GPU texture baker: every surface map in the project is generated here at load, nothing is downloaded.
import * as THREE from 'three';

export const GLSL_NOISE = /* glsl */`
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 h22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
// tileable value noise: per = lattice period
float pn(vec2 p,vec2 per){ vec2 i=floor(p),f=fract(p); f=f*f*f*(f*(f*6.-15.)+10.);
  float a=h12(mod(i,per)),b=h12(mod(i+vec2(1.,0.),per)),c=h12(mod(i+vec2(0.,1.),per)),d=h12(mod(i+vec2(1.,1.),per));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float fbm(vec2 uv,vec2 f,int o){ float s=0.,a=.5,t=0.; for(int i=0;i<9;i++){ if(i>=o)break; s+=a*pn(uv*f+float(i)*13.,f); t+=a; a*=.5; f*=2.; } return s/t; }
// tileable worley: x=F1, y=F2, z=cell id
vec3 wor(vec2 p,vec2 per){ vec2 i=floor(p),f=fract(p); float d1=8.,d2=8.,id=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 c=mod(i+g,per); vec2 r=g+h22(c)-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=h12(c+7.3); } else if(d<d2){ d2=d; } }
  return vec3(sqrt(d1),sqrt(d2),id); }
// tileable scratch field along an integer direction d; M lanes, K segments
float scr(vec2 uv,vec2 d,float M,float K,float w){ vec2 pp=vec2(-d.y,d.x); float t=dot(uv,pp)*M; float lane=mod(floor(t),M); float f=fract(t);
  float r=h12(vec2(lane,d.x*7.+d.y*3.+M)); float s=dot(uv,d)*K;
  float seg=smoothstep(0.58,0.72,pn(vec2(s+r*K,lane),vec2(K,M)));
  return smoothstep(w,0.,abs(f-0.3-0.4*r))*seg; }
`;

const VERT = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
let _scene, _cam, _mesh;
function run(renderer, rt, material) {
  if (!_scene) {
    _scene = new THREE.Scene(); _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    _mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); _mesh.frustumCulled = false; _scene.add(_mesh);
  }
  _mesh.material = material;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(_scene, _cam); renderer.setRenderTarget(prev);
  material.dispose();
}

// glsl must define: vec4 tex(vec2 uv)
export function bake(renderer, size, glsl, { float = false, uniforms = {}, aniso = 8 } = {}) {
  const [w, h] = Array.isArray(size) ? size : [size, size];
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: float ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: aniso,
  });
  run(renderer, rt, new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, depthTest: false, depthWrite: false,
    fragmentShader: GLSL_NOISE + glsl + '\nvarying vec2 vUv; void main(){ gl_FragColor=tex(vUv); }',
  }));
  rt.texture.userData.rt = rt;
  return rt.texture;
}

export function normalFromHeight(renderer, heightTex, size, strength) {
  return bake(renderer, size, /* glsl */`
    uniform sampler2D tH; uniform float uS,uPx;
    vec4 tex(vec2 uv){
      float l=texture2D(tH,uv-vec2(uPx,0.)).r, r=texture2D(tH,uv+vec2(uPx,0.)).r, d=texture2D(tH,uv-vec2(0.,uPx)).r, u=texture2D(tH,uv+vec2(0.,uPx)).r;
      return vec4(normalize(vec3((l-r)*uS,(d-u)*uS,1.))*.5+.5,1.); }`,
    { uniforms: { tH: { value: heightTex }, uS: { value: strength }, uPx: { value: 1 / size } } });
}

export function makeTextures(r) {
  const T = {};
  // generic lookup noise: R low fbm, G mid fbm, B cells, A fine grain
  T.noise = bake(r, 512, `vec4 tex(vec2 uv){ return vec4(fbm(uv,vec2(4.),6),fbm(uv+.37,vec2(7.),5),1.-wor(uv*9.,vec2(9.)).x,fbm(uv+.11,vec2(48.),3)); }`);

  // sand: wind ripples + grain
  const sandH = bake(r, 1024, `vec4 tex(vec2 uv){
    float w=fbm(uv,vec2(3.),4);
    float rr=sin((uv.y*16.+w*4.5+fbm(uv+.5,vec2(9.),3)*1.3)*6.28318)*.5+.5;
    float rip=pow(rr,1.7)*smoothstep(0.25,0.6,fbm(uv+.2,vec2(2.),3)+.25);
    float h=rip*.75+fbm(uv,vec2(28.),3)*.22+fbm(uv,vec2(220.),2)*.16;
    return vec4(h); }`, { float: true });
  T.sandNrm = normalFromHeight(r, sandH, 1024, 5.0);

  // painted metal: orange peel, dents, scratches
  const SCR = `float scratches(vec2 uv){ float s=0.;
    s+=scr(uv,vec2(1.,0.),46.,3.,.035); s+=scr(uv,vec2(0.,1.),38.,4.,.03); s+=scr(uv,vec2(1.,1.),30.,3.,.04)*.8;
    s+=scr(uv,vec2(1.,-1.),26.,2.,.04)*.8; s+=scr(uv,vec2(2.,1.),22.,2.,.05)*.7; s+=scr(uv,vec2(1.,3.),14.,2.,.06)*.6;
    s+=scr(uv,vec2(3.,-1.),12.,1.,.07)*.6; s+=scr(uv,vec2(1.,0.),150.,6.,.05)*.5; s+=scr(uv,vec2(0.,1.),130.,8.,.05)*.5;
    return min(s,1.); }`;
  const metalH = bake(r, 1024, SCR + `vec4 tex(vec2 uv){
    float h=fbm(uv,vec2(110.),2)*.10+fbm(uv,vec2(5.),4)*.5-scratches(uv)*.22;
    h-=smoothstep(.16,.0,wor(uv*7.,vec2(7.)).x)*.25*step(.72,h12(floor(uv*7.)+3.));
    return vec4(h); }`, { float: true });
  T.metalNrm = normalFromHeight(r, metalH, 1024, 2.2);
  T.metalDet = bake(r, 1024, SCR + `vec4 tex(vec2 uv){
    float sc=scratches(uv); float sm=fbm(uv,vec2(3.),5); float fine=fbm(uv+.3,vec2(60.),3);
    float rough=clamp(.5+(sm-.5)*.9+(fine-.5)*.35-sc*.5,0.,1.);
    float alb=clamp(.5+(sm-.5)*.5+sc*.45+(fine-.5)*.2,0.,1.);
    return vec4(rough,alb,sc,1.); }`);

  // sandstone: laminations, pits, joints
  const ROCK = `float rockH(vec2 uv){
    float lam=fbm(vec2(uv.x,uv.y+fbm(uv,vec2(3.),3)*.03),vec2(4.,120.),4);
    float lam2=fbm(vec2(uv.x+uv.y*.35,uv.y),vec2(6.,48.),3);
    float bl=fbm(uv,vec2(5.),6);
    float pit=smoothstep(.34,.05,wor(uv*52.,vec2(52.)).x)*smoothstep(.5,.62,fbm(uv+.7,vec2(9.),3));
    vec3 w1=wor(uv*4.+fbm(uv,vec2(6.),3)*.35,vec2(4.)); float cr=smoothstep(.07,.0,w1.y-w1.x);
    vec3 w2=wor(uv*13.,vec2(13.)); float cr2=smoothstep(.05,.0,w2.y-w2.x)*.5;
    return lam*.85+lam2*.3+bl*.45-pit*.3-cr*.28-cr2*.1; }`;
  const rockH = bake(r, 1024, ROCK + `vec4 tex(vec2 uv){ return vec4(rockH(uv)); }`, { float: true });
  T.rockNrm = normalFromHeight(r, rockH, 1024, 6.0);
  T.rockDet = bake(r, 1024, ROCK + `vec4 tex(vec2 uv){
    float h=rockH(uv); float lam=fbm(uv,vec2(3.,90.),4); float streak=fbm(uv+.2,vec2(70.,2.),4);
    float cav=smoothstep(.55,.15,h);
    return vec4(clamp(.5+(lam-.5)*.6+cav*.3,0.,1.),clamp(.5+(lam-.5)*1.1+(fbm(uv,vec2(6.),4)-.5)*.7,0.,1.),streak,cav); }`);

  // carapace: sand-blasted streaks, pits, crack network
  const CHI = `float chiH(vec2 uv){
    float st=fbm(uv,vec2(70.,5.),4); float st2=fbm(uv+.4,vec2(24.,3.),3);
    float pit=smoothstep(.3,.04,wor(uv*38.,vec2(38.)).x)*smoothstep(.45,.6,fbm(uv+.9,vec2(7.),3));
    vec3 w1=wor(uv*6.+fbm(uv,vec2(8.),3)*.5,vec2(6.)); float cr=smoothstep(.06,.0,w1.y-w1.x);
    vec3 w2=wor(uv*17.,vec2(17.)); float cr2=smoothstep(.07,.0,w2.y-w2.x)*.45;
    float bump=fbm(uv,vec2(9.),5);
    return st*.6+st2*.45+bump*.45+w1.z*.08-pit*.4-cr*.3-cr2*.12; }`;
  const chiH = bake(r, 1024, CHI + `vec4 tex(vec2 uv){ return vec4(chiH(uv)); }`, { float: true });
  T.chitinNrm = normalFromHeight(r, chiH, 1024, 5.0);
  T.chitinDet = bake(r, 1024, CHI + `vec4 tex(vec2 uv){
    float h=chiH(uv); float st=fbm(uv,vec2(90.,4.),4); float blot=fbm(uv+.6,vec2(5.),5);
    vec3 w1=wor(uv*6.+fbm(uv,vec2(8.),3)*.5,vec2(6.)); float cr=smoothstep(.09,.0,w1.y-w1.x);
    return vec4(clamp(.55+(st-.5)*.7-cr*.2+(blot-.5)*.5,0.,1.),clamp(.5+(blot-.5)*1.2+(st-.5)*.6,0.,1.),cr,smoothstep(.6,.1,h)); }`);

  T.chitinAlb = bake(r, 1024, CHI + `vec4 tex(vec2 uv){
    float h=chiH(uv); float st=fbm(uv,vec2(90.,4.),4); float blot=fbm(uv+.6,vec2(5.),5);
    vec3 w1=wor(uv*6.+fbm(uv,vec2(8.),3)*.5,vec2(6.)); float cr=smoothstep(.09,.0,w1.y-w1.x);
    float v=clamp(.8+(blot-.5)*.7+(st-.5)*.6-cr*.18+smoothstep(.35,.95,h)*.2,0.05,1.5);
    return vec4(vec3(v),1.); }`, { float: true });
  T.chitinRgh = bake(r, 1024, CHI + `vec4 tex(vec2 uv){
    float h=chiH(uv); float st=fbm(uv,vec2(90.,4.),4); float blot=fbm(uv+.2,vec2(6.),4);
    float g=clamp(.62+(st-.5)*.5+(blot-.5)*.4+smoothstep(.5,.1,h)*.3,0.2,1.);
    return vec4(1.,g,0.,1.); }`);

  // worm hide micro detail: fine wrinkles and pores
  const skinH = bake(r, 1024, `vec4 tex(vec2 uv){
    float a=fbm(uv,vec2(9.,44.),4), b=fbm(uv+.4,vec2(36.,12.),3);
    float w1=pow(1.-abs(2.*a-1.),2.2), w2=pow(1.-abs(2.*b-1.),2.4);
    float pore=smoothstep(.34,.08,wor(uv*34.,vec2(34.)).x);
    return vec4(w1*.6+w2*.32-pore*.28+fbm(uv,vec2(140.),2)*.14); }`, { float: true });
  T.skinNrm = normalFromHeight(r, skinH, 1024, 4.0);

  // wet flesh: folds
  const fleshH = bake(r, 512, `vec4 tex(vec2 uv){
    float f=fbm(vec2(uv.x,uv.y+fbm(uv,vec2(4.),3)*.12),vec2(5.,34.),4); float b=1.-wor(uv*14.,vec2(14.)).x;
    return vec4(f*.7+b*.35+fbm(uv,vec2(60.),2)*.1); }`, { float: true });
  T.fleshNrm = normalFromHeight(r, fleshH, 512, 4.0);
  return T;
}

export function canvasTexture(w, h, draw, { srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
