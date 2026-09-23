// Fixtures must be synthetic staging users with existing Google/Supabase sessions.
// Never commit a fixture containing cookies, QR passes or real attendee data.
// k6 run -e BASE_URL=... -e FIXTURES=/private/staging-users.json scripts/load-authenticated.js
import http from 'k6/http';
import {check,sleep} from 'k6';
import {SharedArray} from 'k6/data';
const fixtures=new SharedArray('synthetic sessions',()=>JSON.parse(open(__ENV.FIXTURES)));
export const options={scenarios:{dashboards:{executor:'constant-vus',vus:800,duration:'90s'}},thresholds:{http_req_failed:['rate<0.01'],http_req_duration:['p(95)<500']}};
export default function(){const user=fixtures[(__VU-1)%fixtures.length];const r=http.post(`${__ENV.BASE_URL}/api/action`,JSON.stringify({action:'dashboard'}),{headers:{'Content-Type':'application/json',Origin:__ENV.BASE_URL,Cookie:user.cookie}});check(r,{'own dashboard available':r=>r.status===200&&Boolean(r.json('registration'))});sleep(10);}
