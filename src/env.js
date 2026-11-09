// Sky, sun, image-based light and the post chain. One source of truth for light direction and colour.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const SUN = new THREE.Vector3();
export function setSun(azDeg, elDeg) {
  const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
  SUN.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  return SUN;
}

const SKY = /* glsl */`
uniform vec3 uSun; uniform float uDisk,uBack; uniform sampler2D tBack;
float sh12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float svn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(sh12(i),sh12(i+vec2(1,0)),f.x),mix(sh12(i+vec2(0,1)),sh12(i+vec2(1,1)),f.x),f.y); }
float sfbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=a*svn(p); p=p*2.03+7.1; a*=.5; } return s; }
vec3 skyColor(vec3 V){
  float y=max(V.y,0.), g=max(dot(V,uSun),0.);
  vec3 zen=vec3(0.070,0.185,0.46), hor=vec3(0.56,0.60,0.62);
  vec3 c=mix(hor,zen,1.-exp(-y*3.4));
  c=mix(c,vec3(1.0,0.76,0.52),pow(g,5.)*exp(-y*4.5)*.6);        // warm dust haze toward the sun
  c+=vec3(1.0,0.82,0.62)*pow(g,120.)*.5;
  // thin wind-stretched cirrus
  vec2 cp=V.xz/(V.y+.12);
  float ci=sfbm(vec2(cp.x*1.1+cp.y*.4,cp.y*3.6))*sfbm(cp*.7+4.);
  c=mix(c,vec3(1.0,0.95,0.9)*(0.75+0.6*pow(g,3.)),smoothstep(.22,.5,ci)*.55*smoothstep(.02,.25,V.y));
  if(uBack>.5){
    // the picture wraps the horizon (mirrored to close the loop); above its top edge the sky deepens toward the zenith
    float u=abs(atan(V.x,V.z))/3.14159265, v=.347+asin(clamp(V.y,-1.,1.))/.62;
    vec3 b=texture2D(tBack,vec2(u,clamp(v,.004,.996))).rgb*1.2, top=texture2D(tBack,vec2(u,.996)).rgb*1.2;
    vec3 sky2=mix(top,top*vec3(.4,.58,.92),1.-exp(-max(v-1.,0.)*1.5));
    float ci2=smoothstep(.22,.5,ci)*.4*smoothstep(.02,.25,V.y);
    c=mix(v<1.?b:sky2,vec3(1.,.96,.9)*(0.8+0.5*pow(g,3.)),ci2*smoothstep(.8,1.3,v));
    c=mix(c,vec3(1.0,0.82,0.6),pow(g,6.)*exp(-y*4.5)*.42); c+=vec3(1.0,0.84,0.66)*pow(g,120.)*.5;
  }
  c+=vec3(1.,.92,.8)*smoothstep(.99990,.99996,g)*60.*uDisk;
  if(V.y<0.) c=mix(vec3(0.62,0.27,0.12),c,exp(V.y*24.));        // sunlit sand bounce for the environment map
  return c;
}`;
function skyMat(disk, back = null) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN }, uDisk: { value: disk }, uBack: { value: back ? 1 : 0 }, tBack: { value: back } },
    vertexShader: 'varying vec3 vD; void main(){ vD=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: SKY + 'varying vec3 vD; void main(){ gl_FragColor=vec4(skyColor(normalize(vD)),1.); }',
  });
}

export function makeEnv(renderer, scene, { backdrop = null, shadowSize = 4096 } = {}) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(17000, 48, 24), skyMat(1, backdrop));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  const es = new THREE.Scene(); es.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMat(0, backdrop)));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(es, 0, 0.1, 1000).texture; pm.dispose();

  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.70), 8.5);
  sun.castShadow = true; sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  function focus(target, extent) {
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(SUN, extent * 4);
    const c = sun.shadow.camera; c.left = c.bottom = -extent; c.right = c.top = extent; c.near = 1; c.far = extent * 8;
    c.updateProjectionMatrix(); sun.shadow.needsUpdate = true;
  }
  return { sky, sun, focus, update(camera) { sky.position.copy(camera.position); } };
}

export async function makePost(renderer, scene, camera, { ao = true, bloomStrength = 0.22 } = {}) {
  const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(sz.x, sz.y, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null;
  if (ao) try {
    const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
    gtao = new GTAOPass(scene, camera, sz.x, sz.y);
    gtao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
    gtao.blendIntensity = 1.0;
    composer.addPass(gtao);
  } catch (e) { console.warn('GTAO unavailable', e); }
  // guard: one NaN or runaway pixel would otherwise be smeared over the whole frame by the bloom blur
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; if(any(isnan(c))||any(isinf(c))) c=vec3(0.); gl_FragColor=vec4(clamp(c,0.,48.),1.); }',
  }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(sz.x, sz.y), bloomStrength, 0.6, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 d=vUv-.5; float ca=.0025*dot(d,d);
        vec3 c=vec3(texture2D(tDiffuse,vUv-d*ca).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv+d*ca).b);
        c=mix(c,c*c*(3.-2.*c),.22);
        float l=dot(c,vec3(.3,.59,.11));
        c=mix(c,c*vec3(.94,.99,1.08),(1.-l)*.3);
        c*=mix(.72,1.,smoothstep(1.0,.25,length(d*vec2(1.,.85))));
        float n=fract(sin(dot(gl_FragCoord.xy+uTime*61.,vec2(12.9898,78.233)))*43758.5453);
        c+=(n-.5)*.02;
        gl_FragColor=vec4(c,1.);
      }`,
  });
  composer.addPass(grade);
  return { composer, gtao, bloom, grade, setSize(w, h) { composer.setSize(w, h); } };
}

// ---------------------------------------------------------------- game post chain
// scene -> depth of field (reads the scene depth) -> bloom -> tone map -> lens (flare, grade, grain)
class DofPass extends Pass {
  constructor(camera) {
    super(); this.camera = camera;
    this.u = { tDiffuse: { value: null }, tDepth: { value: null }, uNear: { value: 1 }, uFar: { value: 1000 }, uFocus: { value: 40 }, uAperture: { value: 0 }, uPx: { value: new THREE.Vector2() }, uMax: { value: 9 } };
    this.fsq = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.u, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse,tDepth; uniform float uNear,uFar,uFocus,uAperture,uMax; uniform vec2 uPx; varying vec2 vUv;
        float coc(vec2 uv){ float d=texture2D(tDepth,uv).x, z=uNear*uFar/(uFar-d*(uFar-uNear)); return clamp(uAperture*(z-uFocus)/max(z,.5),-1.,1.)*uMax; }
        vec3 tap(vec2 uv){ return min(max(texture2D(tDiffuse,uv).rgb,vec3(0.)),vec3(48.)); }   // also swallows NaN / inf before the bloom can smear them
        void main(){
          vec3 c=tap(vUv); float r=abs(coc(vUv));
          if(r>.6){
            float w=1., a=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)*6.283;
            for(int i=1;i<=14;i++){
              float fi=float(i), rr=sqrt(fi/14.)*r, an=a+fi*2.39996; vec2 uv=vUv+vec2(cos(an),sin(an))*rr*uPx;
              float k=smoothstep(0.,1.5,abs(coc(uv))-rr+1.5); vec3 t=tap(uv);
              k*=1.+2.*smoothstep(1.5,4.,max(t.r,max(t.g,t.b)));           // let highlights punch through as bokeh
              c+=t*k; w+=k;
            }
            c/=w;
          }
          gl_FragColor=vec4(c,1.);
        }`,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.u; u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture; u.uNear.value = this.camera.near; u.uFar.value = this.camera.far; u.uPx.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    u.uMax.value = readBuffer.height / 110;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.fsq.render(renderer);
  }
  dispose() { this.fsq.dispose(); }
}

export function makeGamePost(renderer, scene, camera, { bloomStrength = 0.26, samples = 4 } = {}) {
  const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(sz.x, sz.y, { type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(sz.x, sz.y) });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const dof = new DofPass(camera); composer.addPass(dof);
  const bloom = new UnrealBloomPass(new THREE.Vector2(sz.x, sz.y), bloomStrength, 0.6, 1.0); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 }, uAspect: { value: 16 / 9 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float uTime,uSunVis,uAspect; uniform vec2 uSunUV; varying vec2 vUv;
      float disc(vec2 p,float r,float soft){ return smoothstep(r,r*(1.-soft),length(p)); }
      void main(){
        vec2 d=vUv-.5; float ca=.0032*dot(d,d);
        vec3 c=vec3(texture2D(tDiffuse,vUv-d*ca).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv+d*ca).b);
        if(uSunVis>.003){
          // lens flare: veiling glow, anamorphic streak, iris star and ghosts strung through the frame centre
          vec2 A=vec2(uAspect,1.), p=(vUv-uSunUV)*A; float r=length(p), an=atan(p.y,p.x);
          vec3 f=vec3(1.,.84,.62)*(exp(-r*7.)*.12+exp(-r*30.)*.3);
          f+=vec3(1.,.8,.55)*pow(abs(cos(an*7.+sin(an*3.)*.6)),30.)*exp(-r*11.)*.14;
          f+=vec3(.45,.7,1.)*exp(-abs(p.y)*130.)*exp(-abs(p.x)*2.6)*.3;
          vec2 ax=vec2(.5)-uSunUV;
          f+=vec3(.3,1.,.55)*disc((vUv-uSunUV-ax*.42)*A,.022,.35)*.10;
          f+=vec3(1.,.55,.3)*disc((vUv-uSunUV-ax*.78)*A,.05,.25)*.06;
          f+=vec3(.5,.6,1.)*disc((vUv-uSunUV-ax*1.32)*A,.085,.12)*.07;
          { vec2 q=(vUv-uSunUV-ax*1.72)*A; float l=length(q); f+=vec3(.9,.5,1.)*smoothstep(.02,0.,abs(l-.17))*.09; }
          f+=vec3(1.,.9,.6)*disc((vUv-uSunUV-ax*2.05)*A,.035,.5)*.08;
          c+=f*uSunVis;
        }
        c=mix(c,c*c*(3.-2.*c),.22);
        float l=dot(c,vec3(.3,.59,.11));
        c=mix(c,c*vec3(.94,.99,1.08),(1.-l)*.3);
        c*=mix(.66,1.,smoothstep(1.02,.22,length(d*vec2(1.,.85))));
        float n=fract(sin(dot(gl_FragCoord.xy+uTime*61.,vec2(12.9898,78.233)))*43758.5453);
        c+=(n-.5)*.022;
        gl_FragColor=vec4(c,1.);
      }`,
  });
  composer.addPass(grade);
  return { composer, dof, bloom, grade, setSize(w, h) { composer.setSize(w, h); grade.uniforms.uAspect.value = w / h; } };
}
