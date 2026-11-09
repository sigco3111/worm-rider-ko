// Shared surface layer: object-space triplanar micro detail + sand dust accumulation,
// injected into the standard PBR material so every asset weathers the same way.
import * as THREE from 'three';

export const SAND = new THREE.Color(0xb86a40);
export const DUST = new THREE.Color(0xc27a4c);

export function surface(mat, T, o = {}) {
  const u = {
    uSfNoise: { value: T.noise },
    uSfNrm: { value: o.nrm ?? T.metalNrm },
    uSfDet: { value: o.det ?? T.metalDet },
    uDustCol: { value: (o.dustColor ?? DUST).clone() },
    // x,y: object-space height band where ground dust fades out; z: dust on up-facing faces; w: ground dust strength
    uDustP: { value: new THREE.Vector4(o.y0 ?? 0, o.y1 ?? 2, o.up ?? 0.6, o.low ?? 0.6) },
    // x: dust noise scale (1/m), y: detail scale (1/m), z: normal strength, w: roughness/albedo variation
    uSfP: { value: new THREE.Vector4(o.noiseScale ?? 0.12, o.scale ?? 0.5, o.nrmStrength ?? 0.35, o.vary ?? 0.5) },
    uSfFilm: { value: o.film ?? 0.1 },
    uSfStreak: { value: o.streak ?? 1 },
  };
  mat.userData.sf = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON; varying mat3 vSfNM;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vOP=position; vON=normal; vSfNM=normalMatrix;
        #ifdef USE_INSTANCING
          vSfNM=normalMatrix*mat3(instanceMatrix);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        varying vec3 vOP; varying vec3 vON; varying mat3 vSfNM;
        uniform sampler2D uSfNoise,uSfNrm,uSfDet; uniform vec3 uDustCol; uniform vec4 uDustP,uSfP; uniform float uSfFilm,uSfStreak;
        float gDust; float gSfRough; vec3 gNrmP;
        vec4 sfTri(sampler2D t,vec3 p,vec3 w){ return texture2D(t,p.zy)*w.x+texture2D(t,p.xz)*w.y+texture2D(t,p.xy)*w.z; }`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          vec3 n=normalize(vON); vec3 w=pow(abs(n),vec3(4.)); w/=(w.x+w.y+w.z);
          vec4 nz=sfTri(uSfNoise,vOP*uSfP.x,w);
          float streak=texture2D(uSfNoise,vec2((w.x>w.z?vOP.z:vOP.x)*uSfP.x*5.,vOP.y*uSfP.x*.35)).g;
          streak=mix(1.,.6+.8*streak,(1.-w.y)*uSfStreak);
          float up=smoothstep(.45,.98,n.y)*uDustP.z;
          float low=(1.-smoothstep(uDustP.x,uDustP.y,vOP.y))*uDustP.w;
          float dn=nz.r*streak;
          gDust=clamp((max(up,low)+uSfFilm)*(.12+2.6*dn*dn)+low*low*.35,0.,1.);
          vec4 det=sfTri(uSfDet,vOP*uSfP.y,w);
          diffuseColor.rgb*=mix(1.,.72+.56*det.g,uSfP.w);
          gSfRough=det.r;
          diffuseColor.rgb=mix(diffuseColor.rgb,uDustCol*(.78+.44*nz.b),gDust);
          vec3 tx=texture2D(uSfNrm,vOP.zy*uSfP.y).xyz*2.-1.,ty=texture2D(uSfNrm,vOP.xz*uSfP.y).xyz*2.-1.,tz=texture2D(uSfNrm,vOP.xy*uSfP.y).xyz*2.-1.;
          gNrmP=(vec3(0.,tx.y,tx.x)*w.x+vec3(ty.x,0.,ty.y)*w.y+vec3(tz.x,tz.y,0.)*w.z)*uSfP.z*(1.-.5*gDust);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor=clamp(roughnessFactor*(1.+(gSfRough-.5)*2.*uSfP.w),.04,1.); roughnessFactor=mix(roughnessFactor,.97,gDust);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor*=1.-gDust;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=normalize(normal+vSfNM*gNrmP);');
  };
  mat.customProgramCacheKey = () => 'sf1';
  return mat;
}

export const std = (p) => new THREE.MeshStandardMaterial(p);
export const led = (color, k) => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: color, emissiveIntensity: k, roughness: 0.3 });
