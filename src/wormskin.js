// The worm's hide is sculpted in texture space: one height function (metres) describes ribs, pleats,
// ragged armour scutes and crust. It is baked to a normal map and a mask map, and read back once so the
// mesh can be displaced by the very same relief.
import * as THREE from 'three';
import { bake } from './tex.js';

export const SKIN = { LEN: 132, NR: 48, HMIN: -1, HRANGE: 5 };

const FN = /* glsl */`
const float LEN=132.0, NR=48.0, PI=3.14159265;
uniform float uCirc;
float rdg(float x){ return 1.-abs(2.*x-1.); }
float ribProf(float f){ return pow(max(sin(PI*pow(clamp(f,0.,1.),1.25)),0.),.62); }
// what a scute rests on: it follows its own rib, then sails flat over the next crease
float carrier(float f,float amp){ return amp*1.05*(f<.55?ribProf(f):mix(1.,.6,smoothstep(.55,1.5,f))); }
// m = (armour, cavity, wear, crust)
float wormH(vec2 uv,out vec4 m){
  float a=uv.x, v=uv.y, dors=cos((a-.5)*2.*PI)*.5+.5;
  float q=v*NR+.5*(pn(vec2(v*NR*.5,1.5),vec2(NR*.5,8.))-.5)+.55*(fbm(uv,vec2(5.,12.),3)-.5);
  float ri=floor(q), rf=fract(q), rid=mod(ri,NR), rr=h12(vec2(rid,3.7));
  float thin=mix(1.,.7,smoothstep(.55,.95,dors));
  float prof=ribProf(rf), crease=1.-smoothstep(0.,.2,min(rf,1.-rf)*2.);
  float sub=pow(rdg(fract(rf*3.+rr)),2.5)*.17*smoothstep(0.,.35,prof);
  float pl=fbm(uv,vec2(260.,24.),3), pl2=fbm(uv+.31,vec2(90.,96.),3);
  float pleat=pow(rdg(pl),1.8)*(.05+.22*crease+.13*(1.-dors));
  float wr=pow(rdg(pl2),2.2)*.07;
  float skin=prof*mix(.6,1.3,rr)*thin*1.05+sub+pleat+wr+(fbm(uv,vec2(4.,8.),4)-.5);

  float best=-10., pin=0., pwear=0., pcav=0., pcrack=0.;
  float jag=(fbm(uv,vec2(40.,76.),3)-.5)*.5+(fbm(uv,vec2(130.,250.),2)-.5)*.1;
  float pit=smoothstep(.22,.0,wor(vec2(a*300.,v*580.),vec2(300.,580.)).x);
  for(int k=0;k<3;k++){
    float i=ri-float(k), f=rf+float(k), id=mod(i,NR);
    float r1=h12(vec2(id,9.1)), r2=h12(vec2(id,4.3)), amp=mix(.6,1.3,h12(vec2(id,3.7)))*thin;
    float n=floor(mix(9.,17.,r1));
    float pa=a*n+r2+.34*(pn(vec2(a*n,id),vec2(n,NR))-.5);
    float ci=floor(pa), cf=fract(pa);
    vec2 cid=vec2(mod(ci,n),id);
    float pr=h12(cid+17.3), pr2=h12(cid+5.9), pr3=h12(cid+1.1);
    float aC=(ci+.5-r2)/n, dC=cos((aC-.5)*2.*PI)*.5+.5;
    float present=step(.66,pr*.5+dC*.95+(pn(vec2(aC*6.,id*.25),vec2(6.,NR*.25))-.5)*.55);
    float len=mix(1.7,2.75,pr2), start=mix(.05,.3,pr3), wM=uCirc/n;
    float dx=(.5-abs(cf-.5))*wM-.08, dy=min(f-start,len-f)*LEN/NR;
    float d=min(dx,dy); if(dx<.9&&dy<.9&&dx>0.&&dy>0.) d=.9-length(vec2(.9-dx,.9-dy));
    d+=jag;
    float inside=smoothstep(-.03,.07,d)*present;
    float dome=pow(smoothstep(0.,1.25,d),.6), edge=smoothstep(0.,.2,d);
    float lift=mix(.3,.62,pr)*(.5+.6*clamp((f-start)/(len-start),0.,1.));
    float ring=sin(d*10.5+pr*6.)*smoothstep(.06,.3,d)*(1.-smoothstep(1.3,2.4,d));
    float keel=exp(-pow((cf-.5)*wM/.38,2.))*smoothstep(.25,.9,d);
    vec3 w=wor(vec2(a*n*1.5+pr*5.,v*NR*1.5),vec2(n*1.5,NR*1.5));
    float ck=smoothstep(.03,.0,w.y-w.x)*edge*step(.45,pr3);
    float cand=carrier(f*.62,amp)+.14*edge+lift*dome+ring*.038+keel*.13-ck*.07-pit*.035*edge;
    if(inside>.01&&cand>best){ best=cand; pin=inside; pcrack=ck;
      pwear=clamp((1.-smoothstep(.02,.3,d))*.9+max(ring,0.)*.55+keel*.6,0.,1.)*inside; }
    pcav=max(pcav,present*(1.-inside)*smoothstep(-.6,0.,d)*.85);
  }
  float H=skin, plate=0.;
  if(pin>0.){ plate=pin*step(skin,best-.001); H=mix(skin,max(skin,best),pin); }

  float cr=smoothstep(.66,.82,fbm(uv+.7,vec2(14.,30.),4))*smoothstep(.6,.92,dors+(.5-fbm(uv,vec2(8.,16.),2))*.3);
  vec3 cw=wor(vec2(a*150.,v*290.),vec2(150.,290.));
  H+=(smoothstep(.55,.12,cw.x)*(.22+.3*cw.z)-smoothstep(.18,.0,cw.x)*.18)*cr;

  float cav=max(crease*.9*(1.-plate),max(pcav*(1.-plate),pcrack*.8));
  cav=max(cav,cr*smoothstep(.3,.55,cw.x)*.5);
  cav=max(cav,(1.-plate)*smoothstep(.75,.2,rdg(pl))*.22);
  m=vec4(plate,clamp(cav,0.,1.),clamp(mix(prof*prof*.5,pwear,plate),0.,1.),cr*smoothstep(.6,.2,cw.x));
  return H;
}`;

export function bakeWormSkin(renderer, circ) {
  const U = () => ({ uCirc: { value: circ } }), W = 1024, Hh = 2048;
  const packed = bake(renderer, [W, Hh], FN + `vec4 tex(vec2 uv){ vec4 m; float h=clamp((wormH(uv,m)+1.)/5.,0.,1.)*65535.; float hi=floor(h/256.); return vec4(hi/255.,(h-hi*256.)/255.,m.r,1.); }`, { uniforms: U(), aniso: 1 });
  const buf = new Uint8Array(W * Hh * 4);
  renderer.readRenderTargetPixels(packed.userData.rt, 0, 0, W, Hh, buf); packed.userData.rt.dispose();
  const idx = (x, y) => (((y % Hh) + Hh) % Hh * W + ((x % W) + W) % W) * 4;
  const px = (x, y) => { const k = idx(x, y); return (buf[k] * 256 + buf[k + 1]) / 65535 * 5 - 1; };
  const h = (a, v) => {
    const x = a * W - 0.5, y = v * Hh - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const p00 = px(x0, y0), p10 = px(x0 + 1, y0), p01 = px(x0, y0 + 1), p11 = px(x0 + 1, y0 + 1);
    return (p00 + (p10 - p00) * fx) * (1 - fy) + (p01 + (p11 - p01) * fx) * fy;
  };
  const plate = (a, v) => buf[idx(Math.round(a * W - 0.5), Math.round(v * Hh - 0.5)) + 2] / 255;
  const normal = bake(renderer, [2048, 4096], FN + `vec4 tex(vec2 uv){ vec4 m; vec2 e=vec2(1./2048.,1./4096.);
    float x1=wormH(uv+vec2(e.x,0.),m), x0=wormH(uv-vec2(e.x,0.),m), y1=wormH(uv+vec2(0.,e.y),m), y0=wormH(uv-vec2(0.,e.y),m);
    return vec4(normalize(vec3(-(x1-x0)/(2.*e.x*uCirc),-(y1-y0)/(2.*e.y*LEN),1.))*.5+.5,1.); }`, { uniforms: U(), aniso: 16 });
  const mask = bake(renderer, [2048, 4096], FN + `vec4 tex(vec2 uv){ vec4 m; wormH(uv,m); return m; }`, { uniforms: U(), aniso: 16 });
  return { h, plate, normal, mask, circ, LEN: SKIN.LEN };
}
