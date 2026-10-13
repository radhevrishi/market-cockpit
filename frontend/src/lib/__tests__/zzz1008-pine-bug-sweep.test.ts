// zzz1008 — Pine bug sweep (owner / tester reports 2026-10-13): stages never cleared by the setup cards / timeframe switches, a
// rebuilding timeframe reads "cannot be determined yet" (never "0 match"), session-behind Nasdaq quotes during the session, breakouts
// back below the pivot labelled as such, ONE documented close for the 21 / 50 / 200-day distances, timeframe-specific coverage
// warnings, "Double bottom" without "(W)", auditable geometry (turning points + evidence) on every tag and the chart hand-off, and
// two precision rules (1-year-high runaway, 6-candle monthly minimum) with regression fixtures from the disputed real charts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzePatterns, detectPatterns, toTags, PATTERN_META, PATTERN_IDS, POINT_ROLES, RUNAWAY_RULES, MONTHLY_MIN_SPAN, ranAwayFrom1y, PATTERN_ENGINE_VERSION,
  type PBar, type PatternTimeframe, type PatternId,
} from '../chart-patterns';
import {
  resolveUsQuote, rowScanFields, leanRows, rowGeometry, runPineFull, cleanQuery, DEFAULT_QUERY, PATTERN_SCAN_VERSION, type ScreenPatternTag, type PineQuery,
} from '../screener/pine';
import { BUILT_IN_PINE_SCREENS } from '../screener/pine-presets';
import {
  stageWord, isReturned, maVerdict, maPosition, conflictWords, tfCoverageWarnings, scopeCoverage, queryRebuild, setupRebuild, querySummary,
  geometryPoints, pivotDerivation, evidenceRows, chartIdentityParams, tagRejectReasons, setupCounts,
} from '../screener/pine-view';
import { tagPasses } from '../screener/filters';
import { parsePatternHandoff, handoffSpan, stageWords } from '../../components/charts/pattern-view';
import type { ScreenRow } from '../screener/types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

// ───────── fixtures: the disputed real charts (same compact format as zzz1005: '<first day b36>,<exp>|dt,o,h,l,c,v;…'; W / M bars are
// the engine's own weekly / monthly aggregates). `old` = the previous engine's score on these very bars; `why` = the measured reason.
interface Fx { name: string; tf: PatternTimeframe; id: PatternId; old: number; why: string; bars: string }
const FIX: Fx[] = [
  { name: 'RVTY M double_bottom', tf: 'M', id: 'double_bottom', old: 100, why: 'geometry valid (lows 81.36 / 81.22, middle peak 118.30) but the price ran to its 1-year high (96.6% of 158.28, made after the second low) — 29% past the pivot: not a current bottom', bars: 'd6o,-2|0,41n,43w,3w1,3xd,3bib;i,3y1,41y,3hz,3ww,nq0;u,3x0,470,3wb,40v,lxk;x,41f,466,3xu,43r,kp4;t,43n,4by,3wj,46q,m1g;s,47x,4i5,45x,4ha,obo;x,4h7,4nn,4c5,4l1,h48;s,4lz,4vf,4k1,4v6,jeg;v,4va,5bf,4uv,59a,mn4;w,5a0,5ew,51s,52v,h70;t,53r,56s,4tf,563,kng;v,568,5dd,54o,5bl,kuo;v,5c8,5ma,5bt,5kw,jg4;u,5m3,5pv,5eq,5oo,kzo;u,5oi,5pw,5c9,5n4,hts;w,5or,6ip,5nj,66o,lto;u,65v,66y,5gi,5w2,mpw;s,5w5,65q,5my,5uc,l30;w,5u2,5xy,5kf,5ns,hi4;t,5my,5xn,5gr,5qh,ku4;v,5ry,65f,5i3,5nf,h34;v,5ly,659,5jv,63y,llw;u,63j,76r,63g,74r,o2s;y,73k,7jl,70h,7i7,3yzb;r,7je,7l5,6bg,6o8,prw;v,668,6rt,629,6pu,ohs;w,6ts,71t,5jj,627,kmc;u,5z1,71h,5kg,6ze,jxw;u,71f,7du,6t8,79k,g94;s,7b2,7jx,720,7fo,g30;v,7ia,7y4,717,7e8,qgw;u,7eg,7hc,6ft,6nu,12ss;x,6nu,7ij,6li,7fm,nx8;s,7jh,7ol,6j7,6n8,n8s;v,6nh,6qt,64g,6dq,ni8;x,6cg,6ro,68z,6kl,i24;s,6l0,6ss,61n,6ms,rzw;v,6p3,78l,6lf,762,imo;v,76v,7j9,6yu,7hq,3uuz;v,7kx,7wm,73f,74w,o3w;w,77l,7i4,6di,6o4,is8;s,6og,6yz,4ur,5t4,10k8;u,5lj,72a,5dc,6zh,vx0;u,6v8,7ta,6m3,7r3,v9o;v,7pp,85m,76z,7kh,sew;u,7k8,9dc,7g6,96b,10o4;x,98e,9i9,8lm,930,rmk;t,95t,9qa,8lq,9on,onc;u,9u6,adb,996,9zv,v94;w,a1n,b09,9hq,a9g,yuk;t,a95,bkj,a6i,b2m,pmc;y,b4d,cjy,atn,bcj,rc0;s,bfs,c30,9my,9q9,x4c;s,9v1,a3e,997,9wd,1404;v,9z8,aiw,9vm,a03,ows;w,a3l,bi5,9s3,b6z,tvo;t,b66,c4d,all,bwx,noc;u,bwe,e6p,bn6,e27,oyg;w,e5c,elv,dqm,e9c,nec;u,ea0,etc,d5a,ddd,ngk;u,dd8,dtd,csu,dnd,hw0;v,dne,et3,cjt,e20,rn4;u,e0k,foc,dh7,fii,147w;x,fdz,fih,cik,da9,10jo;t,dc6,epc,d1j,dux,pl8;s,dvk,e97,chg,dgm,oq4;v,dk4,dk5,ay9,bb9,m20;v,ba1,c7b,as2,bjr,urw;u,bk2,brh,a8u,az2,li0;u,azj,c0v,a2x,bth,k5o;v,d38,d48,acb,af6,rd4;v,ac5,b0m,8yq,9a9,otg;w,9e9,aq5,8r6,ab2,ou0;t,afn,ba3,9ja,as5,wd4;u,avw,bl5,afg,ati,mj8;x,ay7,b4l,9vw,am1,r0c;t,arg,b7r,9ex,9m1,sd8;s,9jx,ab4,90b,aa6,s3s;x,a7l,aq8,9mb,a2h,ktk;s,a33,a86,8qd,8wc,umw;v,8yk,99n,8jn,95z,rmk;w,94s,a6k,8u1,9hj,n10;t,9mn,9v8,8nw,913,mt8;v,94o,972,85z,8ji,ly4;v,8h8,8iv,64u,6e5,vd0;u,6gi,70c,69i,6uy,qe4;u,6ug,8lh,6ra,8fn,rwk;w,8eh,8vg,82o,89q,q5s;u,8de,8ku,7q8,8gf,pl8;t,8e2,8jn,7w9,83o,o3c;v,83o,8ju,7ic,7wn,x4c;u,7xl,8tm,7qq,8fi,vlc;x,8fv,8pl,7yf,83a,pyk;s,83b,9vz,7te,9ox,w9s;v,9r7,9v6,8w0,9ge,ld0;x,9dj,9vk,8v8,9uv,l44;s,9uq,9v3,8w7,95f,o5k;v,992,9zq,89p,8ym,yjg;v,8xn,9bl,8b0,8m1,pv8;v,8ob,9wd,8jl,9qd,s1k;w,9pa,9rl,8ab,8nj,r20;s,8p6,9af,7yp,85w,xpg;t,84l,89o,6tx,77j,1fmg;u,7bl,7me,6sh,6z6,14hc;w,6wo,7tc,6rm,7go,xi8;t,7fa,821,6ro,6s6,1dnw;v,6pq,7b4,6kg,6yb,106w;w,6wf,6wz,6a0,6rh,1634;t,6r7,7qx,6r7,77z,1aqc;x,756,87w,6ts,821,1g4s;s,7wx,838,7d4,7gr,12ec;w,7i0,94m,7ga,8e8,19k4;v,82a,8fl,78a,7l3,16ys;s,7f0,7ni,6fw,6rd,11uw;u,6t1,7hn,69m,6om,wts;u,6p9,83s,6k5,82f,1gvg;v,80o,8yo,7h2,8l2,1e3g;u,8mh,8y8,7wd,8ok,194k;x,8og,a1b,8b9,9xf,1duk;t,9u2,c7o,9bu,bsp,22k0' },
  { name: 'RVSB M cup', tf: 'M', id: 'cup', old: 85, why: 'a 4-candle "monthly cup" (lip Jun 2026 6.22, low Aug 5.02, right side Sep 6.05) — the 86-day daily cup with handle seen through 4 monthly candles', bars: 'd6o,-2|0,fi,ft,eg,ej,15bu;i,ek,h8,e2,gv,3vcq;u,gz,mo,gz,jg,lrz;x,jq,m8,ir,lb,45vm;t,lb,lo,k9,lh,frv;s,lj,lt,j9,jv,440e;x,k0,ku,jq,k6,2rda;s,k6,k9,i2,iy,x87;v,iy,jp,hy,ig,2597;w,ic,lw,i2,l3,1c73;t,l5,mm,l5,mb,13xb;v,m3,nw,l9,nc,rer;v,nh,p5,lr,oo,h1f;u,ox,q4,me,pm,ug7;u,ps,qi,nt,o3,l7z;w,o7,qv,nc,qm,lnj;u,qk,qm,nw,o0,3n1u;s,o1,r3,ns,py,3nz6;w,px,qv,os,q3,2a0u;t,q1,q6,n3,ob,lf7;v,od,qj,ng,ng,jjz;v,nf,pd,n3,pa,38aq;u,p9,rm,p1,rd,403a;y,re,rr,nx,ok,32xy;r,ol,op,ji,nj,3hxy;v,nm,o8,mh,mm,30sq;w,mp,n0,f6,k8,3mg6;u,k0,lv,jo,kp,2iiy;u,kr,lt,k9,li,2q9a;s,lo,mn,jq,kb,hd3;v,k9,lf,jj,km,39hi;u,kp,m3,k0,lj,hgz;x,ll,o0,jl,nq,i73;s,o6,o6,ln,nm,hor;v,nb,nn,ja,jl,2pge;x,jf,m6,ix,ki,m8n;s,km,ku,j9,jz,2u0u;v,k0,l1,ji,k3,2lke;v,k8,nr,jn,mt,gy3;v,mp,n4,k7,kg,44fy;w,km,kp,hn,hx,3s5q;s,hx,io,cf,dx,11lf;u,dj,g9,b9,fd,udz;u,es,f4,cj,dw,k8f;v,dw,h2,dg,fp,sqj;u,fq,fv,cu,dk,om7;x,do,do,bb,bh,i2n;t,be,c0,ah,bj,jwr;u,bi,ex,bd,d1,49r2;w,dd,g5,cp,eo,2xji;t,es,fq,dm,em,hy7;y,ek,fw,dz,eh,h0v;s,eh,j2,e8,ic,hvz;s,jc,ln,i8,j9,t5j;v,j5,kp,ir,j5,kun;w,jc,jy,ip,j3,fun;t,j4,kk,hw,jp,21ff;u,jm,k1,ij,je,45w6;w,jj,ln,j8,ke,2kvy;u,kk,ky,jg,k7,21ou;u,ke,l4,jb,kj,2w6m;v,kl,mu,kc,kn,36ai;u,ku,m5,jy,ld,3jfu;x,lj,md,ku,kz,35ae;t,kz,m4,k5,ll,3wl6;s,lh,m6,kb,kz,30fe;v,l4,ld,ja,jk,1bx2;v,jg,jr,ho,ix,1a06;u,iw,j1,gw,ia,1oca;u,ia,lq,he,kg,3jx2;v,jn,kk,iz,jl,32ha;v,jp,ju,h3,hn,223u;w,hn,jf,hb,iq,11ka;t,io,lj,ie,l3,1b3m;u,l5,m8,js,lc,1olq;x,l3,m3,jc,ke,2g4a;t,kg,ky,j3,jf,1ujm;s,jb,jt,eg,eu,g7z;x,er,g6,dy,e9,23sy;s,ed,en,bl,d0,2iei;v,d2,er,c6,e0,237u;w,e3,gb,dx,fo,1qfa;t,fn,gw,ff,gg,gar;v,gg,gr,fa,fg,21s6;v,fg,g4,el,ev,21m2;u,f1,h7,em,gm,1n1m;u,gh,i9,g1,hs,3j6y;w,hr,i3,f9,f9,25au;u,fy,fy,cq,d1,1uii;t,d1,ec,c7,d4,2g4a;v,da,dh,9d,ad,27cq;u,an,dm,a2,bv,2d1q;x,c1,cy,9z,b3,3fju;s,b5,d1,96,cu,33u6;v,ci,d7,c7,cu,40c6;x,cp,du,bz,d3,2bfy;s,d3,dc,cd,d6,1u5q;v,db,fs,ct,fi,2yce;v,fm,gd,f9,fy,2vbi;v,fy,g4,f0,fo,2b22;w,fp,ft,e7,ed,3dwe;s,eb,fz,e1,fp,ov3;t,fp,i7,f8,hk,u1r;u,hr,ib,f8,fg,2abz;w,fe,gn,er,fa,28rb;t,fa,g9,dk,dp,12hn;v,dn,ei,d6,e2,fsf;w,e2,f4,d6,ex,pz3;t,ew,f2,dx,ee,hfv;x,eb,fk,e1,en,3a22;s,ep,fm,dk,dy,i0f;w,dw,er,dr,ed,412u;v,eh,fd,eg,ev,45h6;s,er,ft,dw,fa,iqj;u,fc,g8,dw,ee,36je;u,eg,fz,e5,fl,3a8q;v,fi,ha,eg,f3,1saj;u,f7,fh,eg,eq,my7;x,es,ff,dy,eg,i4b;t,eg,gt,e9,gj,j9f' },
  { name: 'GTECJAINX W double_bottom', tf: 'W', id: 'double_bottom', old: 100, why: 'first low 25.00 (week of 13 Jul 2026) is 61% above the 26-week low 15.54 and not the lowest of its own lead-in (16.20): a pullback after a +100% spike, not a bottom after a fall', bars: 'eli,-2|0,1jk,1jk,1g8,1ig,277p;7,1j5,1jk,1dv,1f4,1vs1;7,1dl,1hc,1dl,1gd,35xo;7,1gd,1qi,1eu,1ke,1fcy;7,1jk,1lx,1ea,1fj,1s2p;7,1gn,1po,18q,1m7,1a7e;7,1ng,1oz,1fo,1hc,v9m;7,1gx,1mc,1e5,1gd,3sq9;7,1hh,1jk,1c7,1ft,x2m;7,1fy,1jf,1d1,1gs,htq;7,1i6,1jk,1fe,1iv,34yp;7,1ky,1ky,1g8,1jf,h1e;7,1jk,1mc,1h2,1ky,47sh;7,1ls,27l,1iq,1sg,urv;7,1sg,1sg,1hm,1mm,41g5;7,1nv,1pj,1hm,1k9,30kd;7,1lx,1nb,1i6,1k9,2pzt;7,1l3,1l3,1fe,1fy,1wax;7,1e0,1ft,18v,1c2,fhu;7,1e0,1e0,195,1b3,1ge5;7,1b8,1hh,195,1fo,1odx;7,1ep,1kt,1dv,1ft,1dx9;7,1h2,1h2,1bx,1ea,29wx;7,1ea,1fe,190,1e5,23ix;7,1e5,1ju,1c2,1gn,26jt;7,1hr,1jk,1bx,1i6,3sbt;7,1kt,1oa,1gs,1l3,30pd;7,1n1,1n1,1fo,1gd,1b59;7,1jf,1jf,1ao,1bn,20jp;7,1ez,1ky,1ao,1ea,48op;7,1ja,1ja,18q,1cw,1eul;7,1g8,1g8,15e,19a,1h9t;7,1aj,1cc,16x,1ae,kmt;7,1b8,1of,1b8,1d6,3o09;7,1c7,1fe,16s,186,tl1;7,17c,1cm,140,19a,14xd;7,1b3,1cm,17m,1c2,szx;7,1d1,1dq,18q,19u,oph;7,1b8,1tz,1b8,1fy,2hh6;7,1ek,1uo,1ek,1mc,1tcu;7,1l8,1v8,1k4,1n1,yje;7,1n1,1oz,1jp,1l3,1ccl;7,1l3,1o0,1iq,1ky,10kp;8,1mm,1nq,1j0,1mr,1b1d;6,1jz,1zt,1jz,1zt,ow6;7,23a,2ey,23a,2ey,k16;7,2ey,2ey,2ey,2ey,0;7,2an,2j9,2an,2j9,0;7,2j9,2j9,2j9,2j9,0;7,2j9,2j9,2j9,2j9,0;7,2j9,2j9,2j9,2j9,0;7,2j9,2j9,2j9,2j9,0;7,2j9,2j9,2j9,2j9,0;7,2j9,2j9,2j9,2j9,0;7,2j9,2j9,2j9,2j9,0;7,2j9,2j9,2j9,2j9,0;7,2np,2np,2np,2np,0;7,2np,2np,2np,2np,0;7,2np,2np,2np,2np,0;7,2np,2np,2np,2np,0;7,2np,2np,2np,2np,0;7,2np,2np,2np,2np,0;7,2np,2np,2np,2np,0;7,2np,2np,2np,2np,0;7,2sf,2sf,2sf,2sf,0;7,2sf,2sf,2sf,2sf,0;7,2sf,2sf,2sf,2sf,0;7,2sf,2sf,2sf,2sf,0;7,2sf,2sf,2sf,2sf,0;7,2xf,2xf,2xf,2xf,0;7,2xf,2xf,2xf,2xf,0;7,2xf,2xf,2xf,2xf,0;7,2xf,2xf,2xf,2xf,0;7,2xf,2xf,2xf,2xf,0;7,32k,32k,32k,32k,0;7,32k,32k,32k,32k,0;7,32k,32k,32k,32k,0;7,32k,32k,32k,32k,0;7,32k,32k,32k,32k,0;7,32k,32k,32k,32k,0;8,32k,32k,32k,32k,0;6,37z,37z,37z,37z,0;7,37z,37z,37z,37z,0;7,37z,37z,37z,37z,0;7,37z,37z,37z,37z,0;7,37z,37z,37z,37z,0;7,3do,3do,3do,3do,0;7,3do,5d2,3do,5d2,mjq;7,5mn,6i6,5mn,604,mqe;7,604,604,604,604,0;7,604,604,604,604,0;7,5vt,5vt,5vt,5vt,0;7,5rn,5rn,5bo,5bo,s48;7,57x,57x,4tm,4tm,22q1;7,4s8,528,4dn,4r4,l1u;7,4th,5c3,4fq,5c3,19r9;7,5lo,5pp,53m,5i7,463x;7,5eb,5h8,5af,5dr,1c9t;7,5eg,5lo,5af,5lo,18c5;7,5jv,5p0,5fz,5p0,3ppw;7,5t1,65j,5qy,61d,4921;7,66n,71r,5v4,71r,14iy;8,7da,7ud,73k,7lr,39s1;6,7lr,80w,7g7,7y4,499s;7,7y4,7zi,7s5,7sk,1s8s;7,7sk,7sk,7n0,7n0,0;7,7hl,7hl,71r,76r,kgp;7,7bw,7gw,71h,7gw,19ic;7,7ey,80c,726,726,3sj0;7,726,7et,6jf,780,2fzs;8,780,7hg,70s,7e9,1cpw;6,771,7sk,70x,78a,1rfc;7,78a,7vc,72l,76h,1doc;7,76h,7s0,6mw,77q,15qs;8,7hg,aup,7eo,9di,za2;6,96k,96k,7n0,86v,1lyp;7,7sk,83j,758,79o,hzt;7,79o,7i5,6ky,73k,0;8,6y0,6y0,65e,668,1o5k;6,5v4,61s,5go,5zk,1m2l;7,6a9,7ai,63g,6li,2rg0;7,6li,7g2,69p,74o,3l9c;7,6rw,7d5,5zu,6k4,gf5;7,6mw,6vi,677,6d6,1uls;7,6d6,6ou,62m,6mm,lpp;7,6mm,6yf,5sw,5sw,is5;7,5ku,5uu,5a0,5jg,0;8,5tb,5wi,5kk,5l9,2us0;6,5l9,70i,5l9,6wm,3t58;7,6xq,78z,6k9,6q8,0;7,6ld,6ld,6ld,6ld,0;7,6mw,6mw,6bd,6ft,40g;7,6b8,6fo,61n,61n,gf5;7,61n,61n,5p0,5p0,oyw;7,5p0,5p0,57i,5gt,ol1;8,5uk,6ek,5uk,64f,2uqc;6,63g,63l,5qy,5qy,lxg;7,5o6,5r8,5g4,5g4,tn8;7,5c8,5c8,54l,54v,0;8,54v,54v,515,54s,1uv8;6,58h,5f0,564,564,2dz0;7,5eg,6jt,5eg,6jt,14ix;7,6hc,6oj,5ws,5za,s21;7,69z,6ef,5n2,668,3q88;7,6f4,6f4,5ms,62v,1n74;7,65o,6bi,5k0,5tc,1p8g;7,5t1,5t1,53c,564,1dss;7,59v,5fa,4v0,50k,274c;7,546,546,4k5,4xn,1e3d;7,4xn,57e,4u6,52v,496g;7,52v,5bo,4is,4q0,lwx;7,4q0,4yi,4ei,4la,qj1;7,4o2,4z6,4d0,4kg,1bd1;7,4s8,4vk,4bu,4jc,30pd;7,4re,4s8,47q,4h4,1dx8;7,4h4,4mo,43s,4cr,mtp;7,4jw,4jw,3ie,3lb,2ixd;7,3p7,3q1,37b,3fj,le1;7,3fm,3mf,384,3dx,2k5s;7,3jf,3mk,345,3bk,2efp;7,3e8,3gz,2s9,2sf,t9d;7,2w9,2xk,2ng,2uc,n71;7,2yy,2zg,2gj,2pc,2ikl;7,2to,2to,2lb,2rz,mil;7,2wy,322,2s0,2yv,kl5;7,30c,334,2rg,2zn,3zc0;7,334,334,2qr,2vy,vko;7,2vy,315,2j4,2rb,llt;7,2pc,2us,2hz,2i1,h6x;7,2di,2oy,29y,2nu,2yig;7,2ps,2x0,2j1,2qm,inp;7,2qm,2qm,2oo,2qm,4co;7,2sl,2sl,2np,2nu,b9k;7,2nu,2nu,2k1,2kh,0;7,2k8,2k8,2fl,2fl,0;7,2dt,2fl,2c3,2c3,jq1;7,2c1,2gw,255,2cg,p8e;7,2gm,2nu,2c1,2hm,0;7,2lw,2us,2j4,2ps,0;7,2ps,2ps,2dn,2hl,xfw;8,2hu,2ml,2d3,2dk,2df0;6,26w,2m9,214,282,1lqd;8,280,2gp,20m,28o,jxt;6,29i,2e4,237,27s,lcy;7,290,290,1s0,1sl,29o1;7,1vk,1vk,1ir,1pe,o12;7,1pe,20m,1o0,20m,1fcd;7,22g,27h,1xg,21c,wp9;7,24o,24o,1ya,20r,pdd;7,1yt,239,1rj,1u9,1dtx;7,1uo,1xj,1q8,1re,pw9;7,1o7,1y0,1o7,1wm,nud;7,1wm,1wm,1ob,1sl,3i40;7,1tx,1w4,1po,1uo,2t7w;7,1uo,1xg,1rc,1w0,mop;7,1vy,257,1sv,257,m7h;7,28k,28y,22v,230,sc1;7,230,230,201,201,0;7,201,201,1xg,1xg,co4;7,1xg,1xg,1w2,1w2,kog;7,1vs,1vs,1tz,1va,1qd0;7,1tx,1tx,1sl,1sl,191o;7,1sl,24f,1sl,205,3agg;7,205,205,1r2,1wj,1jvo;7,1uy,22g,1p9,21f,gz5;7,24v,24v,1v4,208,2rho;7,23u,23u,1uz,21b,2i50;7,22s,244,1st,1uy,242c;7,1wa,20x,1tz,1x7,2v0w;7,1xg,258,1om,24f,15tl;7,25g,25g,1qv,1v8,1a55;7,1v8,1y5,1pz,1qz,fwt;7,1sj,1xg,1qb,1qs,366k;7,1x1,1xb,1qi,1vl,w81;7,20s,20s,1r7,1tq,lvt;7,1ze,1ze,1r7,1ta,2qd4;7,1sz,2kz,1pz,22l,3ysm;7,23k,23k,1rd,1w0,ssq;7,1uq,1zy,1rw,1uo,1esx;7,1tg,1yk,1r2,1vn,ybl;7,1yu,1yu,1ka,1r7,1e79;7,1r7,1w1,1eu,1kk,v41;7,1kk,1q8,1ez,1j9,10o1;8,1rm,1rm,1e0,1l2,2dal;6,1hr,1lm,1ef,1fx,wep;7,1i5,1li,1e0,1gg,pul;7,1hm,1rq,1cc,1jj,10yl;7,1jj,1mc,1ea,1hg,1hh1;7,1ja,1ji,1dz,1g1,gcd;7,1g1,1nn,1fy,1kj,xsp;7,1kj,1ou,1gj,1l7,y9x;7,1ig,1kx,1g9,1hy,lgt;7,1hm,1jk,176,1gr,j4y;7,1jh,1mc,1ep,1li,s49;7,1ln,1nq,1fo,1i3,uid;7,1cn,1l7,1cn,1gr,k9h;7,1k4,1p4,1eu,1k3,395s;7,1k4,1m0,1hc,1j6,43j4;7,1je,1m2,1c2,1ih,142t;7,1iq,1jk,1ed,1eu,sj9;7,1d8,1gi,190,1ad,3wak;7,1jj,2ov,1c2,2ov,g57;7,2td,2yj,2et,2et,1qoq;7,2ah,2ah,1v7,1v7,15rd;7,1tf,29i,1rv,29i,o4e;7,2df,2dk,26y,26y,1s4d;7,25e,25e,1zg,1zg,wop;7,1zs,236,1xg,230,10bt;7,24i,296,24i,27k,10tl;7,27k,2aq,25n,25n,m09;7,243,2fn,221,2fm,1oid;7,2jy,2jy,25q,28j,fsy;7,28j,2cq,24m,2ba,1jyh;7,29o,2bc,24z,280,1v8l;7,28u,29j,230,29b,lvt;7,27o,29e,215,221,18vl;8,1ww,29y,1ww,22m,1wlh;6,22j,29e,20i,21o,166d;7,209,2ro,209,2ro,2mex;7,2wn,31v,2lq,2lq,ge2' },
  { name: 'BVN D double_bottom', tf: 'D', id: 'double_bottom', old: 100, why: '"first low" 29.17 (29 Jul) is a higher low 15 sessions after the real low 27.31 (8 Jul); the real lows (27.31 / 29.69) differ 8.7% (> 5%)', bars: 'fj5,-2|0,10o,11j,10h,112,2t7e;1,10j,10v,zz,100,3vgm;1,zy,11f,zy,10j,m6f;1,10m,118,104,10w,2dwu;1,11t,125,10y,115,435a;4,11c,11t,10q,11b,2hh6;1,10s,119,10c,10t,331a;1,10y,11i,10a,10e,3y46;1,zu,112,yi,z0,1pu7;3,yp,zl,y3,zf,hvz;1,z4,zr,y6,z1,qdj;1,yz,10h,yz,zo,2l5y;1,z7,zo,yy,zl,2wr6;1,z1,zj,yl,zf,47si;3,100,10k,ze,zk,1yoi;1,zt,10p,z9,10a,2aly;1,10e,12m,10a,11s,jln;1,11q,12c,11h,11k,48eq;1,11r,11s,109,11a,1zcy;3,112,11i,102,108,36je;1,10i,120,10i,11v,304a;1,121,12i,11l,11w,j77;1,124,13u,11n,13h,34ka;1,147,15j,134,158,nbj;3,15r,17p,15r,16r,169r;1,17v,187,174,17b,utj;1,17b,17u,16h,16r,345u;1,15z,178,15s,175,2nk2;1,16u,173,165,16y,17kf;3,16u,17g,16g,16q,33om;1,17a,182,16l,172,3nva;1,174,175,15y,16e,hhj;1,16l,184,16c,17v,s0z;1,182,18w,16x,171,j3v;3,16q,17l,15q,17f,396y;1,17d,17v,16x,177,iir;1,173,177,15y,16a,vlv;1,146,16m,13w,14l,g3j;1,13k,13x,102,110,sff;3,106,11v,yw,zy,yqn;1,116,11g,zk,zy,lbv;1,10w,13t,10w,12o,ryr;1,12w,145,12e,12w,3k6i;1,146,15w,145,154,ifz;3,14p,15y,148,159,2woe;1,15a,15n,14b,15g,2ja6;1,15n,16u,157,15n,iyv;1,15k,15k,13b,13q,2m1m;4,150,15m,145,151,418e;1,15n,15n,14d,14p,r7j;1,13d,15a,13b,146,3o46;1,14l,167,14d,15n,33lu;1,153,157,13x,14h,ftj;3,148,14t,13c,13y,r47;1,13g,13u,12r,13e,2k5a;1,12w,13e,12c,13c,1ln3;1,145,145,11e,12o,hpb;1,12z,140,121,13x,49ke;3,14u,15h,14m,15a,2wlm;1,15z,16y,15p,16u,u5n;1,15z,168,159,15s,3nbu;1,15q,15t,14r,14u,3176;1,15h,15y,14z,15q,2nhu;3,14m,151,13h,13n,kwv;1,13u,14f,13l,14b,2tbu;1,13i,13r,12w,13i,2ymy;1,13x,14d,13a,14a,fg7;1,13a,14g,131,14c,3ie2;3,14s,14v,144,14l,1iwq;1,14o,15d,14o,155,25fa;1,15g,167,15b,15h,lz7;1,159,15h,14g,14h,1i3a;1,15c,15o,14k,15o,209q;4,14z,15i,14k,14x,2f0u;1,153,15u,14x,15d,3k2m;1,15o,161,154,15r,33om;1,15j,15v,15b,15m,igj;3,16p,18v,16m,18g,1hm3;1,17w,18o,17g,18k,m47;1,19a,19a,18i,18x,lar;1,19y,1bm,19y,1b4,18ib;1,1bd,1cf,1at,1b3,lz7;3,1bb,1c0,1az,1b2,iw3;1,1bb,1bi,19f,1a2,3ifq;1,1a0,1a6,195,1a4,gf7;1,1af,1ax,1a0,1ap,2fza;1,1b1,1c3,1an,1ax,hpv;3,1al,1b0,19t,1a0,fjj;1,1a4,1ac,19g,1a7,2e9m;1,19z,1ai,19r,1a0,1ncq;2,19u,1a3,18o,18y,sgj;3,18z,19j,18t,195,3162;1,185,18r,17e,18g,3agi;1,184,18o,17v,18o,1kvu;1,18n,1ag,18g,1ab,454y;1,192,19b,17u,18v,hx3;3,192,19y,18y,19m,3goy;1,19y,1ah,19f,19k,1ib2;1,19y,1a9,19e,1a6,2qvi;1,19x,1ak,19o,1ae,179u;4,19x,1aj,199,1a5,2coe;1,1a0,1ac,18q,193,jrr;1,18y,19l,18s,19k,2jhe;1,19n,1a3,18y,19u,2an2;1,1a9,1bg,1a0,1aw,32am;3,1bq,1bq,1a0,1ae,22lm;1,19y,1a3,18z,19k,lvv;1,19p,19y,18z,19i,2mxu;1,18r,1b6,18m,1b1,mhj;1,1bd,1bd,19n,1a2,1x3u;3,1au,1cy,1ap,1cf,hpv;1,1d1,1dy,1cr,1dg,hj7;1,1d5,1dt,1ch,1d1,3932;1,1cg,1di,1bs,1de,2m76;1,1d6,1dl,1bl,1c9,2ju6;3,1by,1cc,1b8,1c5,3coi;1,1c2,1d3,1bs,1cx,2jqu;1,1ck,1ct,1b4,1bi,itb;1,1bp,1bu,1ay,1b9,49fy;1,1ce,1ce,1b2,1bc,2cr6;3,1bv,1ct,1bm,1cm,1gge;1,1c6,1dv,1c6,1dq,3yyq;1,1dt,1fo,1dr,1ey,njb;1,1fb,1g0,1eb,1fe,10j3;1,1g2,1g7,1em,1ex,3s8i;3,1dq,1f1,1d1,1eg,1hmm;1,1em,1ez,1e5,1es,1e6q;1,1ew,1fj,1eq,1f5,3jvy;1,1ey,1fk,1ea,1ep,g9n;1,1ed,1f0,1e1,1ez,p4j;3,1f8,1fj,1e7,1fg,1w86;1,1f7,1fa,1e3,1ej,3nu6;1,1eo,1f0,1e6,1eu,3kja;1,1eo,1fv,1eo,1f3,2odi;1,1ev,1gw,1ep,1gf,gy3;3,1gf,1gf,1fc,1fe,3716;1,1fm,1gr,1fl,1gn,q93;1,1g8,1ge,1f1,1fq,3tj6;1,1fy,1gj,1fh,1ge,28a2;1,1ge,1hg,1g9,1h6,j4f;4,1ia,1j3,1hp,1ik,lxj;1,1j4,1k3,1ip,1je,p2b;1,1iy,1jg,1ij,1j2,484q;1,1jr,1kd,1il,1jj,3uky;3,1kd,1kn,1iw,1jm,3nga;1,1k1,1k1,1ie,1ig,3vgm;1,1is,1jw,1in,1jo,hvf;1,1j9,1k9,1j6,1k2,j63;1,1k9,1kx,1ja,1jr,2xji;3,1jt,1lz,1jh,1ld,rer;1,1ls,1lv,1jn,1jv,h7j;1,1ja,1ki,1iw,1j2,hwj;1,1j3,1jt,1ib,1jm,g93;1,1ju,1m8,1ju,1m3,2907;3,1om,1pd,1my,1nt,rjr;1,1o6,1pt,1o2,1p9,y3b;1,1py,1rr,1pw,1ri,qk7;1,1s0,1sr,1qe,1ro,gqb;1,1rj,1sk,1qk,1sk,jhr;3,1ui,1vv,1u9,1vl,k67;1,1ut,1wh,1ue,1vl,naz;1,1wm,1xs,1ve,1wh,43xm;1,1wx,1yq,1u7,1x9,ksf;1,1xe,1y9,1vv,1w1,3znq;3,1ww,1yk,1w8,1wv,3ubi;1,1x0,1x4,1vd,1vw,gar;1,1y8,21h,1xr,20y,lzr;1,222,22v,1wh,1x9,lfr;1,1xq,1xq,1vd,1wb,mmj;3,1ym,1zs,1xp,1z8,38o2;1,1xx,1yl,1xb,1y8,3wf2;1,1zi,21r,1yq,1yy,ytz;1,1zy,22x,1zj,22c,15nj;1,1zy,20x,1ya,1z1,14oj;3,212,21a,1y8,1z9,o9f;1,1ub,1uv,1pv,1rs,ysb;1,1pg,1rt,1pe,1rm,unf;1,1sd,1sn,1qr,1rn,m3n;1,1qg,1ry,1pq,1qf,lpr;3,1pc,1pv,1md,1nq,p7b;1,1mx,1pm,1mc,1pf,hs3;1,1rn,1rn,1pf,1pu,3o5a;1,1pi,1rw,1p9,1r5,46v6;1,1rm,1tx,1pj,1r9,18ez;3,1ri,1s4,1oq,1ow,3w7u;1,1nb,1o5,1mg,1ms,3oxm;1,1o8,1p2,1n2,1o8,3gbm;1,1p6,1ri,1o9,1oa,33pq;1,1om,1qh,1o8,1q5,2jcy;3,1sj,1tk,1r2,1su,lhz;1,1tc,1tw,1s5,1sy,ujj;1,1tr,1un,1t1,1tb,ua3;1,1u7,1u7,1s8,1tk,13pj;1,1r7,1ui,1qs,1tg,qt3;3,1tp,1tx,1rd,1s0,37z2;1,1rz,1td,1qb,1s4,3yfa;1,1tb,1vc,1t3,1uj,m33;1,1v4,1w7,1qe,1ra,t13;1,1r3,1t2,1qb,1ry,3iuq;3,1sa,1u0,1s6,1tm,14vr;1,1tx,1uc,1sn,1sy,j27;1,1u4,1vi,1t2,1vg,id7;2,1wf,1xd,1vw,1wu,lgb;3,1yf,1z4,1wy,1y2,qvb;1,1xr,1yb,1v5,1xj,3vh6;1,1yk,1ze,1xq,1y0,m0v;1,1xa,1yo,1wy,1yb,26m2;1,1z3,203,1x5,1y5,3ml6;3,1xv,1y8,1wf,1x4,46lq;1,1x3,223,1x3,21h,krb;1,213,234,20g,22j,kqr;1,241,267,22o,256,1cyv;1,27r,280,24p,268,r6f;3,27m,289,23t,24z,ndr;1,25t,288,24t,263,mdn;1,275,27v,25p,263,kkn;1,25s,27o,24z,26h,ocr;1,25j,27u,25j,26r,31ef;3,299,2b0,27v,28w,mdn;1,29t,2ak,28w,2ah,18ez;1,2az,2az,293,29z,1fmy;2,2bc,2bj,29s,2a3,lhf;3,26y,27b,258,262,lvb;1,27f,28f,265,276,3mde;1,26d,27x,24m,25b,1nof;2,26u,281,24y,27f,iwn;3,29l,2bt,29a,2a1,16kb;1,2ay,2cj,2a8,2bq,1417;1,29o,2de,292,2de,qwf;1,2bc,2ev,2b0,2ep,ghz;1,2fi,2hi,2el,2hg,3dhy;3,2l1,2nv,2kd,2nl,k6r;1,2ok,2qf,2mu,2ne,q8j;1,2pr,2q3,2kt,2mg,hin;1,2lc,2p9,2lc,2oy,3ckm;1,2nm,2p9,2ld,2oc,3wsy;4,2rx,2wg,2qy,2wf,13ib;1,2yl,2zq,2tr,2uv,152f;1,2up,2w2,2te,2tf,o6n;1,2v5,2w6,2u7,2v2,mlz;3,31f,36p,2zs,30q,yaj;1,30j,31j,2vt,2y1,11hj;1,314,32q,2xe,30d,suf;1,364,368,2vv,2z1,z3f;1,2rl,2u3,2kv,2n6,1jzn;3,2lv,2ou,2j3,2mm,rx3;1,2tb,2uw,2ps,2tn,ytz;1,2vk,2vk,2pn,2tj,me7;1,2nz,2qf,2n3,2p8,p5n;1,2rd,2ws,2r0,2un,lbb;3,2wl,31g,2wl,30o,le3;1,2zn,318,2yk,30d,3vui;1,34l,353,303,34g,kyj;1,338,33w,2w4,2wa,fvr;1,2xb,2za,2v0,2xg,3rny;4,2t9,2xd,2qj,2vq,mqf;1,2y8,316,2wk,2wz,m7j;1,2vm,2zk,2us,2ya,2t1a;1,2ww,306,2wj,2yp,11or;3,30o,30o,2x0,2zc,g8j;1,2wg,31l,2wg,301,ir3;1,31y,36g,30m,335,u7v;1,319,36k,30o,369,unz;1,398,3g3,390,3db,1bab;3,3e4,3ea,36f,3ay,11t7;1,32t,32u,2v7,2zq,14df;1,31x,31z,2xk,31a,ov3;1,2yv,2z5,2sg,2vi,k53;1,2t8,2wt,2qf,2uv,jxb;3,2sy,2wf,2qu,2w7,pyj;1,2y7,32b,2wr,302,g5r;1,2xv,2yz,2ub,2yo,fsz;1,2xn,2yi,2t1,2u5,fsz;1,2tr,2tt,2p2,2py,190n;3,2qc,2to,2p6,2s9,fwv;1,2sx,2tu,2re,2so,360i;1,2ox,2qp,2lt,2mm,11lf;1,2f8,2hh,2cy,2gl,1827;1,2gl,2gm,2bc,2c5,2b7n;3,2d1,2j4,2c7,2g4,jqn;1,2f0,2hp,2d7,2hb,2xmu;1,2lc,2m2,2j2,2jo,kzn;1,2g2,2j4,2fo,2i6,180j;1,2hu,2ns,2h2,2l5,wbz;3,2n0,2nl,2jm,2mc,p4j;1,2or,2se,2nx,2s4,jnv;1,2uj,2xt,2sn,2va,49x6;1,2qc,2vn,2ow,2t5,3rse;4,2t6,2uo,2r0,2sr,297y;1,2ss,2ss,2of,2sj,3h0m;1,2y7,2y7,2v2,2xr,pan;1,2yv,30b,2v5,2yr,43ge;1,2zw,314,2v6,2wx,iaz;3,2v1,2xb,2ty,2x5,her;1,2xw,30i,2vr,2w8,j3v;1,2v8,2vu,2p8,2q8,t8b;1,2r1,2th,2qy,2si,45ey;1,2un,2wo,2r0,2ra,pyj;3,2px,2q5,2nt,2pg,jez;1,2lt,2mc,2fw,2g8,uan;1,2hw,2ik,2g2,2ge,mvz;1,2ef,2gs,2dv,2gs,t63;1,2hl,2j0,2ez,2j0,mor;3,2jo,2l8,2hb,2ie,r3n;1,2h6,2ix,2cm,2ee,11qf;1,2d6,2dc,2b0,2be,rin;1,2en,2ix,2ce,2ij,1dwr;1,2hh,2iy,2fq,2i4,34s2;3,2hf,2hp,2ex,2fl,29p6;1,2hc,2j1,2fz,2gu,hnn;1,2kh,2nn,2jz,2ml,hdn;1,2oo,2rd,2m3,2m9,w3n;1,2o5,2ra,2n6,2q8,3bia;3,2rm,2x6,2rl,2wv,i4b;1,2ue,2y3,2t3,2xt,og3;1,2wy,2zd,2w2,2yv,3dcy;1,2xt,2yy,2ue,2v7,lvv;1,2qw,2qz,2mg,2n9,wy7;3,2nu,2ow,2m6,2mh,2u32;1,2kh,2kv,2h8,2jb,fk3;1,2kl,2mp,2iv,2m5,48y6;1,2l2,2o3,2k0,2ln,2w4e;1,2lq,2na,2jj,2ky,3iz6;4,2nj,2q5,2m7,2ph,3anq;1,2n4,2p5,2mh,2o7,2a8m;1,2n1,2qw,2lv,2p9,2k3m;1,2pb,2vb,2oy,2uh,zbr;3,2rl,2sh,2o0,2pn,jtz;1,2q2,2rl,2no,2on,iqj;1,2mv,2nu,2l0,2m2,3hiy;1,2mq,2ph,2m7,2n7,n8r;1,2jy,2ku,2bs,2c2,fnf;3,2cq,2cz,298,2bz,qen;1,2fm,2kn,2c3,2e3,o3b;1,2d8,2dr,2as,2d8,ttz;1,2dg,2jf,2d1,2j0,h1f;1,2ki,2me,2iz,2ku,348m;3,2q3,2r6,2ms,2ou,mfv;1,2ph,2s9,2o7,2rw,lj3;1,2rf,2ua,2mu,2n4,y63;1,2nu,2pd,2h9,2ii,29dj;4,2gw,2j3,2g8,2i1,1y8y;1,2ds,2fs,2d3,2e4,i4v;1,2b4,2ct,29p,2an,i3r;1,2cl,2es,2ar,2d8,pb7;1,2db,2gg,2br,2ci,392i;3,2b8,2b8,278,27e,2rrq;1,289,2a4,271,29d,44dq;1,28m,2a8,27s,294,u0n;1,2bf,2df,29h,2ak,j9z;4,2bt,2cl,2ac,2b8,2i52;1,2b7,2ba,27b,28b,2sa2;1,264,27f,23v,26s,31fi;1,281,2as,27a,2a3,2ztq;1,29h,2ca,29a,2bc,1xqm;3,2a0,2bl,29g,2au,g1v;1,2ef,2fl,2cy,2e7,40qm;1,2dq,2f5,2bm,2db,43pa;1,2cx,2cx,29r,2bt,3ydm;1,29z,2cp,299,2c0,tl3;3,2ck,2cw,29o,2bi,gon;1,2de,2fh,2aj,2et,3bbm;1,2gg,2j4,2fy,2h5,fv7;1,2ev,2gj,2e0,2f0,210y;1,2f5,2gg,2dt,2dv,2pau;3,2eq,2gu,2d5,2g4,1f2y;1,2e9,2fd,2bg,2ce,26bi;1,2bv,2eg,291,2by,2i4i;1,2dy,2gw,2ci,2gi,gnj;1,2cq,2ek,2bt,2c4,2q0e;3,2c6,2d4,2ae,2cn,2xcu;1,2fk,2hy,2ey,2hm,403a;1,2ll,2mn,2ia,2jo,huv;1,2ig,2ky,2h1,2ig,3odm;1,2n2,2pn,2la,2mv,m1z;3,2m7,2ok,2lj,2o2,41k2;1,2nw,2pw,2mw,2oo,268q;1,2qy,2r6,2nd,2o4,2lxq;1,2p2,2p9,2lh,2lj,2f8m;1,2mf,2o8,2l3,2lq,2bya;3,2lx,2n3,2ko,2mc,1u5q;1,2l1,2m5,2je,2k8,2dv6;1,2no,2pc,2l2,2me,q6v;1,2l8,2pq,2kn,2mw,m8n;1,2q8,2r8,2mo,2qj,1maz;3,2s0,2ti,2pb,2ps,oaj;1,2oa,2sd,2nb,2ru,2li6;1,2pr,2ue,2pr,2si,we7;1,2sj,2uc,2r3,2su,llb;1,2sz,2um,2om,2pk,l57;3,2py,2py,2n0,2na,vt3;1,2le,2oi,2kg,2ku,3j0a;1,2nh,2p1,2ks,2n1,412a;1,2pp,2pp,2nw,2ol,2bc2;1,2mj,2ng,2ke,2m6,1pem;4,2mi,2p8,2ma,2mw,fu3;1,2om,2rk,2ob,2qb,mfv;1,2mq,2ol,2lm,2m1,3n6u;1,2o5,2q7,2lu,2mk,3m16;3,2jw,2ko,2ib,2k8,ii7;1,2kc,2kw,2ie,2kc,3yn2;1,2mq,2mx,2hk,2jv,j9z;1,2mm,2p4,2kt,2of,36h6;1,2ov,2ov,2m4,2nd,1ngn;3,2nf,2nf,2ju,2lb,3exm;1,2ld,2oy,2lb,2oe,irn;1,2lu,2oe,2j4,2ku,iqj;1,2la,2la,2h3,2j9,i37;1,2jh,2kc,2i7,2k5,1wd6;3,2fy,2hi,2f2,2h1,me7;1,2h8,2h8,2fj,2gv,ix7;1,2hc,2ia,2eq,2fq,kpn;1,2et,2gg,2dx,2fh,46xe;1,2gn,2hl,2ep,2f7,3hq6;3,2f8,2ge,2dc,2fr,27xu;1,2fb,2hg,2eg,2gq,32oi;1,2f4,2fl,2du,2eh,oxb;1,2dw,2fw,2ah,2fb,s2n;1,2gw,2iq,2gc,2i6,2hsa;3,2ho,2ih,2h8,2hq,1fmy' },
  { name: 'NOW D vcp', tf: 'D', id: 'vcp', old: 83, why: '2 contractions in 12 sessions (< 3 weeks): a flag, not a VCP — and its "breakout" was 0.34% below the pivot', bars: 'fj5,-2|0,fpb,fxy,flt,fro,2inz;1,fnw,frf,fhr,fkl,26eb;1,fdh,feo,f4g,f5s,3lg3;1,f5s,fb4,ez6,f9q,3cmv;1,f3y,f9g,ex0,f85,3807;4,f8w,fe7,f14,fe6,3l2r;1,fe2,fh5,f21,f8f,3q1n;1,f4i,f4s,esp,exs,2w9f;1,evy,ex8,eec,ehc,fgs;3,ekh,ekq,e3j,ebc,3mmb;1,e96,eat,dv0,e8e,gjo;1,eca,ep8,eag,ejb,fg8;1,emr,epn,e6x,e7n,34ab;1,e7n,eco,e05,ecj,3czn;3,eg0,eho,dxi,e1q,3baj;1,dw0,e5n,dj7,dze,izg;1,dys,e9c,dv4,e4s,3auz;1,dqg,e0e,d8t,ddq,gp8;1,d7u,dfc,cum,d4l,jic;3,cpg,cu8,c06,c3h,u2w;1,ccg,cs0,c94,ch4,n5g;1,cvs,d3t,cph,d0f,l5s;1,ct4,cvw,cfs,ciw,47ij;1,cp3,d3p,cp3,d13,3yzv;3,cy4,d7e,cvw,d0b,3jub;1,cx9,cx9,cnr,ct4,3sf7;1,cwb,d6g,ct4,d0y,3cif;1,crl,cs5,chk,cpu,k0o;1,clf,csi,chc,crv,mfw;3,d20,d66,czc,d43,3fff;1,d8t,dfw,d70,dak,3isj;1,d7r,da2,cvd,cxv,2w27;1,cvx,cyn,cor,crv,3677;1,cnk,co4,c6n,cb7,3rp3;3,c26,cbw,bp1,cab,n10;1,cbg,cjn,c8f,civ,3b27;1,c9i,crj,c9i,cpt,3hhv;1,c2v,c5t,bop,by1,g44;1,bo7,bpj,b35,b4x,mdo;3,am8,bph,ah1,bcm,m7k;1,buo,bz2,b08,b88,ge4;1,b6s,cu1,b5s,cqv,nv0;1,cge,ci0,bqu,c3a,fsg;1,bwi,c56,bng,c4h,g8k;3,cdo,cj7,c54,ccc,3ohj;1,ccz,cqa,cc0,clm,3pw3;1,cf0,co7,c7b,cal,409f;1,cch,cch,bv8,bwz,3v77;4,bpv,btb,bgg,bo0,3krn;1,brs,bzh,bm1,bu1,3e4r;1,co5,cvb,cgc,cji,nb0;1,dw6,ekg,dv3,ehf,1ay4;1,ekg,etc,ec7,el5,mac;3,et9,etx,eb3,egs,fu4;1,ei8,em9,ecz,ejt,2o3j;1,ecz,es1,e7c,eqk,46b7;1,f11,f3o,ery,es7,3vhr;1,f3u,f7i,eyd,f2z,3ktb;3,f0k,fb4,ezn,f3d,2qbj;1,eyd,f3q,evo,ew9,2qtb;1,ezk,f8i,exe,f6a,3ph3;1,f78,fb4,f0g,f1e,35c3;1,f4g,f88,ezs,f4h,1z07;3,fka,fp0,fd5,fo8,32if;1,fsc,g1s,fp0,fzy,36g3;1,g04,g54,fud,fug,315j;1,fyo,g25,frr,fz4,248j;1,g0w,g3v,fxz,g1w,2hl3;3,fvn,fyu,foh,ftv,fzo;1,fnw,ft9,fmy,frp,2ay7;1,fki,fwn,fio,fnr,2p6z;1,fnr,fuu,fm4,fob,1u2z;1,ffk,fni,fck,fhz,2z47;4,fn4,fw5,fms,fus,2d2v;1,fus,g0h,fpo,fre,24nj;1,fsf,ft8,fi6,fo1,2por;1,fqo,fqo,fh0,flq,kk4;3,fkn,fpj,ffq,fma,25d3;1,fm4,fol,fim,flm,26zz;1,flz,fpb,fh7,fmn,1jdz;1,fuq,fx1,fnf,fpc,1xmr;1,fu5,fys,fon,fwc,2227;3,fws,fyq,fpl,fuh,1y1r;1,frb,fuh,ff2,fl0,2jrf;1,fl9,fpe,fgc,fhz,1lbf;1,fh0,foh,fh0,fjn,1tg7;1,feh,fg4,f3g,f99,2usn;3,fb4,foz,fas,fif,2mzj;1,fhp,fm8,ff7,fia,1r9b;1,fi1,fjh,f40,f5m,2lc3;2,f7k,f7s,ewd,ezo,fhw;3,ezo,f57,erl,f4o,2cvn;1,fa0,ffa,f78,fdi,38tn;1,fem,fnc,fej,fif,2k47;1,fjk,fn3,fci,flx,2kxn;1,fmo,fxx,fm9,fs0,38ur;3,fw3,fzr,fpt,fv6,25vz;1,fup,fxb,fcn,fm6,2o07;1,ffr,flp,fb4,fkz,1v8n;1,fpf,gbg,fnw,g4e,2l23;4,g3l,g6s,fuw,fz0,2fgz;1,g08,g13,flt,fsc,34o7;1,ft6,fv4,fkk,fn6,2gzz;1,fn6,fn6,ewa,exu,fgs;1,etc,ewo,eez,ehk,gmg;3,ehi,evr,efj,euc,3vv3;1,ew9,f1b,er4,erm,2pkb;1,ew5,eye,epo,ex7,240r;1,ey2,f1o,eqk,esv,2qff;1,es9,eva,enn,ev8,2h63;3,et3,eye,es8,eta,2dv7;1,evg,f13,erl,eun,2iq7;1,eml,ex5,eml,erd,4937;1,fyt,g7w,f5k,fdg,veo;1,ffm,fg4,evm,ey8,4aaj;3,f28,fdd,f28,f7n,35s7;1,fav,fir,f5q,fbs,2l73;1,faw,fbp,f0k,f32,2cfj;1,f5k,f5k,ei9,ejy,ggc;1,egq,egq,e1a,e3z,3vr7;3,e6a,ecg,e4h,e8s,2r77;1,e88,ea6,dyh,dyu,33rz;1,e2g,e39,dxl,e2u,2agf;1,e88,e8q,daw,dhm,llc;1,dk0,dm0,daz,dgq,42tn;3,de6,dkw,d4q,d7r,iag;1,d8k,d9n,cyp,d65,m48;1,da3,dc8,d06,dbm,ixs;1,d7n,dbg,d27,d4p,3tyr;1,d57,de7,d3g,ddt,3rpn;3,ddd,drp,dcr,drl,jw8;1,dsc,dwi,dlf,doo,gus;1,dn9,dve,dkw,dql,485v;1,do7,dpk,dh1,dj7,2eyn;1,djz,du0,dh0,don,2bob;3,dqa,dqj,dk6,dkv,1ugb;1,dkc,dkw,d72,dcd,kpo;1,dg9,dq8,dec,dpc,2krj;1,dqq,efw,dqb,ebw,nho;1,ec9,eew,e1e,e5p,417b;4,dwz,e3x,dt1,e2c,2oa7;1,e10,e7v,dsy,e6s,2v9b;1,e1a,e1p,djw,dv7,3nhf;1,dyb,e50,dwr,e3o,2r2r;3,e4f,ekw,e2z,ehv,3i93;1,el0,el0,ebg,eep,2ker;1,eg0,eky,e6r,e93,3j7j;1,ebe,ejp,e95,eha,2iif;1,ej7,ej9,eaz,ec3,1ivn;3,ecx,er7,ecj,emc,3bb3;1,eim,elt,ebt,eds,2scb;1,egf,epv,eeh,enz,2r4f;1,erf,euh,eii,emj,372b;1,eot,ewj,ens,etz,lo4;3,epy,erj,ed6,emk,2l7n;1,emf,eo2,eap,ebd,30kf;1,eut,f0x,eda,eej,fls;1,eb9,ebo,e1t,e6c,2jqv;1,e6y,eh7,e5a,eg0,1ws7;3,ejd,eqb,eht,eip,26xr;1,ehq,ej5,dyi,e7a,317r;1,e7n,efg,drp,e2x,3x7f;1,e2h,e4d,dtj,e1m,38nj;1,e3l,e6y,e0n,e2v,2i03;3,dy8,ecj,dtj,e35,2rdb;1,e3s,e4s,dsb,dyd,2k7j;1,e1k,e7b,e03,e3y,2c5j;1,dy6,e6x,dsj,e5z,287b;1,e74,ebk,doy,dpq,30c3;3,dud,eab,drx,e96,2jgb;1,e03,e9h,duj,e29,1vtr;1,e60,e8a,dvu,dxp,1mwn;1,e3r,ec4,dpd,dsy,2b7n;1,dqg,dzn,dpb,dy0,1stz;3,dzp,e88,dzj,e5r,2aor;1,e5q,ekp,e1q,ej2,2p7j;1,ej8,emo,ebi,eft,2lpz;1,edc,eks,ebk,ehr,1t6r;1,elf,ens,ec2,ecr,2an3;3,ekh,eoq,egk,elq,2gi7;1,ene,eoc,eh2,eh2,20x3;1,ef7,ef7,e1m,e2i,kq8;1,eav,ew1,dub,efa,ngk;1,ek0,emh,dxu,e6q,ibk;3,e8b,e8b,do8,e3p,3qrr;1,dw0,e0t,diz,dp3,462v;1,drd,drw,dgm,dkp,39cj;1,dhz,dkc,d48,d93,fsg;1,d4z,dbi,cyz,dat,3hz3;3,dbx,dek,d4v,dda,30pz;1,dbp,dfp,d9f,da5,27w7;1,dem,dfc,d3r,dc1,39cj;1,d5k,dbg,d0w,d42,3hq7;1,czs,dcq,cy5,d4h,2jbv;3,d2i,d66,cs4,cwc,2fzb;1,cri,cvw,ciw,cmf,39x3;1,clp,co7,cgn,cll,43sn;1,cte,cu2,cay,ccp,3gxv;1,cdq,cnc,c9o,cjx,35hn;3,cjw,cna,cek,cl9,3u2n;1,cjb,ctm,cik,cqi,34cj;1,cm1,coo,ccd,cdy,fhw;2,cgw,ck8,cf8,cjc,1xrr;3,cdd,cqx,cbw,cop,2z0b;1,csc,cv1,cps,cq0,2t3j;1,coo,cus,cjx,cuq,1zar;1,cz8,d2a,cti,cy1,2dmv;1,cz5,dam,cxk,d6n,2rw7;3,d6l,dgg,d4h,d66,3bgn;1,d5o,dac,d3o,d6y,23jj;1,d4j,dap,d1r,d67,3mkn;1,d5w,di4,d4u,ddy,30lj;1,ddw,dhx,d8m,dcl,37nz;3,cbc,cec,bqj,bt4,19q8;1,by9,c4p,bvj,c1y,pq8;1,c44,cht,c25,c2o,i60;1,c2r,c6a,bnv,bu2,44tv;1,bsx,c1s,brq,bzf,12zg;3,c3q,c4k,btf,c38,h5w;1,bzy,c1l,bp7,bws,jeg;1,bue,bvm,bq9,brv,1o53;2,brm,bx4,bqt,bvh,2c4f;3,bt7,c0h,bsf,bxe,32gr;1,bvd,bxp,btp,bwf,26vj;1,bvr,bxa,bs4,btj,2943;2,bt8,btk,b8k,bdl,48qf;3,baz,bk5,b8z,be0,4833;1,bdi,bjh,bbi,bhd,2r77;1,bf4,bqj,bef,bn6,2nmb;1,bki,bli,ba2,ba3,36ln;1,bdb,bdb,awv,axw,iag;3,axg,b3d,aw3,b08,48s3;1,ayu,b5y,al2,anv,jws;1,aln,anv,a8d,adx,o5k;1,aff,aig,a0x,a4d,mi4;1,a0a,a4v,9sd,9tn,uy0;4,9rl,9xq,9nb,9oc,uf4;1,9vk,9vl,9ju,9o2,ovo;1,9q0,9xl,9ni,9x4,jz0;1,9xd,abt,9w7,a9r,pmw;3,adr,ajj,aa7,aiq,qzs;1,ahb,ahv,a3i,a64,i7o;1,a7f,abb,9yq,a02,wso;1,959,96g,8q9,909,2d2w;1,92i,963,8xx,911,17ag;3,960,9dz,8z7,93s,t5k;1,8vi,8xx,8ca,8gx,1hlk;1,89r,8kr,84d,8kj,1ko4;1,8fi,8nd,7ul,7x3,1ju4;1,7ug,80w,7mu,7ru,1hlk;3,7ps,81l,7k8,80j,zp4;1,83n,8eq,83e,87s,xr4;1,85a,86a,7o6,7re,1490;1,7v4,803,7nr,7yx,15zs;1,843,8b5,82j,89g,z54;4,8gc,8jx,80k,867,1670;1,869,8cq,7z8,8bh,rzw;1,8c7,8fe,86z,8a9,kek;1,86g,8bg,80e,81n,o8c;3,7v6,7v6,7ni,7s0,11ck;1,7sg,85m,7r7,7wp,sho;1,7ub,82x,7q8,81j,nwo;1,8ah,8hz,881,8fm,1508;1,83o,8dy,80w,8c1,tgo;3,86e,8kk,83y,8fy,mt8;1,8c0,8v8,8an,8qf,r6g;1,8nf,8w1,8lq,8sa,qwg;1,8ut,9f4,8t1,9ae,1508;1,9aq,9ma,99u,9le,142w;3,9hu,9rv,9cx,9ep,vd0;1,9c3,9db,8ui,8zx,xr4;1,924,963,8rk,8x7,mio;1,8w8,91l,8oa,8pt,sco;1,8pd,8xz,8mb,8rm,mx4;3,90q,91k,8s4,8v4,iyw;1,8wk,96j,8t8,908,kmw;1,8vg,928,8rd,8rv,fk4;1,8t6,919,8mz,8qn,hj8;1,8l6,8nj,8f4,8im,t3w;3,8jo,8ql,8h9,8k7,iv0;1,8f6,8fh,81s,82p,rj8;1,87u,88w,7sy,7ya,mqg;1,7wi,860,7s8,7zw,hwk;1,7x4,7x7,7l6,7o5,ry8;3,7py,86f,7oe,83l,sug;1,856,882,812,82f,pyk;1,84b,866,7vd,810,j78;1,7ur,7z9,7li,7vc,po0;4,7y1,7z1,7qw,7wi,3x2f;1,7xh,80s,7oe,7rb,ijc;1,830,85a,7hc,7ir,uk4;1,7g2,7hw,6ua,6xh,1t0o;1,6uz,6uz,69o,6ek,2imc;3,6jh,6vw,6hu,6ve,1cw4;1,702,74o,6q0,6rv,12s8;1,6yk,7bf,6vs,79n,13vo;1,7j5,7o3,7cx,7fw,xwo;1,7k3,7mi,7f1,7gi,re8;3,7io,7rn,7gx,7p0,vcg;1,7qr,82a,7n6,7q6,119s;1,7ty,81r,7sn,7yb,1j40;1,6qd,6y2,6g6,6ji,3lsc;1,6ma,6z3,6jx,6yh,1o7c;3,6ve,797,6rx,6z9,1els;1,712,76c,6yd,6zd,we8;1,6ve,6w2,6py,6ux,ss8;1,6sb,6uf,6mk,6tb,y6o;1,70l,758,6s3,718,zcw;3,71j,7dm,712,73h,xqk;1,749,761,6vm,73l,z4k;1,72g,72o,6t1,6vd,zok;1,741,7dg,739,77z,175g;1,715,735,6v7,71a,124c;3,70w,7b7,6zb,725,x10;1,74v,75p,6ud,6v8,yhs;1,6u2,6u2,6mx,6pt,y4g;1,6qk,73k,6lc,6ze,13go;1,73t,7gj,73h,7c3,1hco;3,7mm,82s,7jt,7za,271o;1,8hy,8jv,7rx,7uv,2du4;1,7rv,7z3,7iu,7yy,1ad0;1,7sj,7u7,7kj,7ox,14uo;1,7vu,82j,7o7,7vp,10i0;4,7rc,7wu,7m8,7pk,10eo;1,7nl,84s,7lr,7vo,186o;1,898,8i0,82k,8e1,1odg;1,954,9mi,8z1,9lh,2xb8;3,ah5,aqo,a5l,ahe,2y5s;1,a0u,a8q,9ks,9ul,1rug;1,9vj,9vs,91y,93i,1gys;1,9eq,9mo,97k,97k,17fg;1,973,9co,8lw,8od,1cjc;3,8m9,8wg,8kw,8t7,ugs;1,8if,8o7,7yc,895,1ja4;1,84g,8h0,82x,86m,uy0;1,7y7,840,7th,7yc,17pg;1,7z6,7zd,7le,7vr,147c;3,834,89q,7z3,81b,zj0;1,7xu,85i,7t4,7th,qjo;1,7ro,7xt,7c5,7d8,1dnc;1,7cr,7fc,74t,7c0,1k30;4,776,7io,724,76d,12ho;1,7ca,7iu,7at,7ei,1e90;1,794,7hf,77i,78k,qmg;1,72q,73q,6wb,6wo,10n0;1,6z8,7ms,6y0,7l6,165c;3,7r4,7yp,7ob,7pp,12m4;1,7ib,7os,7hb,7ns,tzk;1,7zs,88d,7up,85w,14u4;1,872,8b4,80g,87c,v80;4,816,8jc,7z2,8bt,phw;1,8lv,8s3,8ew,8jl,yh8;1,871,8d8,84s,8be,n9c;1,7vf,8fh,7tz,8ec,lz8;1,8l3,8lq,85n,8b7,h4s;3,8g6,8pz,8b1,8l2,pmw;1,806,8bw,7x1,839,ztk;1,87u,8e3,81t,82x,l9o;1,83i,862,7nv,80x,vd0;1,7xs,85z,7x4,7ys,p0o;3,7r8,84l,7lf,82u,vps;1,7ud,82i,7sp,7vi,tkk;1,7s7,7t0,7b6,7d6,1vac;1,7pt,7qh,729,73e,23mc;1,7bo,7mt,7bj,7me,19q8;3,7uz,8cf,7qr,858,1e7c;1,88w,8nw,87u,8ja,1fz8;1,8iq,94s,8g6,8xk,1qfc;1,8iy,8q8,87i,8hr,19xg;1,8de,8o7,86l,8kz,voo;3,8u3,98c,8ru,8t7,11uc;1,8or,94p,8n4,946,txw;1,992,99c,8xf,91m,o2s;1,8pw,926,8mk,91z,p4k;1,9dz,9qf,9c0,9mw,1580;3,9mg,9v9,9ig,9u0,qks;1,9qq,9y9,9no,9ua,krw;1,9jg,9p0,9eh,9n2,jiw;1,9ow,a0f,9dx,9th,zok;1,9uq,9xd,9fd,9kg,n74;3,9g3,9io,92n,92y,v6c;1,97w,9eg,93c,97x,qrg;1,95k,a00,957,9tc,yq4;1,9vz,a4b,9t2,a0f,q5s;1,a1x,a4e,9u3,9ww,jak;3,9vq,a1j,9uf,9vp,3u3r;1,9pw,a0l,9nx,9ss,j0k;1,9ft,9rk,9ek,9pg,kng;1,a2g,ar0,a1t,aoj,16xo;1,aoo,b8s,ams,b5z,18sw;3,ayo,bjk,axl,bf3,1454;1,b5j,bc8,aym,b0y,q4o;1,atq,b04,aiu,ajs,mkc;1,avn,bca,av5,b8f,s1k;1,b24,b7i,apk,awe,jb4;4,ajs,aki,a7y,act,mjs;1,ab2,adw,a3h,a47,ggw;1,a2w,ae6,a2w,a4d,ldk;1,a2i,adh,a27,a85,gk8;3,asw,b1r,al8,azf,r0c;1,aqj,bdx,aq4,ay6,mos;1,aqo,axj,ao9,ase,483n;1,aqb,aue,ahs,aon,484r;1,as3,asq,af7,agb,tpk;3,ak2,atc,agq,amg,gt4;1,axz,ayq,afn,akk,jf0;1,al6,ax6,ai7,av2,hjs;1,asm,avs,am1,amq,43tr;1,al9,asf,ago,agq,3j5v;3,a0k,a6d,9s3,a55,ifg;1,a3f,a7w,9vw,a0y,fk4;1,a0f,af8,9xx,ac9,3vef;1,aq9,av4,aed,amo,frw;1,ara,arp,aar,ada,3sqb;3,afm,an2,acn,ai0,3cxf;1,aom,auk,aia,an9,4293;1,ari,av4,alx,amz,3fxr;1,aqt,azv,agm,as7,i9c;1,awe,azr,arb,ava,2p1f;3,b8a,bfi,as8,ats,44nr' },
  { name: 'EDIT D inverse_hs', tf: 'D', id: 'inverse_hs', old: 83, why: 'a 16-session inverse H&S whose left shoulder (2.67, 23 Sep) is not a turning point (2.54 the next session); "broke out" while 1.3% below the neckline', bars: 'fj5,-3|0,yq,z5,xc,xc,n73;1,xc,xm,v4,ws,t13;1,wi,xw,vy,x2,lnj;1,xc,yq,wi,y6,hgf;1,yg,154,yg,12c,3u3r;4,136,1cw,136,1cc,48gf;1,1fo,2jo,1d6,2gw,24zs;1,262,27g,1k4,1l8,pj0;1,1uo,1uo,1gi,1hc,424n;3,1gi,1nv,1cm,1ju,3air;1,1hc,1j0,1e0,1fo,1bhj;1,1gi,1i6,1ek,1f4,qxj;1,1ez,1rm,1e0,1eu,3can;1,1dg,1hc,1bs,1hc,1lj7;3,1iq,1iq,1cr,1d6,11wj;1,1c2,1ea,19u,1cw,17w3;1,1fe,1qi,1ef,1ky,3xgb;1,1hm,1k4,1bj,1dg,1qav;1,1d6,1et,1af,1bs,tjf;3,1a4,1ay,168,17c,1c37;1,17m,17w,11s,14u,19sf;1,15e,16s,136,15y,r7j;1,15o,17c,11s,122,vwf;1,13q,15o,12w,14k,pv7;3,13q,140,10e,136,170z;1,136,140,10e,10j,nzz;1,10y,136,10o,12m,joz;1,12c,13g,10y,122,mvz;1,104,10y,z0,10e,18uj;3,11i,12m,10e,12m,ve3;1,12c,12m,zk,104,l9n;1,10e,10e,yg,za,kzn;1,zk,10o,z0,104,kz3;1,10e,10f,yg,yq,hvz;3,yg,yg,vy,w8,wrj;1,vy,ws,v4,ve,wub;1,vo,y1,v4,ws,rtr;1,ve,vv,uu,v4,ufn;1,uu,vy,sc,sm,1caf;3,s2,t6,pa,rs,22jf;1,sw,tq,qj,r8,15ur;1,r8,ws,qe,vy,17lj;1,ve,ve,sw,uu,nkf;1,uk,104,u0,104,1cc3;3,10y,10y,ws,10o,uhv;1,104,14a,104,11i,sir;1,118,118,yq,za,juj;1,zk,10a,yq,zk,36qm;4,z0,12w,y6,10y,ro7;1,12c,17r,127,17c,1ijz;1,19a,1ay,16s,17c,wkv;1,172,190,15g,18q,hi3;1,18g,18q,15j,16s,glv;3,17m,1bi,16i,17w,tsb;1,17m,19a,15y,172,gp7;1,168,19z,14a,19u,naz;1,1a4,1a4,17h,190,gwf;1,18g,1c2,18g,19k,sxr;3,190,19t,16i,16s,3esm;1,16i,16s,10o,10y,rbf;1,12c,12w,10e,10y,u2v;1,10y,15e,zu,12m,u2b;1,13g,16i,136,14a,14yj;3,172,1d1,14x,16s,1fjn;1,172,17w,13q,15o,16zb;1,15y,15y,11i,12c,sxr;1,12w,13q,11s,12r,45oy;1,136,15y,11d,15y,ovn;3,15e,16s,13q,15e,gj3;1,15e,1ae,14z,19k,10qb;1,186,199,14w,15o,ppn;1,159,195,159,190,lfr;1,16s,186,15y,172,430u;4,186,1dl,17h,19u,12xr;1,1a4,1gs,18g,1fy,167j;1,1gi,1i6,1d1,1eu,nzf;1,1e0,1ea,1b8,1bs,joz;3,1cw,1hc,1cm,1d6,xfz;1,1cm,1fy,1a4,1ek,plr;1,1ek,1fe,1d6,1ek,3pnq;1,1e0,1j0,1c2,1e0,1d0j;1,1ea,1iq,1e0,1h2,11tr;3,1j0,1k4,1f9,1hm,iuz;1,1j0,1py,1hc,1mc,18g3;1,1mc,1ou,1jx,1ke,v2f;1,1ky,1rr,1ir,1ok,1dgn;1,1k4,1mr,1hw,1iq,1b3n;3,1jp,1p4,1hr,1o0,17pz;1,1s6,1yu,1mc,1ng,2c8v;1,1oa,1u4,1ky,1ta,1jcv;2,1t0,1u9,1nq,1po,1bd3;3,1op,1q8,1k4,1mc,rlf;1,1nq,1s6,1nq,1qi,1ajn;1,1qs,1rm,1ng,1ou,yyf;1,1po,1po,1ln,1mw,zsf;1,1nq,1sq,1n6,1rc,2cb3;3,1rc,1tu,1ou,1p4,ytf;1,1o0,1s6,1mm,1qi,r0b;1,1qi,27v,1q3,1z4,43nn;1,212,24e,1xq,1ze,tjz;4,1zo,20z,1ww,1yk,x23;1,1yu,2da,1yf,27g,2fzv;1,2cq,2i0,28z,2dk,2eij;1,2ej,2gc,2b2,2d0,13hr;1,2d0,2du,25s,280,ysb;3,26w,2ad,244,276,jkj;1,280,2a8,23p,24e,o0j;1,25i,2bw,230,26w,13iv;1,26w,28a,230,23u,sjb;1,230,27q,21w,24o,135j;3,25d,2m6,25d,2fi,2gxr;1,2eo,2n0,2c7,2lc,14df;1,2oe,2q7,2j4,2o4,1237;1,2o4,2rg,2gc,2ik,151v;1,2j4,2j4,2e4,2fi,jof;3,2fs,2gm,29o,2a8,rxn;1,2an,2b2,1yp,1zy,1myb;1,217,23f,1xg,1y0,zq7;1,1x6,1zj,1uo,1xq,wyr;1,1ww,1x6,1tu,1vs,p17;3,1wc,20i,1vs,1z4,ksf;1,212,221,1wm,208,oyz;1,208,212,1wm,1ya,hvz;1,1zo,1zo,1w2,1x6,3qzi;1,1xv,1y0,1p4,1pe,z3z;3,1n6,1po,1li,1p4,p9j;1,1po,1sl,1ok,1rm,jvn;1,1w2,2g2,1vs,2dk,3bl3;1,29e,2e9,28a,2a8,z3z;1,2cq,2e4,26w,2c6,1dcr;3,2dk,2dk,23u,23u,sjv;1,23a,23h,208,212,mpv;1,20s,24y,20s,226,3yza;1,212,24y,212,23u,3n1u;1,244,295,23w,25s,mmj;3,26c,28k,235,23k,fz3;1,23k,24e,21r,23u,2vw2;1,23u,24t,21w,226,2mr6;1,22q,259,21c,21m,38t2;1,21m,22v,1x0,1ze,hpb;4,1y0,21w,1wh,1wm,k67;1,1ya,23k,1x6,1xg,q07;1,1yk,1yk,1ue,1y0,i87;1,1yu,24o,1x6,24o,uu3;3,24y,26w,23k,25i,my7;1,24y,26c,22q,24o,jcr;1,24o,24o,1z4,1z4,o3v;1,1z4,24e,1yz,23a,j0j;1,23k,244,21m,22q,h0b;3,23k,25h,20b,226,hj7;1,226,27v,1yf,26m,13q3;1,262,28k,23a,23k,mlz;1,25i,2dd,25i,2bc,1mbj;1,2cg,2dk,262,26m,19jj;3,26m,2cp,226,2bc,17af;1,2bw,2f8,2ai,2bm,1bs3;1,2bw,2rb,2bc,2lm,2ufb;1,2k8,2lm,2g2,2hq,15k7;1,2h6,2ik,2bm,2i0,1133;3,2je,2ps,2g2,2ps,1raf;1,2p8,2sk,2lc,2oe,13yf;1,2o4,2ux,2nu,2qm,1ikj;1,2r6,30w,2qw,302,25qf;1,32a,34i,2wq,30w,1ffr;3,32k,352,2xa,2xk,12w3;1,2y4,32x,2u8,316,16jr;1,31q,3i1,2yy,37a,2oen;1,38y,3am,33o,35c,160b;1,398,3b6,2un,2vc,1iib;3,2yo,2yo,2q2,2qw,wlz;1,2nk,2vc,2k8,2rq,wlz;1,2u8,37u,2u8,34s,22yz;1,366,3ca,30m,320,153j;1,2z8,32k,2t4,2wq,tdv;3,2xk,3ar,2xk,370,1qqf;1,35w,38y,2z8,2zs,13bn;1,2zi,2zi,2oo,2r6,1fgb;1,2us,2wq,2rb,2te,knf;1,2w6,2zi,2v2,2vc,p3z;3,2qh,2sk,2fd,2ia,2mmr;1,2ik,2je,2ee,2g2,uf3;1,2g2,2gw,2cb,2cg,vhf;1,2bc,2d5,29o,2bm,iaz;1,2bm,2lh,29y,2dk,2qgj;3,2ee,2ee,27q,2d0,vf7;1,29o,2as,24y,258,ooz;1,25i,276,23a,258,ndr;1,24y,25i,20s,22q,z2b;1,1zy,1zy,1sq,1wm,1cpz;3,235,235,1wm,1y0,z9j;1,1zy,226,1v8,21w,rbf;1,230,25s,21m,230,wvz;1,212,21c,1xv,1yk,qvv;1,1wm,22q,1w2,208,rbf;3,1zy,226,1xg,1zo,j3v;1,1z4,21c,1w3,20s,g0r;1,21c,21r,1xq,1y0,ijb;1,20s,23u,1uy,1wm,wer;1,1vs,1wm,1rw,1v8,umb;3,1vs,1yu,1v8,1xg,k7v;1,1y0,1y0,1ta,1ue,ixr;1,1uo,1uy,1sl,1uo,gcf;2,1uo,1uy,1t0,1uy,fnz;3,1tu,1u4,1o0,1ou,pxz;1,1ou,1py,1m2,1mm,tyf;1,1ng,1tu,1mw,1tp,u6r;1,1ta,1x6,1sn,1vi,oaj;1,1w2,1xg,1u4,1v8,kwv;3,1w2,1xo,1tp,1v8,gur;1,1uy,1x2,1tk,1vs,ieb;1,1vi,221,1tk,208,125z;1,20i,230,1w2,1z4,wx3;1,1ze,208,1wh,1ya,z03;3,1yu,1ze,1uo,1vs,rav;1,1wc,1zt,1vd,1xq,ktj;1,1y0,20i,1tf,1tu,tvn;1,1uy,1xq,1sq,1ta,wgf;1,1tu,1wc,1t0,1t0,12af;3,1tk,1vr,1sq,1sq,nh3;1,1s6,1sq,1mw,1ou,133b;1,1oa,1q8,1oa,1pe,30dq;2,1p4,1p4,1n7,1oa,jgn;3,1n6,1nl,1ky,1mc,v07;1,1m2,1n6,1k4,1ko,pnz;1,1ko,1m2,1k4,1ky,qe3;2,1l8,1ls,1iq,1ky,w0b;3,1l8,1mw,1i6,1ja,xyb;1,1ju,1nq,1jf,1ng,10yn;1,1o0,1q8,1n6,1o0,161f;1,1nq,1nq,1li,1ng,j1n;1,1o0,1p4,1l8,1li,ghz;3,1mc,1ng,1ja,1n6,stb;1,1n6,1ni,1kp,1m2,kf3;1,1mm,1r7,1lk,1po,1953;1,1po,1po,1l3,1m2,toz;1,1mc,1mh,1jk,1ke,xzf;4,1ja,1l8,1hd,1k4,qu7;1,1k4,1mw,1k4,1mw,urb;1,1ng,1vi,1mm,1u4,1j1r;1,1u4,1ue,1nq,1o0,ypj;3,1o0,1o0,1ky,1l8,l93;1,1ls,1oa,1l8,1mm,jpj;1,1n6,1nb,1k4,1l8,l4n;1,1ky,1mm,1ju,1l8,kg7;1,1ke,1ld,1hc,1ja,qmz;3,1ja,1li,1i6,1ju,nuf;1,1k4,1mm,1il,1l8,p7v;1,1l8,1ld,1hm,1i6,l1v;1,1hc,1i6,1a4,1a9,yc7;1,1dg,1f9,1c2,1ek,tsb;3,1dq,1eu,1cc,1ea,fu3;1,1ek,1f4,1d6,1dg,iyb;1,1dq,1ea,1b8,1d6,44nq;1,1ea,1ea,1ae,1ao,nx7;1,1b8,1er,1ay,1cw,kiz;4,1cm,1dq,1bd,1cc,2uqy;1,1bs,1cw,1b3,1bs,47uq;1,1bi,1ef,1ae,1ea,mxn;1,1dq,1e0,1bs,1dq,nob;3,1d6,1h2,1cw,1gi,mbz;1,1h2,1rm,1h2,1mm,1joj;1,1nq,1py,1m2,1n6,owr;1,1n6,1pj,1ky,1ok,wwj;1,1mm,1rh,1mm,1p4,u1r;3,1ls,1oz,1li,1nq,g3j;1,1l8,1m7,1iq,1ko,oaj;1,1ky,1rc,1k9,1ou,wor;1,1of,1of,1gi,1gn,s9b;1,1g8,1ko,1ek,1jk,z17;3,1j0,1wm,1iv,1sg,24cz;1,1uy,24t,1tu,21c,1vxn;1,20i,230,1yu,21w,uf3;1,208,21c,1wc,1yk,nff;1,208,21c,1v3,1vs,itb;3,1wc,1zy,1w2,1yk,ipf;1,1y0,1yp,1v8,1wc,3vna;1,1vi,1w2,1rw,1ta,h6f;1,1rm,1v3,1qd,1ta,j5j;1,1ta,1w2,1s6,1t0,rgz;3,1uo,1x6,1ta,1uo,j3b;1,1t0,1tk,1py,1qi,ibj;1,1rm,1tz,1rh,1sg,fxz;1,1rc,1wr,1q8,1sg,qbv;1,1rc,1rm,1oa,1py,piz;3,1py,1r7,1n6,1py,re7;1,1qi,1xv,1qi,1wm,t27;1,1y0,24e,1xg,20i,vu7;1,1ze,22q,1ya,226,hd3;4,21w,26c,21c,23k,ttz;1,23a,24o,1z4,244,nsr;1,280,29o,22b,24o,gcf;1,24e,294,23a,28a,ksf;1,28u,29y,25d,29o,oln;3,28u,2ik,28a,2gw,10xj;1,2hq,2qm,2hq,2m6,zrv;1,2lm,2rb,2kd,2lm,o8b;1,2l2,2mg,2hh,2l2,l93;1,2mg,2qr,2lc,2oy,pan;3,2nk,2te,2lq,2r6,s9b;1,2rq,2rs,2ia,2jo,onb;1,2ki,2o9,2iz,2ki,gvb;1,2jo,2m1,2f8,2h6,igj;1,2hq,2hq,27v,28u,nd7;3,276,2eo,262,28a,rbz;1,280,2df,27b,2d0,jln;1,2br,2d0,24y,26c,iqj;1,26c,2d5,26c,2bc,hpv;1,2ax,2ax,26w,28k,3oi2;3,280,2dp,280,2bc,4792;1,2bw,2fs,294,2cg,jm7;1,2e4,2gc,2cl,2g7,j7r;1,2hq,2ia,2ai,2c6,m97;1,2c6,2hq,2c6,2ee,h7j;3,2ee,2iu,2c6,2d0,gwz;1,2cq,2dk,28p,29e,frb;1,29e,29t,27g,28k,3yvy;1,28k,29o,23u,276,hjr;1,25s,280,1z9,20s,jpj;3,212,22q,1wp,1ya,jez;1,1yk,1z4,1v8,1wc,4a2q;1,1wc,20s,1wc,208,l7f;1,1yu,22v,1y4,226,46ra;1,226,26h,221,24o,frb;4,1wc,2mg,1uy,2dk,456n;1,2i5,31g,2hg,2r6,q4o;1,2r6,2rd,2lc,2na,24mf;1,2mq,2p8,2i0,2o4,1ocv;3,2lw,2pi,2je,2ks,1bvf;1,2j4,2je,25x,26c,1ohb;1,25s,28u,212,258,1dh7;1,258,2ey,24y,2b2,12s7;1,2ai,2bc,212,23a,10ij;3,24o,24o,20i,21h,mt7;1,212,244,1x1,21m,szf;1,20i,22g,1wc,1ww,mxn;1,1ww,1y5,1u4,1vs,yib;1,1wc,208,1vi,1xg,tfj;3,1yu,21m,1vs,1wc,1223;1,1wm,1wm,1ta,1tk,yv3;1,1ue,226,1ue,1yu,1dv3;1,212,235,1z9,22q,1epn;4,230,280,22s,25s,191r;1,23k,28u,23k,24o,uqr;1,24j,2ad,24j,25s,1mw3;1,25i,2ai,21h,244,170f;1,24o,29j,23k,276,2qob;3,27q,2hq,27q,2gw,1avv;1,2gm,2iz,2ee,2i0,sh3;1,2i0,2ot,2ey,2j4,1a1v;1,2ki,2u8,2k5,2te,1stz;4,2s0,2xa,2qm,2te,19jj;1,2te,2xz,2ps,2w6,17i7;1,2ui,2xz,2sf,2ty,11vz;1,2te,2vc,2ik,2jo,1huz;1,2iu,2j4,2a8,2ik,1jfn;3,2gm,2go,2cg,2fs,vwz;1,2gc,2h6,2cr,2fs,sfz;1,2fi,2g2,2b2,2cg,oqn;1,2bc,2bm,26c,280,le3;1,25s,2c1,24y,2as,qzr;3,2a8,2da,276,280,lmz;1,27g,2a3,27b,28a,hor;1,276,285,23u,258,g0r;1,23a,24y,22q,23u,m6f;1,24e,24j,1zy,208,nev;3,212,23p,20b,22g,40mq;1,226,22b,1y0,20s,mlf;1,1zy,21w,1ya,208,nlj;1,208,235,208,22q,3kpe;1,226,233,1ya,1zo,i87;3,208,21m,1ya,21m,3bm6;1,22q,258,21c,24y,o27;1,25i,27q,249,24e,twr;1,26c,2f8,262,28k,1gx3;1,2b2,2du,27q,280,q4n;3,26w,28k,25i,262,mlz;1,26w,2b2,26m,29y,thr;1,2a8,2c1,26c,26w,p5n;1,276,28k,262,262,jmr;1,262,271,23f,26c,mt7;3,25s,28f,24y,26w,wmj;1,28a,2b2,25s,280,ygn;1,2bm,2jo,2b2,2ia,44s7;1,2g2,2hp,294,29o,1trv;1,2as,2i5,29y,2ee,wjr;3,2f8,2gc,2ai,2bc,vqb;1,2cq,2ki,2cq,2j4,1syz;1,2mg,2pn,2fs,2gc,19fn;1,2g2,2lm,2fi,2jo,154n;1,2ia,2mq,2fi,2fs,1egr;3,2eo,2f8,2c1,2d0,w1f;1,2bc,2fn,2as,2da,iwn;1,2du,2hq,2as,2dk,pwv;1,2du,2ey,2bc,2dk,l9n;1,2cg,2hq,2cg,2hq,lgb;4,2gw,2hb,2bm,2c6,z4j;1,2d0,2d0,24y,24y,19q7;1,24y,24y,20s,21m,138v;1,22g,23k,20s,230,120z;3,23k,267,21w,244,q1b;1,230,23a,1zy,212,pxz;1,21m,23u,212,23a,12hn;1,25s,29t,23a,23k,1i7r;1,23u,26h,22g,230,qa8;3,24o,28a,22v,26m,12ev;1,27g,29e,25x,294,zej;1,2eo,2f8,226,22q,27nv;1,21w,24o,1yp,24e,13yz;1,24o,258,1ze,1zo,1c4b;3,1yu,1yu,1v8,1xq,xzz;1,1yk,20s,1xq,1zy,o7r;1,20i,23k,1yu,1ze,p2v;1,20i,20s,1y0,1y0,ntv;1,1ze,212,1xq,20s,xdr;3,20s,262,1yz,25i,1ahf;1,276,28f,23f,23u,19sz;1,23a,271,21v,24e,yyf;1,25i,29t,22q,26w,2lmn;1,276,2ai,23a,28k,1bn3;3,28k,28u,23u,24e,k03' },
];
function decode(s: string): PBar[] {
  const [head, body] = s.split('|');
  const [t0s, es] = head.split(',');
  const unit = Math.pow(10, Number(es));
  let t = parseInt(t0s, 36) * 86_400_000;
  return body.split(';').map((row) => {
    const [dt, o, h, l, c, v] = row.split(',');
    t += parseInt(dt, 36) * 86_400_000;
    const vv = parseInt(v, 36);
    return { t, o: parseInt(o, 36) * unit, h: parseInt(h, 36) * unit, l: parseInt(l, 36) * unit, c: parseInt(c, 36) * unit, v: vv ? Math.floor(vv / 20) * Math.pow(10, vv % 20) : NaN };
  });
}
const run = (f: Fx) => analyzePatterns(decode(f.bars), { timeframe: f.tf }).hits;

test('zzz1008 item 9: the disputed readings are no longer reported (each was reported by the previous engine)', () => {
  assert.equal(FIX.length, 6);
  for (const f of FIX) {
    assert.ok(f.old >= 70, f.name);
    const h = run(f).find((x) => x.id === f.id);
    assert.equal(h, undefined, `${f.name} must not be reported (${f.why}); got ${h?.id}:${h?.confidence}`);
  }
  assert.equal(PATTERN_ENGINE_VERSION, 'cp-3.3-indicator');   // zzz1009 bumped it (weekly reversal span, breakT / breakAgo)
});

// ───────── synthetic bars (zzz1005's generator) ─────────
type Leg = [number, number, ('lin' | 'ease')?];
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function gen(legs: Leg[], opt: { seed?: number; history?: number } = {}): PBar[] {
  const r = rng(opt.seed ?? 7), noise = 0.003, spread = 0.005;
  const path: number[] = new Array((opt.history ?? 300) + 1).fill(legs[0][1]);
  for (const [d, to, shape] of legs) { const from = path[path.length - 1]; for (let k = 1; k <= d; k++) { const x = k / d; path.push(from + (to - from) * (shape === 'ease' ? (1 - Math.cos(Math.PI * x)) / 2 : x)); } }
  const bars: PBar[] = []; let t = Date.UTC(2023, 0, 2), prevC = path[0];
  for (const p of path) {
    const c = p * (1 + (r() - 0.5) * 2 * noise), o = prevC;
    bars.push({ t, o, h: Math.max(o, c) * (1 + spread * (0.3 + 0.7 * r())), l: Math.min(o, c) * (1 - spread * (0.3 + 0.7 * r())), c, v: 1_000_000 * (0.8 + 0.4 * r()) });
    prevC = c; t += 86_400_000; while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  }
  return bars;
}
const db = (b: PBar[]) => detectPatterns(b).find((h) => h.id === 'double_bottom');

test('zzz1008 item 9: a bottom the price has run away from (at a new 1-year high made after it) is not reported; valid ones stay', () => {
  // textbook W after a fall (forming) and its fresh breakout just above the pivot: kept
  const forming = db(gen([[60, 100], [60, 70], [15, 82], [15, 70.5], [10, 77]]));
  assert.ok(forming && forming.stage === 'forming' && forming.confidence >= 0.75);
  const fresh = db(gen([[60, 100], [60, 70], [15, 82], [15, 70.5], [12, 84]]));
  assert.ok(fresh && fresh.stage === 'breakout');
  // back to the OLD high (made before the pattern — the base of a pullback from it): kept
  assert.ok(db(gen([[60, 100], [60, 70], [15, 82], [15, 70.5], [8, 84], [3, 100]])));
  // a new 1-year high made after the pattern, far beyond the pivot, close at it: the W is history, not a current bottom
  assert.equal(db(gen([[60, 90], [60, 70], [15, 82], [15, 70.5], [6, 86], [3, 98]])), undefined);
  assert.deepEqual({ ...RUNAWAY_RULES }, { near1y: 0.05, past1y: 0.05 });
  assert.equal(ranAwayFrom1y(98, 99, true, 82, true), true);
  assert.equal(ranAwayFrom1y(98, 99, false, 82, true), false, 'the high came before the pattern');
  assert.equal(ranAwayFrom1y(85, 86, true, 82.5, true), false, 'a fresh breakout ≤ 5% past the pivot');
  assert.equal(ranAwayFrom1y(52, 51, true, 60, false), true, 'tops: the mirror at the 1-year low');
});

test('zzz1008 item 9: monthly readings span at least 6 monthly candles', () => {
  assert.equal(MONTHLY_MIN_SPAN, 6);
  const rvsb = FIX.find((f) => f.name === 'RVSB M cup')!;
  assert.ok(!run(rvsb).some((h) => ['cup', 'u_base', 'cup_handle'].includes(h.id)));
});

// ───────── item 7: auditable geometry ─────────
test('zzz1008 item 7: every hit carries its turning points and evidence; tags store them compactly', () => {
  const b = gen([[60, 100], [60, 70], [15, 82], [15, 70.5], [10, 77]]);
  const h = db(b)!;
  assert.deepEqual(h.points!.map((p) => p.role), ['L1', 'P', 'L2']);
  assert.ok(h.points![0].t < h.points![1].t && h.points![1].t < h.points![2].t);
  assert.ok(Math.abs(h.points![1].p - h.pivot!) < 1e-3, 'the pivot is the middle peak');
  for (const k of ['band', 'rally', 'mid', 'trend', 'gap', 'vr']) assert.ok(Number.isFinite((h.evidence as any)[k]), k);
  const tag = toTags([h])[0];
  assert.match(tag.pts![0][0], /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(tag.pts!.every(([, p]) => String(p).replace(/^0\.0*|\./g, '').replace(/^0+/, '').length <= 4), 'prices at 4 significant digits');
  assert.ok(JSON.stringify(tag).length < 260, `compact: ${JSON.stringify(tag).length}`);
  // every role code has words; H&S carries the two neckline points
  for (const r of Object.keys(POINT_ROLES)) assert.ok((POINT_ROLES as any)[r]);
  const all = detectPatterns(gen([[60, 120], [40, 80], [12, 92], [14, 72], [16, 92.5], [12, 81], [10, 88]]));
  for (const x of all) assert.ok(x.points && x.points.length >= 2, `${x.id} has points`);
  // the screener scan stores them; the page's list payload strips them; the detail endpoint returns them
  assert.ok(PATTERN_SCAN_VERSION >= 8);
  const withPts: ScreenPatternTag = { ...tag, l: 40 };
  const row = { t: 'GEO', px: 77, pat: [withPts], patAt: '2026-10-12', scan: { st: 'ready', v: PATTERN_SCAN_VERSION, px: 77, asOf: '2026-10-12' } } as unknown as ScreenRow;
  const lean = leanRows([row]).rows[0];
  assert.equal((lean.pat![0] as any).pts, undefined); assert.equal((lean.pat![0] as any).ev, undefined);
  assert.ok(rowGeometry(row).D[0].pts!.length === 3);
  // the row detail words: points with dates, the pivot derivation and the evidence with its rule
  const g = geometryPoints({ ...withPts, tf: 'D' });
  assert.deepEqual(g.map((x) => x.word), ['first low', 'middle peak', 'second low']);
  assert.match(pivotDerivation(withPts, (n) => n.toFixed(2)), /middle peak's high \d+\.\d\d \(\d{4}-\d{2}-\d{2}\)/);
  const ev = evidenceRows({ ...withPts, tf: 'W' });
  assert.ok(ev.some((x) => /Difference between the lows/.test(x.label) && /≤ 5%/.test(x.rule)));
  assert.ok(ev.some((x) => /Separation/.test(x.label) && /weeks$/.test(x.value)));
  assert.ok(ev.some((x) => /Volume at the last turning point/.test(x.label)));
  assert.match(geometryPoints({ pts: [['2026-07-27', 25, 'L1']], tf: 'W' })[0].when, /^week of 2026-07-27$/);
  assert.match(geometryPoints({ pts: [['2026-09-01', 25, 'L1']], tf: 'M' })[0].when, /^month of 2026-09$/);
  // the chart hand-off: analysis timeframe, pattern and its window
  const p = chartIdentityParams({ scanW: { st: 'ready', v: PATTERN_SCAN_VERSION, px: 30, asOf: '2026-10-09', tf: 'W' } } as any, { ...withPts, tf: 'W' });
  assert.match(p, /&pat=double_bottom&atf=W&asof=2026-10-09/);
  assert.match(p, /&pf=\d{4}-\d{2}-\d{2}&pt=2026-10-09/);
  const ho = parsePatternHandoff((k) => ({ atf: 'w', pat: 'double_bottom', pf: '2026-06-01', pt: '2026-10-09' } as Record<string, string>)[k], PATTERN_IDS);
  assert.deepEqual(ho, { atf: 'W', pat: 'double_bottom', from: Date.parse('2026-06-01T00:00:00Z'), to: Date.parse('2026-10-09T00:00:00Z') });
  assert.equal(parsePatternHandoff(() => null, PATTERN_IDS), null);
  assert.equal(parsePatternHandoff((k) => (k === 'pat' ? 'nope' : k === 'atf' ? 'M' : null), PATTERN_IDS)!.pat, null);
  const span = handoffSpan({ startT: 1000, endT: 2000 }, null);
  assert.deepEqual(span, { startT: 400, endT: 2000 }, 'room for the prior trend before the pattern');
  // the chart page honours atf / pat (indicator switched on, pattern selected, window fitted)
  const cw = read('components/charts/ChartWorkspace.tsx'), pi = read('components/charts/PatternIndicator.tsx');
  assert.match(cw, /parsePatternHandoff\(/); assert.match(cw, /withPatterns\(w, true\)/); assert.match(cw, /handoff: patHandoff/);
  assert.match(pi, /handoff\.atf/); assert.match(pi, /setPicked\(\{ key, ids: new Set\(\[h\.id\]\) \}\)/); assert.match(pi, /fit\(\{ \.\.\.h, \.\.\.span \}\)/);
});

// ───────── item 6: labels ─────────
test('zzz1008 item 6: "Double bottom" without "(W)"; no label uses a timeframe letter in brackets; ids unchanged', () => {
  assert.equal(PATTERN_META.double_bottom.label, 'Double bottom');
  assert.equal(PATTERN_META.double_bottom.id, 'double_bottom');
  for (const id of PATTERN_IDS) assert.doesNotMatch(PATTERN_META[id].label, /\((W|M|D)\)/, id);
});

// ───────── item 3: breakouts back below the pivot ─────────
const T = (id: PatternId, s: 'f' | 'b' | 'x', d: number | null, extra: Partial<ScreenPatternTag> = {}): ScreenPatternTag =>
  ({ id, b: PATTERN_META[id].bias === 'bullish' ? 'U' : 'D', s, c: 83, p: 140.8, d, ...extra });
test('zzz1008 item 3: NOW / EDIT — "broke out · back below pivot"; breakdowns mirrored; cards count only holding breakouts', () => {
  const now = T('vcp', 'b', -0.3), edit = T('inverse_hs', 'b', -1.3, { p: 2.7861 }), hold = T('vcp', 'b', 2.1);
  assert.equal(stageWord(now), 'broke out · back below pivot');
  assert.equal(stageWord(edit), 'broke out · back below pivot');
  assert.equal(stageWord(hold), 'broke out');
  assert.equal(stageWord(T('double_top', 'b', 1.2)), 'broke down · back above level');
  assert.equal(stageWord(T('double_top', 'b', -1.2)), 'broke down');
  assert.ok(isReturned(now) && !isReturned(hold) && !isReturned(T('vcp', 'f', -0.3)));
  // the verdict never says "Breaking out" for a returned breakout
  const ma = { close: 140.32, basis: 'scan' as const, at: '2026-10-12', d21: 2, d50: 5, d200: 21 };
  assert.notEqual(maVerdict(ma, [now]).word, 'Breaking out');
  assert.equal(maVerdict(ma, [hold]).word, 'Breaking out');
  // the stage rule: returned breakouts count unless the query excludes them (setup cards' screens do)
  const rule = { bias: 'U' as const, ids: [], stages: ['b' as const], minScore: 55, dist: { on: false, lo: 0, hi: 0 } };
  assert.equal(tagPasses(now, rule), true);
  assert.equal(tagPasses(now, { ...rule, returned: false }), false);
  assert.equal(tagPasses(hold, { ...rule, returned: false }), true);
  for (const id of ['breakouts-today', 'breakdowns', 'weekly-bases', 'monthly-bases', 'monthly-reversal-bases', 'monthly-near-pivot']) assert.equal(BUILT_IN_PINE_SCREENS.find((s) => s.id === id)!.q.returned, false, id);
  assert.equal(DEFAULT_QUERY.returned, true);
  assert.equal(cleanQuery({ returned: false }).returned, false);
  assert.equal(cleanQuery({}).returned, true);
  for (const s of BUILT_IN_PINE_SCREENS) assert.deepEqual(cleanQuery(s.q), s.q, s.id);
  const rows = [{ t: 'NOWX', px: 140.32, pat: [now], patAt: '2026-10-12', scan: { st: 'ready', v: PATTERN_SCAN_VERSION, px: 140.32, asOf: '2026-10-12' } }] as unknown as ScreenRow[];
  const weekly: PineQuery = { ...DEFAULT_QUERY, stages: ['b'], dist: { on: false, lo: 0, hi: 0 } };
  assert.equal(runPineFull(rows, weekly, 'US').strict.length, 1);
  assert.equal(runPineFull(rows, { ...weekly, returned: false }, 'US').strict.length, 0);
  assert.match(querySummary({ ...weekly, returned: false }, ''), /Breakouts holding above the pivot/);
  assert.match(tagRejectReasons(now, { ...weekly, returned: false }).join(), /back below the pivot/);
  // the chart's own words
  assert.equal(stageWords({ stage: 'breakout', bias: 'bullish', distToPivotPct: -0.34 } as any), 'broke out · back below pivot');
  assert.equal(stageWords({ stage: 'breakout', bias: 'bullish', distToPivotPct: 0.5 } as any), 'breaking out');
});

// ───────── item 2: session-behind quotes during the session; "same day" only on equal dates ─────────
test('zzz1008 item 2: a Nasdaq quote a session behind DURING the session uses the live bar (provisional) — no conflict', () => {
  const IN_SESSION = new Date('2026-10-13T17:00:00Z');   // 13:00 New York
  // AAOI on 13 Oct: the list still showed the 12 Oct close 100.68 (and its change); the bars' live bar was 96.74
  const tf = { close: 96.74, scanPx: 96.74, scanAt: '2026-10-13', prevClose: 100.68, prev2Close: 109.64, cc: { px: 100.68 } };
  const chg = Math.round((100.68 / 109.64 - 1) * 10000) / 100;
  const r = resolveUsQuote({ px: 100.68, chg }, tf, IN_SESSION);
  assert.equal(r.px, 96.74); assert.equal(r.live, true); assert.equal(r.at, '2026-10-13'); assert.equal(r.pxAlt, 100.68);
  assert.match(r.src, /live bar \(provisional/);
  const f = rowScanFields(tf as any, { px: r.px, src: r.src, at: r.at });
  assert.equal(f.pxConflict, undefined); assert.equal(f.pxGap, 0);
  // without a live bar (the entry was read yesterday) a live quote is never replaced
  assert.equal(resolveUsQuote({ px: 100.68, chg }, { ...tf, cc: undefined }, IN_SESSION).src, 'nasdaq');
  // a genuine disagreement (the quote is not yesterday's close) stays a conflict
  const g = resolveUsQuote({ px: 104, chg: 1.5 }, tf, IN_SESSION);
  assert.equal(g.src, 'nasdaq');
  assert.equal(rowScanFields(tf as any, { px: g.px, src: g.src, at: g.at }).pxConflict, 1);
  // the wording: "same day" only when both dates are equal (BVN: quote date unknown vs 13 Oct)
  assert.match(conflictWords({ pxConflict: 1, scanAt: '2026-10-13', pxGap: 2.31 }), /its date is not known.*\(2026-10-13\) are 2\.31% apart/);
  assert.doesNotMatch(conflictWords({ pxConflict: 1, scanAt: '2026-10-13', pxAt: '2026-10-12', pxGap: 2.31 }), /same day/);
  assert.match(conflictWords({ pxConflict: 1, scanAt: '2026-10-13', pxAt: '2026-10-13', pxGap: 2.31 }), /same day \(2026-10-13\)/);
  assert.equal(conflictWords({ scanAt: '2026-10-13' }), '');
  const ui = read('components/pine-screener/HitDetail.tsx');
  assert.doesNotMatch(ui, /disagree on the same day<\/span>/);
  assert.match(read('lib/screener/us-build.ts'), /rq\.live \? \{ pxLive: 1/);
});

// ───────── item 4: one documented close for the averages ─────────
test('zzz1008 item 4: BVN — the 21 / 50 / 200-day distances use the daily technical close (13 Oct, provisional), not the 12 Oct analysis close', () => {
  const bvn = { t: 'BVN', px: 32.3, scanPx: 31.57, scanAt: '2026-10-13', cc: { px: 32.3 }, sma21: 32.57, sma50: 33.56, sma200: 33.98,
    scan: { st: 'ready', v: PATTERN_SCAN_VERSION, px: 32.3, asOf: '2026-10-12', session: 'completed' }, scanLive: { st: 'ready', at: '2026-10-13T19:26:01Z', px: 31.57, asOf: '2026-10-13', session: 'open' } } as unknown as ScreenRow;
  const ma = maPosition(bvn);
  assert.equal(ma.close, 31.57); assert.equal(ma.at, '2026-10-13'); assert.equal(ma.session, 'provisional');
  assert.equal(ma.d21, Math.round((31.57 / 32.57 - 1) * 1000) / 10);
  // a completed read: same close, completed session
  assert.equal(maPosition({ ...bvn, cc: undefined, scanLive: undefined } as any).session, 'completed');
  const tip = read('components/pine-screener/pine-ui.tsx');
  assert.match(tip, /Daily technical close/); assert.match(tip, /pattern's own analysis close is shown apart/);
});

// ───────── item 5: coverage warnings in the selected timeframe's language ─────────
test('zzz1008 item 5: monthly / weekly coverage warnings use their own units and counts', () => {
  const rows = [
    { t: 'A', scanM: { st: 'insufficient-history', v: PATTERN_SCAN_VERSION, tf: 'M' }, scan: { st: 'insufficient-history', v: PATTERN_SCAN_VERSION } },
    { t: 'B', scanM: { st: 'insufficient-history', v: PATTERN_SCAN_VERSION, tf: 'M' }, scan: { st: 'no-pattern', v: PATTERN_SCAN_VERSION, px: 1, asOf: '2026-10-12' } },
    { t: 'C', scanM: { st: 'no-pattern', v: PATTERN_SCAN_VERSION, tf: 'M', px: 5, asOf: '2026-09-30' }, scan: { st: 'no-pattern', v: PATTERN_SCAN_VERSION, px: 1, asOf: '2026-10-12' } },
  ] as unknown as ScreenRow[];
  const m = tfCoverageWarnings(scopeCoverage(rows, ['M'], null).perTf);
  assert.deepEqual(m, ['Monthly: 2 companies have too little monthly history for a pattern scan (fewer than 24 usable completed months) — not counted as scanned.']);
  assert.doesNotMatch(m.join(), /sessions/);
  assert.match(tfCoverageWarnings(scopeCoverage(rows, ['D'], null).perTf).join(), /^Daily: 1 company has too little daily history .*fewer than 30 usable sessions/);
  // the route no longer sends the daily "fewer than 30 usable sessions" note for every timeframe
  assert.doesNotMatch(read('app/api/v1/pine-screener/route.ts'), /fewer than 30 usable sessions/);
});

// ───────── item 1: rebuild states and stages ─────────
const stale = (tf?: 'W' | 'M') => ({ st: 'stale-version', v: PATTERN_SCAN_VERSION - 1, ...(tf ? { tf } : {}) });
const cur = (tf: 'D' | 'W' | 'M', px = 10) => ({ st: 'ready', v: PATTERN_SCAN_VERSION, px, asOf: tf === 'M' ? '2026-09-30' : tf === 'W' ? '2026-10-09' : '2026-10-12', ...(tf !== 'D' ? { tf } : {}) });
test('zzz1008 item 1b: a timeframe being re-read is "cannot be determined yet" (none) or "so far" (partial), never a plain 0', () => {
  const allStale = [1, 2, 3].map((i) => ({ t: `S${i}`, scan: cur('D'), pat: [T('cup', 'f', -3)], patAt: '2026-10-12', scanW: stale('W'), scanM: stale('M') })) as unknown as ScreenRow[];
  const qW: PineQuery = { ...DEFAULT_QUERY, tfs: ['W'] };
  const r = queryRebuild(allStale, qW);
  assert.equal(r.state, 'none');
  assert.match(r.text, /^Weekly scan rebuilding — matches cannot be determined yet \(0 of 3 re-read with the current scan\)$/);
  assert.equal(queryRebuild(allStale, { ...qW, tfs: ['D', 'W'], tfMode: 'any' }).state, 'partial', 'D can match meanwhile');
  assert.equal(queryRebuild(allStale, { ...qW, tfs: ['D', 'W'], tfMode: 'all' }).state, 'none');
  assert.equal(queryRebuild(allStale, { ...qW, need: 'any' }).state, 'ok', 'a rules-only screen does not wait for patterns');
  const half = [...allStale, { t: 'S4', scan: cur('D'), scanW: cur('W'), patW: [T('cup', 'f', -3, { tf: 'W' })] }] as unknown as ScreenRow[];
  const p = queryRebuild(half, qW);
  assert.equal(p.state, 'partial'); assert.match(p.text, /1 of 4 re-read/);
  const cards = setupRebuild(allStale, null);
  assert.equal(cards.weekly.state, 'none'); assert.equal(cards.monthly.state, 'none'); assert.equal(cards['monthly:alt'].state, 'none'); assert.equal(cards.breakouts.state, 'ok');
  assert.equal(setupCounts(allStale, 'US', null, []).weekly, 0, 'the strict count is 0 — the card shows "…" from the rebuild state instead');
});

async function withPage<T>(rows: unknown[], fn: (h: { act: any; click: (pred: (b: HTMLButtonElement) => boolean) => Promise<void>; text: () => string; settle: () => Promise<void>; choose: (l: string, v: string) => Promise<void> }) => Promise<T>, url = 'http://localhost/pine-screener?market=US', detail?: unknown) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url, pretendToBeVisual: true });
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent', 'navigator', 'self', 'React', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
  const old = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Event', 'CustomEvent', 'StorageEvent']) Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  (dom.window as any).confirm = () => true;
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Object.assign(globalThis, { self: dom.window, React, IS_REACT_ACT_ENVIRONMENT: true });
  (globalThis as any).fetch = async (u: string) => ({ ok: true, status: 200, json: async () => (u.includes('detail=') ? detail : u.includes('/api/v1/pine-screener') ? { ok: true, builtAt: '2026-10-13T12:00:00Z', ...leanRows(rows as ScreenRow[]), notes: [] } : { ok: true }) });
  const root = createRoot(document.getElementById('root')!);
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  const text = () => document.body.textContent || '';
  const click = async (pred: (b: HTMLButtonElement) => boolean) => { const b = Array.from(document.querySelectorAll('button')).find(pred); assert.ok(b, 'button'); await act(async () => { b!.click(); await settle(); }); };
  const choose = async (label: string, value: string) => { const el = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement; await act(async () => { el.value = value; el.dispatchEvent(new (window as any).Event('change', { bubbles: true })); await settle(); }); };
  try {
    const { default: PineScreener } = await import('../../components/pine-screener/PineScreener');
    await act(async () => { root.render(React.createElement(PineScreener)); await settle(); await settle(); });
    return await fn({ act, click, text, settle, choose });
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise<void>((r) => setTimeout(r, 3000));   // the page's 2.8 s status-message timer
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; }
    dom.window.close();
  }
}

test('zzz1008 item 1 (JSDOM): Breakouts card + D / W / M + ANY / ALL never clear the stage; a rebuilding weekly scan reads "cannot be determined yet"', async () => {
  const rows = [
    { t: 'AAA', n: 'A', px: 102, pat: [T('vcp', 'b', 2)], patAt: '2026-10-12', scan: cur('D', 102), scanW: stale('W'), scanM: stale('M') },
    { t: 'BBB', n: 'B', px: 99, pat: [T('vcp', 'f', -1)], patAt: '2026-10-12', scan: cur('D', 99), scanW: stale('W'), scanM: stale('M') },
  ];
  await withPage(rows, async ({ click, text, choose }) => {
    const h2 = () => document.querySelector('[data-testid="active-query"]')!.textContent!;
    const count = () => document.querySelector('[data-testid="match-count"]')!.textContent!;
    // the weekly / monthly cards are "…" while their scan is rebuilding — never 0
    const card = (id: string) => document.querySelector(`[data-card="${id}"] .pnx-card-count`)!.textContent;
    assert.equal(card('weekly'), '…'); assert.equal(card('monthly'), '…');
    assert.equal(document.querySelector('[data-card="weekly"]')!.getAttribute('data-rebuild'), 'none');
    assert.match(document.querySelector('[data-alt-count="monthly-reversal-bases"]')!.textContent!, /^\+ … reversal bases/);
    await click((b) => b.getAttribute('data-card') === 'breakouts');
    assert.match(h2(), /· Breakout · /); assert.equal(count(), '1 companies match');
    for (const step of [() => click((b) => b.getAttribute('aria-label') === 'weekly patterns'), () => choose('Timeframes combine', 'all'), () => click((b) => b.getAttribute('aria-label') === 'daily patterns'),
      () => click((b) => b.getAttribute('aria-label') === 'monthly patterns'), () => choose('Timeframes combine', 'any'), () => click((b) => b.textContent === 'Breakout')]) {
      await step();
      assert.doesNotMatch(h2(), /No stage/, h2());
    }
    // W + M (any), both rebuilding: not "0 companies match"
    assert.match(h2(), /^Bullish · Weekly \+ Monthly \(any\)/);
    assert.equal(count(), 'Matches cannot be determined yet');
    assert.match(document.querySelector('[data-testid="rebuild-banner"]')!.textContent!, /Weekly scan rebuilding — matches cannot be determined yet \(0 of 2 re-read with the current scan\)/);
    assert.doesNotMatch(text(), /Widen the distance to pivot/);
    assert.match(text(), /this is not a “no match”/);
    // pattern-type chips show "…" (unknown), not 0
    await click((b) => b.textContent!.startsWith('▸ Pattern types'));
    assert.equal(document.querySelector('button[data-pat="cup"] .pnx-n')!.textContent, '…');
    // adding daily (ANY): matches so far, marked as such
    await click((b) => b.getAttribute('aria-label') === 'daily patterns');
    assert.match(count(), /companies match so far$/);
  });
});

test('zzz1008 item 7 (JSDOM): the row detail shows the detected structure — points with dates and prices, pivot derivation, evidence', async () => {
  const b = gen([[60, 100], [60, 70], [15, 82], [15, 70.5], [10, 77]]);
  const tag = { ...toTags([db(b)!])[0], l: 40 } as ScreenPatternTag;
  const rows = [{ t: 'GEO', n: 'Geo', px: tag.p! * 0.95, pat: [tag], patAt: '2026-10-12', scan: cur('D', 77), scanPx: 77, scanAt: '2026-10-12' }];
  const detail = { ok: true, t: 'GEO', geometry: { D: [tag], W: [], M: [], L: [] } };
  await withPage(rows, async ({ click }) => {
    await click((x) => x.getAttribute('aria-label') === 'Details for GEO');
    await new Promise((r) => setTimeout(r, 60));
    const st = document.querySelector('[data-testid="structure"]')!;
    assert.ok(st, 'structure section');
    assert.match(st.textContent!, /Detected structure — Double bottom on daily bars/);
    assert.deepEqual(Array.from(st.querySelectorAll('[data-point]')).map((x) => x.getAttribute('data-point')), ['L1', 'P', 'L2']);
    assert.match(st.querySelector('[data-point="L1"]')!.textContent!, /first low\d{4}-\d{2}-\d{2}\$\d+\.\d\d/);
    assert.match(st.querySelector('[data-derivation]')!.textContent!, /Pivot: pivot = the middle peak's high \$\d+\.\d\d \(\d{4}-\d{2}-\d{2}\)/);
    assert.match(st.querySelector('[data-evidence]')!.textContent!, /Difference between the lows: [\d.]+% — rule ≤ 5%/);
    assert.match(st.querySelector('[data-evidence]')!.textContent!, /Prior fall into the first low/);
    assert.match(st.querySelector('[data-evidence]')!.textContent!, /Middle rally/);
  }, 'http://localhost/pine-screener?market=US', detail);
});
