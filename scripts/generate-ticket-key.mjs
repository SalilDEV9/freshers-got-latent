import {generateKeyPairSync} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const path=process.argv[2];if(!path)throw new Error('Supply a private output path outside the repository');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
writeFileSync(path,`FGL_SIGNING_KEY_ID=FGL-KEY-01\nFGL_SIGNING_PRIVATE_KEY_JSON='${JSON.stringify(privateKey.export({type:'pkcs8',format:'pem'}))}'\nFGL_VERIFY_KEYS_JSON='${JSON.stringify({'FGL-KEY-01':publicKey.export({type:'spki',format:'pem'})})}'\n`,{mode:0o600,flag:'wx'});
console.log('Key configuration written securely to the requested file. Do not commit it.');
