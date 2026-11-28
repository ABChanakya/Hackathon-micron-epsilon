import test from 'node:test';
import assert from 'node:assert/strict';
import {fitCameraDistance} from '../dist/sensor3d.js';

test('sensor framing contains the housing, cable and laser at portrait and landscape aspect ratios',()=>{
  const corners=[];
  for(const x of [-1.6,1.6])for(const y of [-2.1,1.7])for(const z of [-.8,1])corners.push([x,y,z]);
  for(const aspect of [.6,1,1.4,2.4]){
    const distance=fitCameraDistance(corners,aspect);
    const vertical=Math.tan(35*Math.PI/360);
    for(const [x,y,z] of corners){
      assert.ok(Math.abs(x)/(distance-z)<vertical*aspect,`horizontal fit at ${aspect}`);
      assert.ok(Math.abs(y)/(distance-z)<vertical,`vertical fit at ${aspect}`);
    }
  }
  assert.ok(fitCameraDistance(corners,.6)>fitCameraDistance(corners,2.4));
});
