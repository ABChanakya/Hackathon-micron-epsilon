import { factoryMeshes } from './sensormodelle.mjs';
// Orthographic software renderer. All five heads also work from file:// and without WebGL.
export const sensorPreview = (() => {
  function decode(text, Type) {
    return new Type(Uint8Array.from(atob(text), c => c.charCodeAt(0)).buffer);
  }
  const meshes = {};
  for (const [key, raw] of Object.entries(factoryMeshes)) {
    meshes[key] = {
      vertices:decode(raw.vertices,Int16Array), indices:decode(raw.indices,Uint16Array),
      normals:decode(raw.normals,Int8Array), paint:decode(raw.paint,Uint8Array),
      colors:raw.colors.map(c => [c>>16,(c>>8)&255,c&255])
    };
  }
  const cache = new Map();
  function image(model, step = 0) {
    step = ((step % 24) + 24) % 24;
    const key = model + step;
    if (cache.has(key)) return cache.get(key);
    const m = meshes[model], canvas = document.createElement("canvas");
    const width = canvas.width = 272, height = canvas.height = 184;
    const ctx = canvas.getContext("2d"), frame = ctx.createImageData(width,height);
    const depth = new Float32Array(width*height).fill(-Infinity);
    const angle = (model==="opto" ? .52 : -.83) + step*Math.PI/12;
    const a=Math.cos(angle), b=Math.sin(angle), c=Math.cos(.39), d=Math.sin(.39);
    const projected = new Float32Array(m.vertices.length);
    const fit = model==="opto" ? 64 : 57;
    for (let k=0;k<m.vertices.length;k+=3) {
      const x=m.vertices[k]/5000-(model==="uc"?.35:0);
      const y=m.vertices[k+1]/5000-(model==="opto"?.25:0);
      const z=m.vertices[k+2]/5000, along=b*x+a*z;
      projected[k]=width/2+fit*(a*x-b*z);
      projected[k+1]=height/2-fit*(c*y-d*along);
      projected[k+2]=c*along+d*y;
    }
    for (let k=0;k<m.indices.length;k+=3) {
      const i=m.indices[k]*3,j=m.indices[k+1]*3,l=m.indices[k+2]*3;
      const x=projected[i],y=projected[i+1], ex=projected[j]-x,ey=projected[j+1]-y;
      const fx=projected[l]-x,fy=projected[l+1]-y, area=ex*fy-ey*fx;
      if (area>=-.001) continue;
      const nx=m.normals[k]/127,ny=m.normals[k+1]/127,nz=m.normals[k+2]/127;
      const horizontal=a*nx-b*nz, along=b*nx+a*nz, up=c*ny-d*along, front=d*ny+c*along;
      const light=Math.max(0,-.4*horizontal+.79*up+.46*front);
      const shine=24*Math.pow(Math.max(0,-.2*horizontal+.42*up+.88*front),12);
      const rgb=m.colors[m.paint[k/3]].map(v => v*(.64+.45*light)+shine);
      const left=Math.max(0,Math.floor(Math.min(x,x+ex,x+fx)));
      const right=Math.min(width-1,Math.ceil(Math.max(x,x+ex,x+fx)));
      const top=Math.max(0,Math.floor(Math.min(y,y+ey,y+fy)));
      const bottom=Math.min(height-1,Math.ceil(Math.max(y,y+ey,y+fy)));
      for (let py=top;py<=bottom;py++) for (let px=left;px<=right;px++) {
        const dx=px+.5-x,dy=py+.5-y, u=(dx*fy-dy*fx)/area,v=(ex*dy-ey*dx)/area;
        if(u<0 || v<0 || u+v>1) continue;
        const z=projected[i+2]+u*(projected[j+2]-projected[i+2])+v*(projected[l+2]-projected[i+2]);
        const p=py*width+px;
        if (z<depth[p]) continue;
        depth[p]=z;
        const offset=p*4;
        frame.data[offset]=rgb[0];frame.data[offset+1]=rgb[1];frame.data[offset+2]=rgb[2];frame.data[offset+3]=255;
      }
    }
    ctx.putImageData(frame,0,0);
    const url=canvas.toDataURL(); cache.set(key,url); return url;
  }
  return image;
})();
