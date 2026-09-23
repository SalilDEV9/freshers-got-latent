import {test,expect,type Page} from '@playwright/test';
async function signIn(page:Page,username:string){
 await page.goto('/');
 await page.getByRole('button',{name:'Crew sign in'}).click();
 await page.getByLabel('Username',{exact:true}).fill(username);
 await page.getByLabel('Password',{exact:true}).fill(process.env.FGL_E2E_PASSWORD!);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible();
}
test('audience, independent judges, reveal and result report',async({browser,page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Take your front-row seat.'})).toBeVisible();
 // Mobile layout validation works both before and after the rehearsal has completed.
 if(testInfo.project.name==='mobile'){
   await page.getByRole('link',{name:'Results',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Judge ranking',exact:true})).toBeVisible();
   const widths=await page.evaluate(()=>({width:innerWidth,body:document.documentElement.scrollWidth}));
   expect(widths.body).toBeLessThanOrEqual(widths.width+1);expect(errors).toEqual([]);return;
 }
await expect(page.locator('.sealed')).toContainText('Scores are sealed');
 for(const username of ['judge1','judge2']){
   const context=await browser.newContext();const judge=await context.newPage();judge.on('dialog',d=>d.accept());
   await signIn(judge,username);await judge.getByLabel('Your score',{exact:true}).fill('8');
   await judge.getByRole('button',{name:'Lock score',exact:true}).click();
   await expect(judge.getByText('Your score: 8 · Locked')).toBeVisible();await context.close();
 }
 const context=await browser.newContext();const admin=await context.newPage();admin.on('dialog',d=>d.accept());
 await signIn(admin,'admin');await admin.getByRole('link',{name:'Stage control',exact:true}).click();
 await admin.getByRole('button',{name:'Reveal the scores',exact:true}).click();
 await expect(page.getByText('IT’S A MATCH',{exact:true})).toBeVisible({timeout:10000});
 await admin.getByRole('button',{name:'Complete this act',exact:true}).click();
 await admin.getByRole('link',{name:'Results',exact:true}).click();
 const download=admin.waitForEvent('download');await admin.getByRole('link',{name:'Download PDF',exact:true}).click();
 expect((await download).suggestedFilename()).toBe('fgl-results.pdf');
 await context.close();expect(errors).toEqual([]);
});
