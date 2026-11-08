// Port of GravityEstimator in bmi323-gravity/server.py.
class GravityEstimator {
  constructor(){this.gravity=null;this.lastUs=null}
  update(accel,gyro,timestampUs){
    const magnitude=Math.hypot(...accel);
    const measured=magnitude>=0.5 && magnitude<=1.5 ? accel.map(v=>v/magnitude) : null;
    const dt=this.lastUs===null?null:(timestampUs-this.lastUs)/1e6;
    this.lastUs=timestampUs;
    if(dt===null || dt<=0 || dt>0.25 || this.gravity===null){
      this.gravity=measured || this.gravity;
      return this.gravity;
    }
    if(gyro.some(rate=>Math.abs(rate)>2000))return this.gravity;
    const [wx,wy,wz]=gyro.map(rate=>rate*Math.PI/180);
    let [gx,gy,gz]=this.gravity;
    [gx,gy,gz]=[gx+(gy*wz-gz*wy)*dt,gy+(gz*wx-gx*wz)*dt,gz+(gx*wy-gy*wx)*dt];
    if(measured){
      const correction=1-Math.exp(-dt);
      gx+=correction*(measured[0]-gx);gy+=correction*(measured[1]-gy);gz+=correction*(measured[2]-gz);
    }
    const norm=Math.hypot(gx,gy,gz);
    this.gravity=[gx/norm,gy/norm,gz/norm];
    return this.gravity;
  }
}
function gravityGate(gravity){return gravity ? Math.min(1,Math.max(0,gravity[2])) : null}
if(typeof module!=='undefined'){module.exports=GravityEstimator;module.exports.gravityGate=gravityGate}
