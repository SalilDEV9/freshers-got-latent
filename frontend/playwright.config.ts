import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',fullyParallel:false,workers:1,retries:0,
 use:{baseURL:'http://127.0.0.1:8000',trace:'retain-on-failure'},
 webServer:{command:'python ../scripts/e2e_server.py',url:'http://127.0.0.1:8000/api/health',reuseExistingServer:false,timeout:30000},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],
 reporter:[['list'],['html',{open:'never'}]],
});
