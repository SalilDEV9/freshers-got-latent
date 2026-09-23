// k6 run -e BASE_URL=https://YOUR-STAGING-SITE scripts/load-live.js
// Run only against a dedicated rehearsal deployment; this is not a production result.
import http from 'k6/http';
import {check,sleep} from 'k6';
export const options={stages:[{duration:'30s',target:400},{duration:'60s',target:800},{duration:'60s',target:800},{duration:'15s',target:0}],thresholds:{http_req_failed:['rate<0.01'],http_req_duration:['p(95)<500']}};
export default function(){const r=http.get(`${__ENV.BASE_URL}/api/live`);check(r,{'live status 200':r=>r.status===200,'public event present':r=>Boolean(r.json('event'))});sleep(2+Math.random()*3);}
